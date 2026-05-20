import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FileNode } from '@/lib/jmap/types';

export interface FileResource {
  id: string;
  name: string;
  serverName: string;
  isDirectory: boolean;
  contentType: string;
  contentLength: number;
  lastModified: string;
  blobId: string | null;
  parentId: string | null;
}

// name→resource lookup cached against the resources array identity. Six
// actions in this store do `resources.find(r => r.name === name)` — each
// O(N) on a directory listing that can grow large. WeakMap is freed on
// next array swap (refresh / nav).
const _resourceByNameCache = new WeakMap<readonly FileResource[], Map<string, FileResource>>();
function resourceByNameLookup(resources: readonly FileResource[]): Map<string, FileResource> {
  let m = _resourceByNameCache.get(resources);
  if (!m) {
    m = new Map<string, FileResource>();
    for (const r of resources) m.set(r.name, r);
    _resourceByNameCache.set(resources, m);
  }
  return m;
}

interface UploadProgress {
  name: string;
  loaded: number;
  total: number;
  current: number;
  totalFiles: number;
}

interface ClipboardState {
  mode: 'cut' | 'copy';
  ids: string[];
  names: string[];
  serverNames: string[];
  sourceParentId: string | null;
  sourcePath: string;
}

interface UndoAction {
  type: 'rename' | 'move';
  entries: { id: string; from: Partial<Pick<FileNode, 'name' | 'parentId'>>; to: Partial<Pick<FileNode, 'name' | 'parentId'>> }[];
  sourceParentId: string | null;
}

interface FileState {
  currentParentId: string | null;
  currentPath: string;
  pathStack: { id: string | null; name: string }[];
  resources: FileResource[];
  isLoading: boolean;
  error: string | null;
  supportsFiles: boolean | null;
  selectedResources: Set<string>;
  uploadProgress: UploadProgress | null;
  client: IJMAPClient | null;
  clipboard: ClipboardState | null;
  uploadAbortController: AbortController | null;
  favorites: string[];
  recentFiles: { name: string; id: string; timestamp: number }[];
  lastAction: UndoAction | null;

