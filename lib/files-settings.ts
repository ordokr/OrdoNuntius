// Small, dep-light home for the files-route view settings (sort order,
// thumbnail toggle, folder layout, etc).
//
// Previously these lived in components/files/files-settings-dialog.tsx
// alongside a FilesSettingsDialog React component that turned out to be
// dead code (zero consumers). Importing the helpers from that file
// dragged the dialog component + its SettingsSection/ToggleSwitch/
// RadioGroup pulls into every consumer's chunk (files route, file-browser,
// settings panel) for no runtime benefit. Splitting the pure helpers
// here keeps the cold-path slim and lets the dialog file be deleted.

export type FolderLayout = "inline" | "sidebar";

export interface FilesSettings {
  defaultViewMode: "list" | "grid";
  showIcons: boolean;
  coloredIcons: boolean;
  defaultSortKey: "name" | "size" | "modified";
  defaultSortDir: "asc" | "desc";
  showHiddenFiles: boolean;
  showThumbnails: boolean;
  folderLayout: FolderLayout;
}

export const DEFAULT_FILES_SETTINGS: FilesSettings = {
  defaultViewMode: "list",
  showIcons: true,
  coloredIcons: true,
  defaultSortKey: "name",
  defaultSortDir: "asc",
  showHiddenFiles: false,
  showThumbnails: true,
  folderLayout: "inline",
};

export function loadFilesSettings(): FilesSettings {
  if (typeof window === "undefined") return DEFAULT_FILES_SETTINGS;
  try {
    const raw = localStorage.getItem("files-settings");
    if (raw) return { ...DEFAULT_FILES_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_FILES_SETTINGS;
}

export function saveFilesSettings(settings: FilesSettings) {
  localStorage.setItem("files-settings", JSON.stringify(settings));
  // Dispatch custom event for same-tab listeners (StorageEvent only fires cross-tab)
  window.dispatchEvent(new CustomEvent("files-settings-changed"));
}
