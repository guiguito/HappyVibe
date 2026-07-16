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
  onClose,
}: {
  workspace: string;
  onOpenFile: (relPath: string) => void;
  /** Round 3 #1: the reduce icon CLOSES the pane completely (App unmounts it),
      rather than minimizing to a rail. */
  onClose: () => void;
}): React.JSX.Element {
  // Keyed by relative dir path ("" = root). App renders this pane with
  // key={workspace}, so a workspace switch remounts with fresh state.
  const [dirs, setDirs] = useState<Record<string, DirState>>({ "": { entries: null } });
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  // Round 4 #7: right-click menu + delete-confirm + details popup.
  const [menu, setMenu] = useState<{ rel: string; kind: "dir" | "file"; x: number; y: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ rel: string; kind: "dir" | "file" } | null>(null);
  const [details, setDetails] = useState<{ rel: string; kind: "dir" | "file"; size: number; mtimeMs: number } | null>(null);
  // WS8: inline new-file / new-folder input, and the drop-hover target dir.
  const [creating, setCreating] = useState<{ parent: string; kind: "file" | "dir" } | null>(null);
  const [newName, setNewName] = useState("");
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const parentOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

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
    // WS8: native fs watching — auto-refresh instead of a manual button. The
    // main watcher reports changed parent dirs; re-list the ones we've expanded.
    void window.hv.watchWorkspace(workspace).catch(() => {});
    const off = window.hv.onFsChanged(({ workspaceId, relDirs }) => {
      if (workspaceId !== workspace) return;
      setExpanded((exp) => {
        for (const d of relDirs) if (exp.has(d)) fetchDir(d);
        return exp;
      });
    });
    return () => {
      off();
      void window.hv.unwatchWorkspace(workspace).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; key={workspace} remounts
  }, [workspace]);

  const collapseAll = (): void => setExpanded(new Set([""]));

  /** WS8: create a file/folder from the inline input; reveal it in the tree. */
  const commitCreate = (): void => {
    if (!creating || !newName.trim()) { setCreating(null); return; }
    const rel = creating.parent ? `${creating.parent}/${newName.trim()}` : newName.trim();
    const fn = creating.kind === "file" ? window.hv.fsCreateFile : window.hv.fsCreateDir;
    void fn(workspace, rel)
      .then(() => {
        setCreating(null);
        setNewName("");
        fetchDir(creating.parent);
        if (creating.kind === "file") onOpenFile(rel);
      })
      .catch((e) => setDropError(e instanceof Error ? e.message : String(e)));
  };

  // WS8: drag & drop — OS→tree (import copy), within-tree (move), tree→center
  // (the center panes read this mime to open the file). Sibling name = relPath.
  const RELPATH_MIME = "application/x-hv-relpath";
  const doImport = (destDir: string, files: FileList): void => {
    const paths = Array.from(files).map((f) => window.hv.getPathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    void window.hv.fsImport(workspace, destDir, paths)
      .then(() => fetchDir(destDir))
      .catch((e) => setDropError(e instanceof Error ? e.message : String(e)));
  };
  const doMove = (src: string, destDir: string): void => {
    if (parentOf(src) === destDir) return; // already there
    void window.hv.fsMove(workspace, src, destDir)
      .then(() => { fetchDir(parentOf(src)); fetchDir(destDir); })
      .catch((e) => setDropError(e instanceof Error ? e.message : String(e)));
  };
  const onDropTo = (destDir: string) => (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setDropDir(null);
    if (e.dataTransfer.files.length) doImport(destDir, e.dataTransfer.files);
    else {
      const src = e.dataTransfer.getData(RELPATH_MIME);
      if (src) doMove(src, destDir);
    }
  };
  const allowDrop = (destDir: string) => (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes(RELPATH_MIME) || e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDropDir(destDir);
    }
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
                  draggable
                  onDragStart={(ev) => ev.dataTransfer.setData(RELPATH_MIME, rel)}
                  onDragOver={allowDrop(rel)}
                  onDragLeave={() => setDropDir((d) => (d === rel ? null : d))}
                  onDrop={onDropTo(rel)}
                  onClick={() => toggleDir(rel)}
                  onContextMenu={(ev) => { ev.preventDefault(); setMenu({ rel, kind: "dir", x: ev.clientX, y: ev.clientY }); }}
                  className={`w-full flex items-center gap-1.5 px-3 py-1 text-left text-[13px] font-semibold hover:bg-paper-deep/50 cursor-pointer ${dropDir === rel ? "bg-honey-soft ring-1 ring-honey" : ""}`}
                  style={{ paddingLeft: depth * 14 + 12 }}
                >
                  <span className="text-[10px] text-ink-soft w-3 shrink-0" aria-hidden>{open ? "▾" : "▸"}</span>
                  <Icon kind={open ? "folder-open" : "folder"} className="size-3.5 shrink-0 text-honey" />
                  <span className="truncate">{e.name}</span>
                </button>
                {creating && creating.parent === rel && open && (
                  <NewEntryInput depth={depth + 1} kind={creating.kind} value={newName} onChange={setNewName} onCommit={commitCreate} onCancel={() => setCreating(null)} />
                )}
                {open && renderDir(rel, depth + 1)}
              </div>
            );
          }
          return (
            <button
              key={rel}
              type="button"
              draggable
              onDragStart={(ev) => ev.dataTransfer.setData(RELPATH_MIME, rel)}
              onClick={() => onOpenFile(rel)}
              onContextMenu={(ev) => { ev.preventDefault(); setMenu({ rel, kind: "file", x: ev.clientX, y: ev.clientY }); }}
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

  const startCreate = (kind: "file" | "dir"): void => {
    setExpanded((p) => new Set(p).add("")); // root always open
    setNewName("");
    setDropError(null);
    setCreating({ parent: "", kind });
  };

  return (
    <aside className="w-64 shrink-0 border-l-2 border-line bg-paper flex flex-col min-h-0">
      <div className="px-3 py-3 border-b-2 border-line flex items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-soft flex-1 truncate" title={workspace}>
          {workspace.split("/").filter(Boolean).pop()}
        </span>
        <HeaderBtn onClick={() => startCreate("file")} title="New file" label="New file"><NewFileGlyph /></HeaderBtn>
        <HeaderBtn onClick={() => startCreate("dir")} title="New folder" label="New folder"><NewFolderGlyph /></HeaderBtn>
        <HeaderBtn onClick={collapseAll} title="Collapse all folders" label="Collapse all"><CollapseGlyph /></HeaderBtn>
        <HeaderBtn onClick={onClose} title="Close the file explorer" label="Close file explorer"><span className="text-xs font-bold">⇥</span></HeaderBtn>
      </div>
      {dropError && (
        <div className="px-3 py-1.5 text-xs text-berry bg-berry-soft border-b-2 border-berry/40 flex items-center gap-2">
          <span className="flex-1">{dropError}</span>
          <button type="button" onClick={() => setDropError(null)} className="font-bold cursor-pointer">✕</button>
        </div>
      )}
      <div
        className={`flex-1 overflow-y-auto py-1.5 ${dropDir === "" ? "bg-honey-soft/40" : ""}`}
        onDragOver={allowDrop("")}
        onDragLeave={() => setDropDir((d) => (d === "" ? null : d))}
        onDrop={onDropTo("")}
      >
        {creating && creating.parent === "" && (
          <NewEntryInput depth={0} kind={creating.kind} value={newName} onChange={setNewName} onCommit={commitCreate} onCancel={() => setCreating(null)} />
        )}
        {renderDir("", 0)}
      </div>

      {/* Round 4 #7: right-click context menu. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 min-w-36 rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm"
            style={{ top: menu.y, left: menu.x }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer"
              onClick={() => { if (menu.kind === "file") onOpenFile(menu.rel); else toggleDir(menu.rel); setMenu(null); }}
            >
              Open
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer text-berry"
              onClick={() => { setConfirmDel({ rel: menu.rel, kind: menu.kind }); setMenu(null); }}
            >
              Delete…
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer"
              onClick={() => {
                const { rel, kind } = menu;
                setMenu(null);
                void window.hv.fsStat(workspace, rel).then((s) => setDetails({ rel, kind, size: s.size, mtimeMs: s.mtimeMs }));
              }}
            >
              Details
            </button>
          </div>
        </>
      )}

      {/* Delete confirm — moves to the OS Trash (recoverable), never a hard delete. */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-md rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-ink mb-1">Move {confirmDel.kind === "dir" ? "folder" : "file"} to Trash?</div>
            <p className="text-sm text-ink-soft mb-4">
              <span className="font-mono break-all">{confirmDel.rel}</span> will be moved to your system Trash — you can restore it from there.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDel(null)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { rel } = confirmDel;
                  setConfirmDel(null);
                  void window.hv.fsTrash(workspace, rel).then(() => fetchDir(parentOf(rel))).catch(() => {});
                }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Details popup. */}
      {details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setDetails(null)}>
          <div className="w-full max-w-sm rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-ink mb-3">{details.rel.split("/").pop()}</div>
            <dl className="text-sm grid grid-cols-[5rem_1fr] gap-y-1.5">
              <dt className="text-ink-soft font-bold">Kind</dt><dd>{details.kind === "dir" ? "Folder" : "File"}</dd>
              <dt className="text-ink-soft font-bold">Size</dt><dd>{formatBytes(details.size)}</dd>
              <dt className="text-ink-soft font-bold">Modified</dt><dd>{new Date(details.mtimeMs).toLocaleString()}</dd>
              <dt className="text-ink-soft font-bold">Path</dt><dd className="font-mono text-xs break-all">{details.rel}</dd>
            </dl>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setDetails(null)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function HeaderBtn({ onClick, title, label, children }: { onClick: () => void; title: string; label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={label} className="text-ink-soft hover:text-ink cursor-pointer shrink-0 p-0.5">
      {children}
    </button>
  );
}

/** WS8: inline name input for a new file/folder. */
function NewEntryInput({
  depth, kind, value, onChange, onCommit, onCancel,
}: {
  depth: number; kind: "file" | "dir"; value: string;
  onChange: (v: string) => void; onCommit: () => void; onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1" style={{ paddingLeft: depth * 14 + 12 }}>
      <span className="w-3 shrink-0" aria-hidden />
      <Icon kind={kind === "dir" ? "folder" : "file"} className="size-3.5 shrink-0 text-ink-soft" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(); else if (e.key === "Escape") onCancel(); }}
        onBlur={onCommit}
        placeholder={kind === "dir" ? "folder name" : "file name"}
        className="flex-1 min-w-0 bg-paper border-2 border-tangerine rounded px-1 py-0.5 text-[13px] focus:outline-none"
      />
    </div>
  );
}

function NewFileGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M12 12v6M9 15h6" />
    </svg>
  );
}

function NewFolderGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

function CollapseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m7 13 5-5 5 5M7 18l5-5 5 5" />
    </svg>
  );
}
