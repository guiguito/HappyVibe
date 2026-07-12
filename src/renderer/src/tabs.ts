/**
 * W2.2 — center-tab state (chat + open files) and card-path resolution.
 * Pure helpers, unit-tested in tests/tabs.test.ts.
 *
 * Tabs are PER-WORKSPACE (Record<workspaceId, WorkspaceTabs> in App): switching
 * between sessions of one workspace keeps the tabs; switching workspaces swaps
 * to that workspace's own set. `active === null` means the chat tab.
 */

export interface WorkspaceTabs {
  /** Open files as workspace-relative paths, in open order. */
  files: string[];
  /** Active file tab, or null for the chat tab (always first, never closable). */
  active: string | null;
}

export const emptyTabs: WorkspaceTabs = { files: [], active: null };

/** Open (or focus) a file tab. */
export function openFile(t: WorkspaceTabs, relPath: string): WorkspaceTabs {
  return {
    files: t.files.includes(relPath) ? t.files : [...t.files, relPath],
    active: relPath,
  };
}

/** Close a file tab; when it was active, focus the right neighbor, else left, else chat. */
export function closeFile(t: WorkspaceTabs, relPath: string): WorkspaceTabs {
  const i = t.files.indexOf(relPath);
  if (i < 0) return t;
  const files = t.files.filter((f) => f !== relPath);
  const active = t.active !== relPath ? t.active : files[i] ?? files[i - 1] ?? null;
  return { files, active };
}

/** Focus a tab (a rel path, or null for chat). */
export function activateTab(t: WorkspaceTabs, target: string | null): WorkspaceTabs {
  return target === null || t.files.includes(target) ? { ...t, active: target } : t;
}

/** Stable key for the per-file editor buffer map. */
export const bufferKey = (workspaceId: string, relPath: string): string => `${workspaceId}\0${relPath}`;

export const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/**
 * Resolve a path surfaced on a tool/diff card against the session workspace.
 * Returns a normalized workspace-relative path, or null when the path points
 * outside the workspace (not openable — link is not rendered).
 */
export function resolveCardPath(workspace: string, raw: string): string | null {
  const ws = workspace.replace(/\/+$/, "");
  let rel: string;
  if (raw.startsWith("/")) {
    if (!raw.startsWith(ws + "/")) return null;
    rel = raw.slice(ws.length + 1);
  } else {
    rel = raw;
  }
  // Normalize "." / ".." segments; a hop above the workspace root escapes.
  const out: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}
