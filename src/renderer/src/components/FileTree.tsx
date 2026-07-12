import { useEffect, useState } from "react";

/**
 * W2.2 — docked right pane: lazy workspace file tree.
 *
 * Distinct from ContextPanel (a fixed z-40 OVERLAY drawer): this pane sits in
 * the normal flex flow to the right of the center area, so the drawer cleanly
 * overlays it. One directory level is fetched per expand (hv:fs-list is
 * path-confined main-side; node_modules/.git/dotfiles already filtered there).
 */

interface DirState {
  entries: HvFsEntry[] | null; // null = loading
  error?: string;
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

  const load = (relDir: string): void => {
    setDirs((p) => (p[relDir] ? p : { ...p, [relDir]: { entries: null } }));
    window.hv
      .fsList(workspace, relDir)
      .then((entries) => setDirs((p) => ({ ...p, [relDir]: { entries } })))
      .catch((err) =>
        setDirs((p) => ({ ...p, [relDir]: { entries: [], error: err instanceof Error ? err.message : String(err) } }))
      );
  };

  useEffect(() => {
    window.hv
      .fsList(workspace, "")
      .then((entries) => setDirs((p) => ({ ...p, "": { entries } })))
      .catch((err) =>
        setDirs((p) => ({ ...p, "": { entries: [], error: err instanceof Error ? err.message : String(err) } }))
      );
  }, [workspace]);

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
              <span className="truncate">{e.name}</span>
            </button>
          );
        })}
      </>
    );
  };

  return (
    <aside className="w-64 shrink-0 border-l-2 border-line bg-paper flex flex-col min-h-0">
      <div className="px-4 py-3 border-b-2 border-line flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-soft flex-1 truncate" title={workspace}>
          {workspace.split("/").filter(Boolean).pop()}
        </span>
        <button
          type="button"
          onClick={() => { setDirs({ "": { entries: null } }); setExpanded(new Set([""])); load(""); }}
          title="Refresh the file tree"
          className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer"
          aria-label="Refresh"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5">{renderDir("", 0)}</div>
    </aside>
  );
}
