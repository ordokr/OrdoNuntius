import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Mailbox, UNIFIED_MAILBOX_IDS } from "./jmap/types";
import type { UnifiedMailboxRole } from "./jmap/types";
import { debug, isDebugEnabled } from "./debug";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Zero-allocation "first value" picker for Record-shaped maps. Replaces
 * `Object.values(rec)[0]` which builds the full values-array just to read
 * index 0. Returns undefined on empty/null/undefined input.
 *
 * Useful for "pick the primary alert/location/etc." style code that
 * doesn't care which entry it gets, only that there is one.
 */
export function firstValue<T>(rec: Record<string, T> | null | undefined): T | undefined {
  if (!rec) return undefined;
  for (const k in rec) return rec[k];
  return undefined;
}

/**
 * Returns true when the record has at least one own key. Replaces the
 * ubiquitous `Object.keys(rec).length > 0` pattern which allocates a
 * keys array just to check size — wasteful in per-row render paths
 * (`hasParticipants`, `hasShareWith`, etc.).
 *
 * for-in early-return: walks at most one key. Mirror of `firstValue` but
 * returns a boolean.
 */
export function hasAnyKey<T>(rec: Record<string, T> | null | undefined): rec is Record<string, T> {
  if (!rec) return false;
  for (const _ in rec) return true;
  return false;
}

/**
 * Split a comma-separated string into trimmed non-empty parts.
 *
 * Replaces the ubiquitous `s.split(',').map(x => x.trim()).filter(Boolean)`
 * chain — which allocates THREE intermediate arrays (split, map, filter)
 * for one final result. Single push loop = 1 array. Hot enough in the
 * email composer (~15 call sites, recomputed on every keystroke).
 */
