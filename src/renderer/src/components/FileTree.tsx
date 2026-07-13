import { useEffect, useState } from "react";

/**
 * W2.2 — docked right pane: lazy workspace file tree.
 *
 * Distinct from ContextPanel (a fixed z-40 OVERLAY drawer): this pane sits in
 * the normal flex flow to the right of the center area, so the drawer cleanly
 * overlays it. One directory level is fetched per expand (hv:fs-list is
 * path-confined main-side; node_modules/.git/dotfiles already filtered there).
 *
 * V2.C2: header refresh (top-left, re-lists every expanded dir) + collapse
 * (top-right, internal — collapses to a slim rail); folder/file glyphs are
 * distinct with per-type file icons (inline SVG, ToolCard ICON_PATHS style).
 */

interface DirState {
  entries: HvFsEntry[] | null; // null = loading
  error?: string;
}

// ── minimal inline icon set (stroke style matches ToolCard's ICON_PATHS) ──
type FileIconKind = "folder" | "folder-open" | "code" | "text" | "config" | "image" | "file";

const FILE_ICON_PATHS: Record<FileIconKind, React.JSX.Element> = {
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  "folder-open": (
    <>
      <path d="M2 7V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1" />
      <path d="M2.5 9h19l-2 10a2 2 0 0 1-2 1.6h-11a2 2 0 0 1-2-1.6z" />
    </>
  ),
  code: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="m9.5 13-2 2 2 2M14.5 13l2 2-2 2" />
    </>
  ),
  text: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>
  ),
  config: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="12" cy="15" r="2" />
      <path d="M12 11.5V13M12 17v1.5M8.9 13.2l1.3.75M13.8 16l1.3.75M15.1 13.2l-1.3.75M10.2 16l-1.3.75" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m3 17 5-5 4 4 3-3 6 6" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
};

const EXT_KIND: Record<string, FileIconKind> = {
  js: "code", jsx: "code", ts: "code", tsx: "code", mjs: "code", cjs: "code",
  py: "code", rb: "code", go: "code", rs: "code", java: "code", c: "code",
  h: "code", cpp: "code", cs: "code", swift: "code", kt: "code", sh: "code",
  css: "code", scss: "code", html: "code", sql: "code", vue: "code",
  md: "text", mdx: "text", txt: "text", rst: "text", log: "text", csv: "text",
  json: "config", yml: "config", yaml: "config", toml: "config", ini: "config",
  xml: "config", env: "config", lock: "config", conf: "config",
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  webp: "image", ico: "image", bmp: "image",
};

function kindFor(name: string): FileIconKind {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "file"; // no extension (or dotfile)
  return EXT_KIND[name.slice(dot + 1).toLowerCase()] ?? "file";
}

function Icon({ kind, className }: { kind: FileIconKind; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-3.5 shrink-0"}
      aria-hidden
    >
      {FILE_ICON_PATHS[kind]}
    </svg>
  );
}

