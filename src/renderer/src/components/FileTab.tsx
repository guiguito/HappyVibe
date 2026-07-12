import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { basename } from "../tabs";

// Code-split: CodeMirror lives in its own chunk; chat never pays for it.
const CodeEditor = lazy(() => import("./EditorPane"));

/**
 * W2.2 — one open-file tab: owns the buffer (content, saved baseline, mtime),
 * save, and external-change detection. Stays MOUNTED while the tab is open
 * (hidden when inactive) so unsaved edits survive tab/session/workspace
 * switching; App only tracks the dirty flag for the tab-strip dot.
 */

type BufferState =
  | { kind: "loading" }
  | { kind: "text"; savedContent: string; mtimeMs: number }
  | { kind: "too-large"; size: number }
  | { kind: "binary" }
  | { kind: "error"; message: string };

const fmtSize = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);

export function FileTab({
  workspace,
  relPath,
  active,
  onDirtyChange,
}: {
  workspace: string;
  relPath: string;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
}): React.JSX.Element {
  const [buf, setBuf] = useState<BufferState>({ kind: "loading" });
  const [content, setContent] = useState("");
  const [docVersion, setDocVersion] = useState(0);
  // External change detected while dirty — never silently clobber either side.
  const [conflict, setConflict] = useState<"changed" | "deleted" | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = buf.kind === "text" && content !== buf.savedContent;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const load = (): void => {
    window.hv
      .fsRead(workspace, relPath)
      .then((r) => {
        if (r.kind === "text") {
          setBuf({ kind: "text", savedContent: r.content, mtimeMs: r.mtimeMs });
          setContent(r.content);
          setDocVersion((v) => v + 1);
          setConflict(null);
        } else {
          setBuf(r.kind === "too-large" ? { kind: "too-large", size: r.size } : { kind: "binary" });
        }
      })
      .catch((err) => setBuf({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
  };

  useEffect(load, [workspace, relPath]);

  // External-change detection: compare mtime on window focus and on tab focus.
  const bufRef = useRef(buf);
  useEffect(() => {
    bufRef.current = buf;
  }, [buf]);
  useEffect(() => {
    const check = async (): Promise<void> => {
      const b = bufRef.current;
      if (b.kind !== "text") return;
      const mtime = await window.hv.fsMtime(workspace, relPath).catch(() => b.mtimeMs);
      if (mtime === null) {
        if (dirtyRef.current) setConflict("deleted");
        else setBuf({ kind: "error", message: "This file no longer exists on disk." });
        return;
      }
      if (mtime !== b.mtimeMs) {
        // Clean buffer → reload silently (nothing of the user's to lose).
        // Dirty buffer → offer Reload / Keep mine.
        if (dirtyRef.current) setConflict("changed");
        else load();
      }
    };
    if (active) void check();
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspace, relPath]);

  const save = async (): Promise<void> => {
    if (bufRef.current.kind !== "text" || saving) return;
    setSaving(true);
    try {
      const mtimeMs = await window.hv.fsWrite(workspace, relPath, content);
      setBuf({ kind: "text", savedContent: content, mtimeMs });
      setConflict(null);
    } catch (err) {
      setConflict(null);
      setBuf({ kind: "error", message: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  // Keep mine: adopt the disk mtime as the new baseline so the banner rests;
  // the next explicit Save writes the user's buffer (their stated choice).
  const keepMine = async (): Promise<void> => {
    const mtime = await window.hv.fsMtime(workspace, relPath).catch(() => null);
    setConflict(null);
    setBuf((b) => (b.kind === "text" && mtime !== null ? { ...b, mtimeMs: mtime } : b));
  };

  return (
    <div className={`flex-1 min-h-0 flex-col ${active ? "flex" : "hidden"}`}>
      {conflict && (
        <div className="flex items-center gap-3 px-6 py-2 bg-honey-soft border-b-2 border-honey/60 text-sm font-semibold">
          <span className="flex-1">
            {conflict === "deleted"
              ? "This file was deleted on disk — your unsaved edits are kept. Save recreates it."
              : "This file changed on disk while you have unsaved edits."}
          </span>
          {conflict === "changed" && (
            <button
              type="button"
              onClick={load}
              className="rounded-lg border-2 border-line-strong font-bold text-xs px-3 py-1 hover:bg-paper-deep/40 cursor-pointer"
            >
              Reload from disk
            </button>
          )}
          <button
            type="button"
            onClick={() => void keepMine()}
            className="rounded-lg border-2 border-line-strong font-bold text-xs px-3 py-1 hover:bg-paper-deep/40 cursor-pointer"
          >
            Keep mine
          </button>
        </div>
      )}

      {buf.kind === "text" && (
        <>
          <div className="flex-1 min-h-0">
            <Suspense
              fallback={<div className="h-full flex items-center justify-center text-sm text-ink-soft">Opening editor…</div>}
            >
              <CodeEditor path={relPath} doc={content} docVersion={docVersion} onChange={setContent} onSave={() => void save()} />
            </Suspense>
          </div>
          <div className="flex items-center gap-3 px-4 py-1.5 border-t-2 border-line bg-paper text-xs">
            <span className="font-mono text-ink-soft truncate flex-1" title={relPath}>{relPath}</span>
            {dirty && <span className="font-bold text-tangerine-deep shrink-0">unsaved changes</span>}
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              title="Save (⌘S)"
              className="rounded-lg bg-tangerine text-paper font-bold px-3 py-1 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40 transition-all"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}

      {buf.kind !== "text" && (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center max-w-md text-sm">
            {buf.kind === "loading" && <p className="text-ink-soft">Loading {basename(relPath)}…</p>}
            {buf.kind === "too-large" && (
              <>
                <p className="font-bold text-lg">Too large to edit here</p>
                <p className="text-ink-soft mt-1">
                  {basename(relPath)} is {fmtSize(buf.size)} — the built-in editor caps at 1 MB.
                </p>
              </>
            )}
            {buf.kind === "binary" && (
              <>
                <p className="font-bold text-lg">Binary file</p>
                <p className="text-ink-soft mt-1">{basename(relPath)} doesn&apos;t look like text.</p>
              </>
            )}
            {buf.kind === "error" && (
              <>
                <p className="font-bold text-lg text-berry">Couldn&apos;t open the file</p>
                <p className="text-ink-soft mt-1 break-words">{buf.message}</p>
                <button
                  type="button"
                  onClick={load}
                  className="mt-4 rounded-lg border-2 border-line-strong font-bold text-xs px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