export function splitTrimmed(s: string, separator: string = ','): string[] {
  const out: string[] = [];
  for (const part of s.split(separator)) {
    const t = part.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Return the local part of an email address (everything before the first
 * `@`), or the whole string when there is no `@`. Replaces `email.split('@')[0]`
 * which allocates an array just to read its first slot — wasteful in
 * per-row render paths like the thread list and email viewer.
 */
export function localPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: construct a v4 UUID from crypto.getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Cached RelativeTimeFormat — constructing it is non-trivial (locale
// data table lookup) and formatDate is called once per visible email
// row, so a fresh instance per call would burn measurable CPU on a
// virtualizer scroll. `short` style produces "5 min. ago" in English,
// "il y a 5 min" in French, "5분 전" in Korean — the locale-aware
// replacement for the previous hardcoded "5m ago".
//
// The cache key is the current document language (set by next-intl
// after a language switch). When the user changes locale, the next
// formatDate call rebuilds the formatter for the new locale.
let _cachedRtf: { rtf: Intl.RelativeTimeFormat; lang: string } | null = null;
function getRtf(): Intl.RelativeTimeFormat {
  const lang = typeof document !== "undefined" ? document.documentElement.lang || "" : "";
  if (_cachedRtf && _cachedRtf.lang === lang) return _cachedRtf.rtf;
  const rtf = new Intl.RelativeTimeFormat(lang || undefined, { numeric: "auto", style: "short" });
  _cachedRtf = { rtf, lang };
  return rtf;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  // `numeric: 'auto'` lets the platform render "now" / "yesterday" /
  // "今" / "ahora" idiomatically when the value lands on a boundary.
  // Was hardcoded English ("Just now", "5m ago", "3h ago", "2d ago").
  const rtf = getRtf();
  if (minutes < 1) return rtf.format(0, "minute");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (hours < 24) return rtf.format(-hours, "hour");
  if (days < 7) return rtf.format(-days, "day");

  // Was hardcoded `"en-US"` — every email older than 7 days rendered
  // with US month names regardless of the user's locale. `undefined`
  // lets Intl pick up the document/browser locale.
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/**
 * Format a date/time string respecting the user's 12h/24h time format preference.
 */
export function formatDateTime(
  date: Date | string,
  timeFormat: '12h' | '24h',
  options?: {
    weekday?: 'short' | 'long';
    year?: 'numeric';
    month?: 'short' | 'long';
    day?: 'numeric';
    second?: '2-digit';
    timeZoneName?: 'short';
    dateOnly?: boolean;
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return typeof date === 'string' ? date : '';

  const localeOptions: Intl.DateTimeFormatOptions = {};
  if (options?.weekday) localeOptions.weekday = options.weekday;
  if (options?.year) localeOptions.year = options.year;
  if (options?.month) localeOptions.month = options.month;
  if (options?.day) localeOptions.day = options.day;

  if (!options?.dateOnly) {
    localeOptions.hour = '2-digit';
    localeOptions.minute = '2-digit';
    localeOptions.hour12 = timeFormat === '12h';
    if (options?.second) localeOptions.second = options.second;
    if (options?.timeZoneName) localeOptions.timeZoneName = options.timeZoneName;
  }

  return d.toLocaleString(undefined, localeOptions);
}

// Marketing emails pad the preheader with whitespace, format chars (soft
// hyphens, zero-width chars, BOM, directional marks) and combining marks
// (e.g. U+034F) to push real content past the preview window. Strip them all.
// \p{Cf} = Format, \p{Mn} = combining marks; \s covers figure space, NBSP, etc.
const LEADING_INVISIBLE_RE = /^[\s\p{Cf}\p{Mn}]+/u;
// After stripping, a server-side truncation indicator like "..." may be all
// that's left. Treat that as no preview so callers can fall back.
const ONLY_PUNCTUATION_RE = /^[.\u2026\s]+$/;

export function stripInvisibleLeading(text: string): string {
  const stripped = text.replace(LEADING_INVISIBLE_RE, '');
  if (ONLY_PUNCTUATION_RE.test(stripped)) return '';
  return stripped;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + "...";
}

// Module-level constants — `sizes` was rebuilt per call; precomputing
// Math.log(1024) removes the per-call divisor recomputation.
const FILE_SIZE_UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB'] as const;
const LOG_1024 = Math.log(1024);

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / LOG_1024);
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + FILE_SIZE_UNITS[i];
}

// Types for mailbox tree
export interface MailboxNode extends Mailbox {
  children: MailboxNode[];
  depth: number;
}

// Role priority for mailbox ordering (lower number = higher priority)
const ROLE_PRIORITY: Record<string, number> = {
  inbox: 0,
  drafts: 1,
  sent: 2,
  archive: 3,
  junk: 4,
  spam: 4, // Treat spam same as junk
  trash: 5,
};

// Deduplicate mailboxes (e.g., "Sent" vs "Sent Mail")
function deduplicateMailboxes(mailboxes: Mailbox[]): Mailbox[] {
  const result: Mailbox[] = [];
  const removed: { id: string; name: string; matchedRole: string; parentId?: string }[] = [];

  // Was: two separate `forEach` passes over `mailboxes` to build
  // rolesByAccount and referencedParentIds. Fused into one pre-pass.
  const rolesByAccount = new Map<string, Mailbox[]>();
  const referencedParentIds = new Set<string>();
  for (const mb of mailboxes) {
    if (mb.role) {
      const key = mb.accountId || '';
      let group = rolesByAccount.get(key);
      if (!group) {
        group = [];
        rolesByAccount.set(key, group);
      }
      group.push(mb);
    }
    if (mb.parentId) referencedParentIds.add(mb.parentId);
  }

  // Filter out duplicates scoped to the same account
  for (const mb of mailboxes) {
    // If this mailbox has a role, always keep it
    if (mb.role) {
      result.push(mb);
      continue;
    }

    // Never deduplicate nested mailboxes - only root-level folders can be
    // duplicates of role-based mailboxes. Removing a nested folder that happens
    // to share a name with a role folder (e.g. a subfolder named "Sent") would
    // orphan its children to root level. (GitHub #118)
    if (mb.parentId) {
      result.push(mb);
      continue;
    }

    // Check if this root-level mailbox is a duplicate of a role-based mailbox in the SAME account
    const accountKey = mb.accountId || '';
    const accountRoles = rolesByAccount.get(accountKey) || [];
    const lowerName = mb.name.toLowerCase();
    const matchedRole = accountRoles.find(roleMb => {
      const roleLowerName = roleMb.name.toLowerCase();
      // Check for common duplicates: "Sent Mail" vs "Sent", etc.
      return lowerName.includes(roleLowerName) || roleLowerName.includes(lowerName);
    });
    const isDuplicate = !!matchedRole;

    // Only keep if not a duplicate
    if (!isDuplicate) {
      result.push(mb);
    } else {
      removed.push({ id: mb.id, name: mb.name, matchedRole: matchedRole!.name, parentId: mb.parentId });
      // Warn if this removed mailbox is a parent of other mailboxes (orphan risk)
      if (referencedParentIds.has(mb.id)) {
        debug.warn('jmap', `[Mailbox Tree] Deduplication removed mailbox "${mb.name}" (id: ${mb.id}) which is a parent of other mailboxes. ` +
          `Matched role mailbox: "${matchedRole!.name}" (role: ${matchedRole!.role}). ` +
          `Children referencing parentId "${mb.id}" will be orphaned to root level.`
        );
      }
    }
  }

  if (removed.length > 0) {
    debug.log('jmap', `[Mailbox Tree] Deduplication removed ${removed.length} mailbox(es):`, removed);
  }

  return result;
}

// Memoize the tree against the input array's identity. 6 separate
// components (sidebar, email-viewer, email-context-menu, settings/folder,
// filter-rule-modal, etc.) call this with the same mailboxes array; each
// previously rebuilt the whole tree (dedup + 2-pass node wiring + depth
// recursion) independently. WeakMap is freed via GC when the store
// replaces the mailboxes array. Consumers that filter/transform the tree
// copy node objects via spread — verified no consumer mutates the
// returned children arrays.
const _mailboxTreeCache = new WeakMap<readonly Mailbox[], MailboxNode[]>();

// Build a hierarchical tree structure from flat mailbox array
export function buildMailboxTree(mailboxes: Mailbox[]): MailboxNode[] {
  const cached = _mailboxTreeCache.get(mailboxes);
  if (cached) return cached;
  const tree = buildMailboxTreeUncached(mailboxes);
  _mailboxTreeCache.set(mailboxes, tree);
  return tree;
}

function buildMailboxTreeUncached(mailboxes: Mailbox[]): MailboxNode[] {
  debug.log('jmap', `[Mailbox Tree] Building tree from ${mailboxes.length} mailboxes`);

  // Deduplicate mailboxes first
  const deduplicated = deduplicateMailboxes(mailboxes);

  if (deduplicated.length !== mailboxes.length) {
    debug.log('jmap', `[Mailbox Tree] After deduplication: ${deduplicated.length} mailboxes (removed ${mailboxes.length - deduplicated.length})`);
  }

  // Single-pass partition + node creation. Was: two `.filter()` walks
  // (own/shared) AND a separate `.forEach()` to populate the mailboxMap.
  // Three walks → one. The first-pass "create node" loop populates own +
  // mailboxMap atomically.
  const ownMailboxes: Mailbox[] = [];
  const sharedMailboxes: Mailbox[] = [];
  const mailboxMap = new Map<string, MailboxNode>();
  for (const mailbox of deduplicated) {
    if (mailbox.isShared) {
      sharedMailboxes.push(mailbox);
    } else {
      ownMailboxes.push(mailbox);
      mailboxMap.set(mailbox.id, { ...mailbox, children: [], depth: 0 });
    }
  }
  const rootMailboxes: MailboxNode[] = [];

  // Helper to recursively recalculate depths after tree is built
  const recalculateDepths = (nodes: MailboxNode[], baseDepth: number) => {
    for (const node of nodes) {
      node.depth = baseDepth;
      if (node.children.length > 0) {
        recalculateDepths(node.children, baseDepth + 1);
      }
    }
  };

  // Second pass: build tree structure for own mailboxes
  const orphanedMailboxes: { id: string; name: string; parentId: string }[] = [];
  for (const mailbox of ownMailboxes) {
    const node = mailboxMap.get(mailbox.id)!;

    if (mailbox.parentId && mailboxMap.has(mailbox.parentId)) {
      const parent = mailboxMap.get(mailbox.parentId)!;
      parent.children.push(node);
    } else {
      // Root level mailbox or orphaned mailbox
      if (mailbox.parentId) {
        orphanedMailboxes.push({ id: mailbox.id, name: mailbox.name, parentId: mailbox.parentId });
      }
      rootMailboxes.push(node);
    }
  }

  if (orphanedMailboxes.length > 0) {
    debug.warn('jmap', `[Mailbox Tree] ${orphanedMailboxes.length} orphaned mailbox(es) moved to root level (missing parent):`,
      orphanedMailboxes
    );
  }

  // Third pass: correctly calculate depths from the root down
  recalculateDepths(rootMailboxes, 0);

  // Log tree depth statistics — gated behind isDebugEnabled because the
  // maxDepth recursion walks every node, which we don't want to pay for
  // when debug is off.
  if (isDebugEnabled('jmap')) {
    const maxDepth = (nodes: MailboxNode[]): number => {
      let max = 0;
      for (const node of nodes) {
        max = Math.max(max, node.depth);
        if (node.children.length > 0) max = Math.max(max, maxDepth(node.children));
      }
      return max;
    };
    debug.log('jmap', `[Mailbox Tree] Built tree: ${rootMailboxes.length} root nodes, ` +
      `max depth: ${maxDepth(rootMailboxes)}, ` +
      `total own: ${ownMailboxes.length}, shared: ${sharedMailboxes.length}`
    );
  }

  // For each shared account, create a virtual top-level account node
  // containing that account's mailboxes. This places shared accounts as
  // peers of the primary account's folders rather than nesting them under
  // a "Shared Folders" wrapper. (GitHub #151)
  if (sharedMailboxes.length > 0) {
    // Group shared mailboxes by account
    const accountGroups = new Map<string, Mailbox[]>();
    for (const mb of sharedMailboxes) {
      const accountId = mb.accountId || 'unknown';
      let group = accountGroups.get(accountId);
      if (!group) {
        group = [];
        accountGroups.set(accountId, group);
      }
      group.push(mb);
    }

    for (const [accountId, accountMailboxes] of accountGroups) {
      // Create nodes for this account's mailboxes
      const accountMailboxMap = new Map<string, MailboxNode>();
      const accountRootNodes: MailboxNode[] = [];

      for (const mailbox of accountMailboxes) {
        accountMailboxMap.set(mailbox.id, {
          ...mailbox,
          children: [],
          depth: 0,
        });
      }

      // Build tree for this account's mailboxes
      for (const mailbox of accountMailboxes) {
        const node = accountMailboxMap.get(mailbox.id)!;

        if (mailbox.parentId && accountMailboxMap.has(mailbox.parentId)) {
          const parent = accountMailboxMap.get(mailbox.parentId)!;
          parent.children.push(node);
        } else {
          accountRootNodes.push(node);
        }
      }

      // Render the shared account's mailboxes flush with primary-account
      // mailboxes (depth 0) so the indents line up. The virtual account
      // node visually wraps them via its chevron/header rather than via
      // an extra indent level. (GitHub #151)
      recalculateDepths(accountRootNodes, 0);

      // Create virtual account folder node at top level (depth 0).
      // Fuse the two `.reduce()` walks (totalEmails + unreadEmails) into
      // one pass — was 2 walks of accountMailboxes producing two sums.
      const accountName = accountMailboxes[0]?.accountName || accountId;
      let accountTotal = 0;
      let accountUnread = 0;
      for (const mb of accountMailboxes) {
        accountTotal += mb.totalEmails;
        accountUnread += mb.unreadEmails;
      }
      const accountNode: MailboxNode = {
        id: `shared-account-${accountId}`,
        name: accountName,
        sortOrder: 1000, // After all own folders
        totalEmails: accountTotal,
        unreadEmails: accountUnread,
        totalThreads: 0,
        unreadThreads: 0,
        myRights: {
          mayReadItems: true,
          mayAddItems: false,
          mayRemoveItems: false,
          maySetSeen: false,
          maySetKeywords: false,
          mayCreateChild: false,
          mayRename: false,
          mayDelete: false,
          maySubmit: false,
        },
        isSubscribed: true,
        accountId: accountId,
        accountName: accountName,
        isShared: true,
        children: accountRootNodes,
        depth: 0,
      };

      rootMailboxes.push(accountNode);
    }
  }

  // Smart multi-level sorting
  const sortNodes = (nodes: MailboxNode[]) => {
    nodes.sort((a, b) => {
      // 1. Priority: Own folders before shared folders
      if (a.isShared !== b.isShared) {
        return a.isShared ? 1 : -1;
      }

      // 2. Priority: Role-based ordering (inbox first, trash last, etc.)
      const aPriority = a.role ? (ROLE_PRIORITY[a.role] ?? 999) : 999;
      const bPriority = b.role ? (ROLE_PRIORITY[b.role] ?? 999) : 999;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // 3. Priority: Year folders (e.g., "2025", "2024") sorted numerically descending
      const aIsYear = /^\d{4}$/.test(a.name);
      const bIsYear = /^\d{4}$/.test(b.name);
      if (aIsYear && bIsYear) {
        return parseInt(b.name) - parseInt(a.name); // Descending: 2025, 2024, 2023...
      }

      // 4. Fallback: Server sortOrder
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      // 5. Fallback: Alphabetical by name
      return a.name.localeCompare(b.name);
    });

    // Recursively sort children
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(rootMailboxes);

  return rootMailboxes;
}

/**
 * Builds virtual MailboxNode entries for unified mailbox roles with aggregated counts.
 */
export function buildUnifiedMailboxNodes(
  counts: Array<{ role: UnifiedMailboxRole; unreadEmails: number; totalEmails: number }>,
): MailboxNode[] {
  return counts.map((count) => ({
    id: UNIFIED_MAILBOX_IDS[count.role],
    name: count.role, // Display name is handled by i18n in the component
    role: count.role,
    parentId: undefined,
    sortOrder: 0,
    totalEmails: count.totalEmails,
    unreadEmails: count.unreadEmails,
    totalThreads: 0,
    unreadThreads: 0,
    myRights: {
      mayReadItems: true,
      mayAddItems: false,
      mayRemoveItems: false,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: false,
      mayRename: false,
      mayDelete: false,
      maySubmit: false,
    },
    isSubscribed: true,
    children: [],
    depth: 0,
  }));
}

// Flatten a mailbox tree for rendering with proper depth info
export function flattenMailboxTree(nodes: MailboxNode[]): MailboxNode[] {
  const result: MailboxNode[] = [];

  const traverse = (nodes: MailboxNode[], depth: number = 0) => {
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.children.length > 0) {
        traverse(node.children, depth + 1);
      }
    }
  };

  traverse(nodes);
  return result;
}

export function getMailboxPath(
  mailbox: Pick<Mailbox, 'id' | 'name' | 'parentId'>,
  allMailboxes: Array<Pick<Mailbox, 'id' | 'name' | 'parentId'>>,
  separator = ' › ',
): string {
  // Direct Map build skips the `allMailboxes.map(m => [m.id, m])`
  // intermediate array + per-tuple sub-arrays. The path walk usually
  // touches 0-3 ancestors so the Map's amortization is small, but the
  // setup allocation isn't free.
  const byId = new Map<string, Pick<Mailbox, 'id' | 'name' | 'parentId'>>();
  for (const m of allMailboxes) byId.set(m.id, m);
  const names: string[] = [mailbox.name];
  const visited = new Set<string>([mailbox.id]);
  let parentId = mailbox.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(separator);
}