  // Actions
  initClient: (client: IJMAPClient) => void;
  checkSupport: () => Promise<boolean>;
  navigate: (parentId: string | null, name?: string) => Promise<void>;
  navigateByPath: (path: string) => Promise<void>;
  navigateUp: () => Promise<void>;
  refresh: () => Promise<void>;
  createDirectory: (name: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  uploadFolder: (files: File[]) => Promise<void>;
  cancelUpload: () => void;
  deleteResource: (name: string) => Promise<void>;
  deleteResources: (names: string[]) => Promise<void>;
  renameResource: (oldName: string, newName: string) => Promise<void>;
  downloadResource: (name: string) => Promise<void>;
  downloadResources: (names: string[]) => Promise<void>;
  getImageUrl: (name: string) => Promise<string>;
  getFileContent: (name: string) => Promise<{ blob: Blob; contentType: string }>;
  createTextFile: (name: string) => Promise<void>;
  duplicateResource: (name: string) => Promise<void>;
  moveToFolder: (names: string[], targetFolder: string) => Promise<void>;
  moveToParent: (names: string[]) => Promise<void>;
  cutResources: (names: string[]) => void;
  copyResources: (names: string[]) => void;
  pasteResources: () => Promise<void>;
  selectResource: (name: string | null) => void;
  toggleSelect: (name: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelection: (names: Set<string>) => void;
  listPath: (path: string) => Promise<FileResource[]>;
  listByParentId: (parentId: string | null) => Promise<FileResource[]>;
  toggleFavorite: (path: string) => void;
  addRecentFile: (name: string, id: string) => void;
  undoLastAction: () => Promise<void>;
}

const DIRECTORY_TYPES = new Set(['d', 'application/x-directory', 'text/directory', 'httpd/unix-directory', 'inode/directory']);

// Stalwart rejects "/" in file names, so we use Unicode DIVISION SLASH as the
// path separator when encoding folder hierarchy into flat file names.
const PATH_SEP = '\u2215'; // ∕

function isDirectoryType(type: string | undefined): boolean {
  if (!type) return false;
  return DIRECTORY_TYPES.has(type) || type.includes('directory');
}

// Convert currentPath to a server-side name prefix for filtering
// "/" -> "", "/test" -> "test∕", "/test/sub" -> "test∕sub∕"
function getPathPrefix(currentPath: string): string {
  if (currentPath === '/') return '';
  return currentPath.slice(1).replace(/\//g, PATH_SEP) + PATH_SEP;
}

// Filter nodes to only direct children of a path prefix
function filterNodesByPrefix(nodes: FileNode[], prefix: string): FileNode[] {
  if (prefix === '') {
    // Root: nodes whose names have no PATH_SEP
    return nodes.filter(n => !n.name.includes(PATH_SEP));
  }
  // Subfolder: nodes starting with prefix, with no additional PATH_SEP after the prefix
  return nodes.filter(n => {
    if (!n.name.startsWith(prefix)) return false;
    const remaining = n.name.slice(prefix.length);
    return remaining.length > 0 && !remaining.includes(PATH_SEP);
  });
}

function nodeToResource(node: FileNode, pathPrefix: string = ''): FileResource {
  const displayName = pathPrefix && node.name.startsWith(pathPrefix)
    ? node.name.slice(pathPrefix.length)
    : node.name;
  const isDir = isDirectoryType(node.type);
  return {
    id: node.id,
    name: displayName,
    serverName: node.name,
    isDirectory: isDir,
    contentType: isDir ? '' : node.type,
    contentLength: node.size,
    lastModified: node.updated || node.created,
    blobId: node.blobId,
    parentId: node.parentId,
  };
}

function getUniqueName(name: string, existingNames: Set<string>): string {
  if (!existingNames.has(name)) return name;
  const dotIndex = name.lastIndexOf('.');
  const base = dotIndex > 0 ? name.substring(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.substring(dotIndex) : '';
  let counter = 1;
  while (existingNames.has(`${base} (${counter})${ext}`)) counter++;
  return `${base} (${counter})${ext}`;
}

function buildPathFromStack(stack: { id: string | null; name: string }[]): string {
  if (stack.length <= 1) return '/';
  return '/' + stack.slice(1).map(s => s.name).join('/');
}

// Resolves a list of resource names against the current view in one pass.
// Was: cutResources / copyResources each built `byName` + walked `names`
// twice (once for ids, once for serverNames). Identical bodies, just
// `mode: 'cut'` vs `mode: 'copy'`. Fused into one walk + one shared helper.
function buildClipboard(
  mode: 'cut' | 'copy',
  names: string[],
  state: { currentPath: string; resources: FileResource[] },
): ClipboardState {
  const byName = new Map<string, FileResource>();
  for (const r of state.resources) byName.set(r.name, r);
  const ids: string[] = [];
  const serverNames: string[] = [];
  for (const n of names) {
    const r = byName.get(n);
    if (!r) continue;
    if (r.id) ids.push(r.id);
    if (r.serverName) serverNames.push(r.serverName);
  }
  return { mode, ids, names, serverNames, sourceParentId: null, sourcePath: state.currentPath };
}

export const useFileStore = create<FileState>((set, get) => ({
  currentParentId: null,
  currentPath: '/',
  pathStack: [{ id: null, name: '' }],
  resources: [],
  isLoading: false,
  error: null,
  supportsFiles: null,
  selectedResources: new Set<string>(),
  uploadProgress: null,
  client: null,
  clipboard: null,
  uploadAbortController: null,
  lastAction: null,
  favorites: (() => {
    try { return JSON.parse(localStorage.getItem('files-favorites') || '[]'); } catch { return []; }
  })(),
  recentFiles: (() => {
    try { return JSON.parse(localStorage.getItem('files-recent-files') || '[]'); } catch { return []; }
  })(),

  initClient: (client: IJMAPClient) => {
    set({ client });
  },

  checkSupport: async () => {
    const { client } = get();
    if (!client) {
      set({ supportsFiles: false });
      return false;
    }
    // First check capability, then probe with a real request
    const supported = await client.probeFileNodeSupport();
    if (!supported) {
      console.warn('[Files] JMAP FileNode not supported. Available capabilities:', Object.keys(client.getCapabilities()));
    }
    set({ supportsFiles: supported });
    return supported;
  },

  navigate: async (parentId: string | null, name?: string) => {
    const { client, pathStack } = get();
    if (!client) return;

    set({ isLoading: true, error: null, currentParentId: parentId, selectedResources: new Set() });

    // Update path stack
    let newStack: { id: string | null; name: string }[];
    if (parentId === null) {
      newStack = [{ id: null, name: '' }];
    } else {
      // Check if navigating to a parent in the stack
      const existingIdx = pathStack.findIndex(s => s.id === parentId);
      if (existingIdx >= 0) {
        newStack = pathStack.slice(0, existingIdx + 1);
      } else {
        newStack = [...pathStack, { id: parentId, name: name || parentId }];
      }
    }

    const newPath = buildPathFromStack(newStack);
    set({ pathStack: newStack, currentPath: newPath });

    try { localStorage.setItem('files-last-parent-id', parentId || ''); } catch { /* ignore */ }
    try { localStorage.setItem('files-path-stack', JSON.stringify(newStack)); } catch { /* ignore */ }

    try {
      // Always fetch all nodes from root - Stalwart doesn't support parentId nesting
      const allNodes = await client.listFileNodes(null);
      const prefix = getPathPrefix(newPath);
      const filteredNodes = filterNodesByPrefix(allNodes, prefix);
      const resources = filteredNodes.map(n => nodeToResource(n, prefix));
      // Sort: directories first, then alphabetically
      resources.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      // Prune recent files whose backing node no longer exists on the server
      const { recentFiles } = get();
      // Direct Set build skips the .map(n => n.id) intermediate.
      const existingIds = new Set<string>();
      for (const n of allNodes) existingIds.add(n.id);
      const prunedRecent = recentFiles.filter(r => existingIds.has(r.id));
      if (prunedRecent.length !== recentFiles.length) {
        try { localStorage.setItem('files-recent-files', JSON.stringify(prunedRecent)); } catch { /* ignore */ }
        set({ resources, recentFiles: prunedRecent, isLoading: false });
      } else {
        set({ resources, isLoading: false });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to list directory',
        isLoading: false,
        resources: [],
      });
    }
  },

  navigateByPath: async (path: string) => {
    const { pathStack, navigate } = get();
    if (path === '/') {
      await navigate(null);
      return;
    }
    // Try to match the path against the current pathStack
    const segments = path.split('/').filter(Boolean);
    const targetDepth = segments.length;
    // pathStack[0] is root (id: null, name: ''), subsequent entries match path segments
    if (targetDepth < pathStack.length) {
      const entry = pathStack[targetDepth];
      // Verify the names match
      const stackPath = pathStack.slice(1, targetDepth + 1).map(s => s.name).join('/');
      if (stackPath === segments.join('/')) {
        await navigate(entry.id, entry.name);
        return;
      }
    }
    // Fallback: if we can't resolve, stay at current location
  },

  navigateUp: async () => {
    const { pathStack, navigate } = get();
    if (pathStack.length <= 1) return;
    const parent = pathStack[pathStack.length - 2];
    await navigate(parent.id, parent.name);
  },

  refresh: async () => {
    const { currentParentId, navigate, pathStack } = get();
    const currentEntry = pathStack[pathStack.length - 1];
    await navigate(currentParentId, currentEntry?.name);
  },

  createDirectory: async (name: string) => {
    const { client, currentPath, refresh } = get();
    if (!client) return;

    const prefix = getPathPrefix(currentPath);
    const fullName = prefix + name;
    await client.createFileDirectory(fullName, null);
    await refresh();
  },

  uploadFile: async (file: File) => {
    const { client, currentPath } = get();
    if (!client) return;

    const prefix = getPathPrefix(currentPath);
    const fullName = prefix + file.name;
    const abortController = new AbortController();
    set({ uploadAbortController: abortController });
    set({ uploadProgress: { name: file.name, loaded: 0, total: file.size, current: 1, totalFiles: 1 } });

    try {
      if (abortController.signal.aborted) return;
      const { blobId, type } = await client.uploadBlob(file);
      if (abortController.signal.aborted) return;
      set({ uploadProgress: { name: file.name, loaded: file.size, total: file.size, current: 1, totalFiles: 1 } });
      await client.createFileNode(fullName, blobId, type || file.type || 'application/octet-stream', file.size, null);
    } finally {
      set({ uploadProgress: null, uploadAbortController: null });
    }
  },

  uploadFiles: async (files: File[]) => {
    const { client, currentPath, resources } = get();
    if (!client) return;

    const prefix = getPathPrefix(currentPath);
    const abortController = new AbortController();
    set({ uploadAbortController: abortController });
    const totalFiles = files.length;
    // Direct Set build skips the .map(r => r.name) intermediate.
    const existingNames = new Set<string>();
    for (const r of resources) existingNames.add(r.name);

    for (let i = 0; i < files.length; i++) {
      if (abortController.signal.aborted) break;
      const file = files[i];
      const uniqueName = getUniqueName(file.name, existingNames);
      existingNames.add(uniqueName);
      const fullName = prefix + uniqueName;
      set({ uploadProgress: { name: file.name, loaded: 0, total: file.size, current: i + 1, totalFiles } });

      try {
        const { blobId, type } = await client.uploadBlob(file);
        if (abortController.signal.aborted) break;
        set({ uploadProgress: { name: file.name, loaded: file.size, total: file.size, current: i + 1, totalFiles } });
        await client.createFileNode(fullName, blobId, type || file.type || 'application/octet-stream', file.size, null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') break;
        set({ uploadProgress: null, uploadAbortController: null });
        throw err;
      }
    }
    set({ uploadProgress: null, uploadAbortController: null });
    await get().refresh();
  },

  cancelUpload: () => {
    const { uploadAbortController } = get();
    if (uploadAbortController) {
      uploadAbortController.abort();
      set({ uploadProgress: null, uploadAbortController: null });
    }
  },

  uploadFolder: async (files: File[]) => {
    const { client, currentPath } = get();
    if (!client || files.length === 0) return;

    const prefix = getPathPrefix(currentPath);
    const abortController = new AbortController();
    set({ uploadAbortController: abortController });
    const totalFiles = files.length;

    // Collect unique directory paths from the uploaded folder structure.
    // Was: O(depth²) via `parts.slice(0, i).join('/')` per nesting level —
    // a 5-level upload re-walked 15 array slots per file. Now O(depth) by
    // accumulating the prefix forward.
    const dirs = new Set<string>();
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = relativePath.split('/');
      let cumulative = '';
      for (let i = 0; i < parts.length - 1; i++) {
        cumulative = cumulative ? `${cumulative}/${parts[i]}` : parts[i];
        dirs.add(cumulative);
      }
    }

    // Create directories as flat entries with prefixed names (no parentId
    // nesting — confirmed by the `null` parent below). Since the server
    // treats them as flat, there's no parent-then-child ordering constraint
    // and we can fire all N creates in parallel. Cancellation can't unwind
    // in-flight requests but the user's cancel intent only matters for the
    // *upload* loop below; a handful of empty server-side dirs from a
    // cancelled upload is acceptable. Was: N sequential RTT.
    //
    // Array.from(dirs, fn) walks the Set once into a result array — was
    // [...dirs].map(fn) which allocates an intermediate array first.
    if (!abortController.signal.aborted) {
      await Promise.allSettled(
        Array.from(dirs, dir => {
          const fullDirName = prefix + dir.replace(/\//g, PATH_SEP);
          return client.createFileDirectory(fullDirName, null);
        }),
      );
    }

    // Upload files with full prefixed paths
    for (let i = 0; i < files.length; i++) {
      if (abortController.signal.aborted) break;
      const file = files[i];
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const fullName = prefix + relativePath.replace(/\//g, PATH_SEP);

      set({ uploadProgress: { name: relativePath, loaded: 0, total: file.size, current: i + 1, totalFiles } });

      try {
        const { blobId, type } = await client.uploadBlob(file);
        if (abortController.signal.aborted) break;
        set({ uploadProgress: { name: relativePath, loaded: file.size, total: file.size, current: i + 1, totalFiles } });
        await client.createFileNode(fullName, blobId, type || file.type || 'application/octet-stream', file.size, null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') break;
        set({ uploadProgress: null, uploadAbortController: null });
        throw err;
      }
    }
    set({ uploadProgress: null, uploadAbortController: null });
    await get().refresh();
  },

  deleteResource: async (name: string) => {
    const { client, resources, recentFiles, refresh } = get();
    if (!client) return;

    const resource = resourceByNameLookup(resources).get(name);
    if (!resource) return;

    const idsToDelete = [resource.id];

    // If deleting a folder, also delete all files inside it
    if (resource.isDirectory) {
      const allNodes = await client.listFileNodes(null);
      const folderPrefix = resource.serverName + PATH_SEP;
      for (const node of allNodes) {
        if (node.name.startsWith(folderPrefix)) {
          idsToDelete.push(node.id);
        }
      }
    }

    await client.destroyFileNodes(idsToDelete);
    const deletedIdSet = new Set(idsToDelete);
    const nextRecentFiles = recentFiles.filter(r => !deletedIdSet.has(r.id));
    set({ recentFiles: nextRecentFiles });
    try { localStorage.setItem('files-recent-files', JSON.stringify(nextRecentFiles)); } catch { /* ignore */ }
    await refresh();
  },

  deleteResources: async (names: string[]) => {
    const { client, resources, recentFiles, refresh } = get();
    if (!client) return;

    // O(names × resources) → O(names + resources) via a name-indexed Map.
    const byName = new Map<string, FileResource>();
    for (const r of resources) byName.set(r.name, r);

    const idsToDelete: string[] = [];
    let allNodes: FileNode[] | null = null;

    for (const name of names) {
      const resource = byName.get(name);
      if (!resource) continue;
      idsToDelete.push(resource.id);

      if (resource.isDirectory) {
        if (!allNodes) allNodes = await client.listFileNodes(null);
        const folderPrefix = resource.serverName + PATH_SEP;
        for (const node of allNodes) {
          if (node.name.startsWith(folderPrefix)) {
            idsToDelete.push(node.id);
          }
        }
      }
    }

    if (idsToDelete.length === 0) return;

    await client.destroyFileNodes(idsToDelete);
    const deletedIdSet = new Set(idsToDelete);
    const nextRecentFiles = recentFiles.filter(r => !deletedIdSet.has(r.id));
    set({ selectedResources: new Set() });
    set({ recentFiles: nextRecentFiles });
    try { localStorage.setItem('files-recent-files', JSON.stringify(nextRecentFiles)); } catch { /* ignore */ }
    await refresh();
  },

  renameResource: async (oldName: string, newName: string) => {
    const { client, resources, currentPath, refresh } = get();
    if (!client) return;

    const resource = resourceByNameLookup(resources).get(oldName);
    if (!resource) return;

    const prefix = getPathPrefix(currentPath);
    const oldServerName = resource.serverName;
    const newServerName = prefix + newName;

    await client.updateFileNode(resource.id, { name: newServerName });

    // If renaming a folder, also rename all files inside it. Was a
    // sequential `await` per child node — for a folder with 100 files
    // that's 100 × RTT. Parallel updates drop the wall-time to ~1 RTT
    // (server handles each FileNode/set independently).
    if (resource.isDirectory) {
      const allNodes = await client.listFileNodes(null);
      const oldFolderPrefix = oldServerName + PATH_SEP;
      const newFolderPrefix = newServerName + PATH_SEP;
      const renames: Promise<unknown>[] = [];
      for (const node of allNodes) {
        if (node.name.startsWith(oldFolderPrefix)) {
          const newNodeName = newFolderPrefix + node.name.slice(oldFolderPrefix.length);
          renames.push(client.updateFileNode(node.id, { name: newNodeName }));
        }
      }
      await Promise.all(renames);
    }

    set({
      lastAction: {
        type: 'rename',
        entries: [{ id: resource.id, from: { name: oldServerName }, to: { name: newServerName } }],
        sourceParentId: null,
      },
    });
    await refresh();
  },

  downloadResource: async (name: string) => {
    const { client, resources } = get();
    if (!client) return;

    const resource = resourceByNameLookup(resources).get(name);
    if (!resource?.blobId) return;

    await client.downloadBlob(resource.blobId, resource.name, resource.contentType);
  },

  downloadResources: async (names: string[]) => {
    const { downloadResource } = get();
    for (const name of names) {
      await downloadResource(name);
    }
  },

  getImageUrl: async (name: string) => {
    const { client, resources } = get();
    if (!client) throw new Error('No client');

    const resource = resourceByNameLookup(resources).get(name);
    if (!resource?.blobId) throw new Error('No blob');

    return client.fetchBlobAsObjectUrl(resource.blobId, resource.name, resource.contentType);
  },

  getFileContent: async (name: string) => {
    const { client, resources } = get();
    if (!client) throw new Error('No client');

    const resource = resourceByNameLookup(resources).get(name);
    if (!resource?.blobId) throw new Error('No blob');

    const url = client.getBlobDownloadUrl(resource.blobId, resource.name, resource.contentType);
    const response = await fetch(url, {
      headers: { 'Authorization': client.getAuthHeader() },
    });
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
    const blob = await response.blob();
    return { blob, contentType: resource.contentType || 'application/octet-stream' };
  },

  createTextFile: async (name: string) => {
    const { client, currentPath, refresh } = get();
    if (!client) return;

    const prefix = getPathPrefix(currentPath);
    const fullName = prefix + name;
    const emptyBlob = new File([''], name, { type: 'text/plain' });
    const { blobId } = await client.uploadBlob(emptyBlob);
    await client.createFileNode(fullName, blobId, 'text/plain', 0, null);
    await refresh();
  },

  duplicateResource: async (name: string) => {
    const { client, resources, currentPath, refresh } = get();
    if (!client) return;

    const resource = resourceByNameLookup(resources).get(name);
    if (!resource) return;

    const prefix = getPathPrefix(currentPath);
    const dotIdx = name.lastIndexOf('.');
    const copyName = dotIdx > 0
      ? `${name.substring(0, dotIdx)} (copy)${name.substring(dotIdx)}`
      : `${name} (copy)`;
    const fullCopyName = prefix + copyName;

    await client.copyFileNode(resource.id, fullCopyName, null);
    await refresh();
  },

  moveToFolder: async (names: string[], targetFolder: string) => {
    const { client, resources, refresh } = get();
    if (!client) return;

    // O(names + resources) lookup + parallel JMAP updates (each item
    // targets a unique source id + unique destination path, no
    // contention). Was N sequential RTTs.
    const byName = new Map<string, FileResource>();
    for (const r of resources) byName.set(r.name, r);
    const targetResource = byName.get(targetFolder);
    if (!targetResource || !targetResource.isDirectory) return;

    type Entry = UndoAction['entries'][number];
    const settled = await Promise.allSettled(
      names.map((name): Promise<Entry | null> => {
        const resource = byName.get(name);
        if (!resource) return Promise.resolve(null);
        const newServerName = targetResource.serverName + PATH_SEP + resource.name;
        return client.updateFileNode(resource.id, { name: newServerName })
          .then(() => ({ id: resource.id, from: { name: resource.serverName }, to: { name: newServerName } }));
      }),
    );
    // Was `.flatMap(r => fulfilled ? [r.value] : [])` — allocates a
    // per-result one-or-zero array AND the outer flatMap array. Direct
    // push: N saved sub-arrays for an N-item move.
    const entries: Entry[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) entries.push(r.value);
    }
    set({
      selectedResources: new Set(),
      lastAction: { type: 'move', entries, sourceParentId: null },
    });
    await refresh();
  },

  moveToParent: async (names: string[]) => {
    const { client, resources, currentPath, refresh } = get();
    if (!client || currentPath === '/') return;

    const prefix = getPathPrefix(currentPath);
    // Parent prefix: strip the last segment from the current prefix
    // e.g. "folder∕sub∕" → "folder∕", "folder∕" → ""
    const parentPrefix = prefix.slice(0, prefix.lastIndexOf(PATH_SEP, prefix.length - 2) + 1);

    // Same O(names + resources) lookup + parallel JMAP updates as
    // moveToFolder.
    const byName = new Map<string, FileResource>();
    for (const r of resources) byName.set(r.name, r);

    type Entry = UndoAction['entries'][number];
    const settled = await Promise.allSettled(
      names.map((name): Promise<Entry | null> => {
        const resource = byName.get(name);
        if (!resource) return Promise.resolve(null);
        const newServerName = parentPrefix + resource.name;
        return client.updateFileNode(resource.id, { name: newServerName })
          .then(() => ({ id: resource.id, from: { name: resource.serverName }, to: { name: newServerName } }));
      }),
    );
    // Same single-pass push fusion as moveToFolder.
    const entries: Entry[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) entries.push(r.value);
    }
    set({
      selectedResources: new Set(),
      lastAction: { type: 'move', entries, sourceParentId: null },
    });
    await refresh();
  },

  cutResources: (names: string[]) => {
    set({ clipboard: buildClipboard('cut', names, get()) });
  },

  copyResources: (names: string[]) => {
    set({ clipboard: buildClipboard('copy', names, get()) });
  },

  pasteResources: async () => {
    const { client, currentPath, clipboard, refresh } = get();
    if (!client || !clipboard) return;

    const prefix = getPathPrefix(currentPath);

    // Each item paste hits a unique source id and unique destination name
    // (no contention), so fire all in parallel. Was: N sequential RTT.
    // Pasting 50 items at the JMAP baseline RTT is multi-second sequential
    // vs ~1 RTT parallel. allSettled so one failure doesn't strand the
    // rest — the refresh below will surface the partial result.
    type Entry = UndoAction['entries'][number];
    if (clipboard.mode === 'cut') {
      const settled = await Promise.allSettled(
        clipboard.ids.map((id, i) => {
          const newServerName = prefix + clipboard.names[i];
          const entry: Entry = {
            id,
            from: { name: clipboard.serverNames?.[i] },
            to: { name: newServerName },
          };
          return client.updateFileNode(id, { name: newServerName }).then(() => entry);
        }),
      );
      // Same fusion as moveToFolder.
      const entries: Entry[] = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') entries.push(r.value);
      }
      set({
        clipboard: null,
        lastAction: { type: 'move', entries, sourceParentId: null },
      });
    } else {
      await Promise.allSettled(
        clipboard.ids.map((id, i) => client.copyFileNode(id, prefix + clipboard.names[i], null)),
      );
    }
    await refresh();
  },

  selectResource: (name: string | null) => {
    set({ selectedResources: name ? new Set([name]) : new Set() });
  },

  toggleSelect: (name: string) => {
    const { selectedResources } = get();
    const next = new Set(selectedResources);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    set({ selectedResources: next });
  },

  selectAll: () => {
    const { resources } = get();
    // Direct Set build skips the .map(r => r.name) intermediate.
    const all = new Set<string>();
    for (const r of resources) all.add(r.name);
    set({ selectedResources: all });
  },

  clearSelection: () => {
    set({ selectedResources: new Set() });
  },

  setSelection: (names: Set<string>) => {
    set({ selectedResources: new Set(names) });
  },

  listPath: async (path: string) => {
    const { client } = get();
    if (!client) return [];

    try {
      const allNodes = await client.listFileNodes(null);
      const prefix = getPathPrefix(path);
      const filtered = filterNodesByPrefix(allNodes, prefix);
      return filtered.map(n => nodeToResource(n, prefix));
    } catch {
      return [];
    }
  },

  listByParentId: async (parentId: string | null) => {
    const { client } = get();
    if (!client) return [];
    try {
      const allNodes = await client.listFileNodes(null);

      if (parentId === null) {
        // Single-pass filter+map. Was two arrays.
        const rootResources: FileResource[] = [];
        for (const n of allNodes) {
          if (!n.name.includes('/')) rootResources.push(nodeToResource(n));
        }
        return rootResources;
      }

      // Find the folder node to get its server name
      const folder = allNodes.find(n => n.id === parentId);
      if (!folder) return [];

      const prefix = folder.name + PATH_SEP;
      const filtered = filterNodesByPrefix(allNodes, prefix);
      return filtered.map(n => nodeToResource(n, prefix));
    } catch {
      return [];
    }
  },

  toggleFavorite: (path: string) => {
    const { favorites } = get();
    const next = favorites.includes(path)
      ? favorites.filter(f => f !== path)
      : [...favorites, path];
    set({ favorites: next });
    try { localStorage.setItem('files-favorites', JSON.stringify(next)); } catch { /* ignore */ }
  },

  addRecentFile: (name: string, id: string) => {
    const { recentFiles } = get();
    const entry = { name, id, timestamp: Date.now() };
    const filtered = recentFiles.filter(r => r.id !== id);
    const next = [entry, ...filtered].slice(0, 20);
    set({ recentFiles: next });
    try { localStorage.setItem('files-recent-files', JSON.stringify(next)); } catch { /* ignore */ }
  },

  undoLastAction: async () => {
    const { client, lastAction, refresh } = get();
    if (!client || !lastAction) return;

    // Was sequential N×RTT — undoing a paste of 50 files paid 50 round
    // trips before refresh. Each FileNode/set is independent, so parallel.
    await Promise.allSettled(
      lastAction.entries.map(entry => client.updateFileNode(entry.id, entry.from)),
    );
    set({ lastAction: null });
    await refresh();
  },
}));