export function FileTree({
  workspace,
  onOpenFile,
}: {
  workspace: string;
  onOpenFile: (relPath: string) => void;
}): React.JSX.Element {
  // Keyed by relative dir path ("" = root). App renders this pane with
  // key={workspace}, so a workspace switch remounts with fresh state.
  const [dirs, setDirs] = useState<Record<string, DirState>>({ "": { entries: null } });
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  // ponytail: collapse is pane-internal (slim rail) — no App wiring needed;
  // the top-bar treeOpen toggle still controls whether the pane exists.
  const [collapsedPane, setCollapsedPane] = useState(false);

  const fetchDir = (relDir: string): void => {
    window.hv
      .fsList(workspace, relDir)
      .then((entries) => setDirs((p) => ({ ...p, [relDir]: { entries } })))
      .catch((err) =>
        setDirs((p) => ({ ...p, [relDir]: { entries: [], error: err instanceof Error ? err.message : String(err) } }))
      );
  };

  const load = (relDir: string): void => {
    setDirs((p) => (p[relDir] ? p : { ...p, [relDir]: { entries: null } }));
    fetchDir(relDir);
  };

  useEffect(() => {
    fetchDir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; key={workspace} remounts
  }, [workspace]);

  /** V2.C2: refresh re-lists every currently-expanded dir; expansion is kept. */
  const refresh = (): void => {
    for (const relDir of expanded) fetchDir(relDir);
  };

  const toggleDir = (relDir: string): void => {
    setExpanded((p) => {
      const next = new Set(p);
      if (next.has(relDir)) {
        next.delete(relDir);
      } else {
        next.add(relDir);
        if (!dirs[relDir]) load(relDir);
      }
      return next;
    });
  };

  const renderDir = (relDir: string, depth: number): React.JSX.Element | null => {
    const state = dirs[relDir];
    if (!state) return null;
    if (state.entries === null) {
      return <div className="px-3 py-1 text-xs text-ink-soft italic" style={{ paddingLeft: depth * 14 + 12 }}>loading…</div>;
    }
    if (state.error) {
      return <div className="px-3 py-1 text-xs text-berry" style={{ paddingLeft: depth * 14 + 12 }}>{state.error}</div>;
    }
    if (state.entries.length === 0) {
      return <div className="px-3 py-1 text-xs text-ink-soft italic" style={{ paddingLeft: depth * 14 + 12 }}>empty</div>;
    }
    return (
      <>
        {state.entries.map((e) => {
          const rel = relDir ? `${relDir}/${e.name}` : e.name;
          if (e.kind === "dir") {
            const open = expanded.has(rel);
            return (
              <div key={rel}>
                <button
                  type="button"
                  onClick={() => toggleDir(rel)}
                  className="w-full flex items-center gap-1.5 px-3 py-1 text-left text-[13px] font-semibold hover:bg-paper-deep/50 cursor-pointer"
                  style={{ paddingLeft: depth * 14 + 12 }}
                >
                  <span className="text-[10px] text-ink-soft w-3 shrink-0" aria-hidden>{open ? "▾" : "▸"}</span>
                  <Icon kind={open ? "folder-open" : "folder"} className="size-3.5 shrink-0 text-honey" />
                  <span className="truncate">{e.name}</span>
                </button>
                {open && renderDir(rel, depth + 1)}
              </div>
            );
          }
          return (
            <button
              key={rel}
              type="button"
              onClick={() => onOpenFile(rel)}
              title={rel}
              className="w-full flex items-center gap-1.5 px-3 py-1 text-left text-[13px] hover:bg-paper-deep/50 hover:text-tangerine-deep cursor-pointer"
              style={{ paddingLeft: depth * 14 + 12 }}
            >
              <span className="w-3 shrink-0" aria-hidden />
              <Icon kind={kindFor(e.name)} className="size-3.5 shrink-0 text-ink-soft" />
              <span className="truncate">{e.name}</span>
            </button>
          );
        })}
      </>
    );
  };

  if (collapsedPane) {
    return (
      <aside className="w-9 shrink-0 border-l-2 border-line bg-paper flex flex-col items-center pt-3">
        <button
          type="button"
          onClick={() => setCollapsedPane(false)}
          title="Expand the file explorer"
          aria-label="Expand file explorer"
          className="text-ink-soft hover:text-ink cursor-pointer"
        >
          <Icon kind="folder" className="size-4 shrink-0" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-l-2 border-line bg-paper flex flex-col min-h-0">
      <div className="px-3 py-3 border-b-2 border-line flex items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          title="Refresh the file tree"
          aria-label="Refresh"
          className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer shrink-0"
        >
          ↻
        </button>
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-soft flex-1 truncate" title={workspace}>
          {workspace.split("/").filter(Boolean).pop()}
        </span>
        <button
          type="button"
          onClick={() => setCollapsedPane(true)}
          title="Collapse the file explorer"
          aria-label="Collapse file explorer"
          className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer shrink-0"
        >
          ⇥
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5">{renderDir("", 0)}</div>
    </aside>
  );
}
