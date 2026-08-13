import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { basename } from "../tabs";
import { formatSelection } from "../sendToChat";

// F6: files that get a rendered/raw preview toggle (rendered by default).
const PREVIEWABLE = /\.(md|markdown|html|htm)$/i;
const IS_HTML = /\.(html|htm)$/i;

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
  gridArea,
  onSendToChat,
  className = "",
  onDirtyChange,
  saveKey,
  searchKey,
}: {
  workspace: string;
  relPath: string;
  active: boolean;
  /** WS6: which split pane's content cell this tab occupies when active. */
  gridArea?: string;
  /**
   * Round 11: send the current selection to the chat composer. Absent means the
   * host cannot receive it (no chat open), so the button is not offered at all.
   */
  onSendToChat?: (text: string) => void;
  /** WS6: extra classes (e.g. the split-pane divider border). */
  className?: string;
  onDirtyChange: (dirty: boolean) => void;
  /** Round 8: resolved shortcut bindings, forwarded to the CodeMirror keymap. */
  saveKey: string;
  searchKey: string;
}): React.JSX.Element {
  const [buf, setBuf] = useState<BufferState>({ kind: "loading" });
  const [content, setContent] = useState("");
  const [docVersion, setDocVersion] = useState(0);
  // F6: md/html render in a preview by default; toggle to raw, editable source.
  // Round 11: the editor's current selection, for "Send to chat".
  const [selection, setSelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const previewable = PREVIEWABLE.test(relPath);
  const isHtml = IS_HTML.test(relPath);
  const [view, setView] = useState<"rendered" | "raw">(previewable ? "rendered" : "raw");
  const showPreview = previewable && view === "rendered";
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

  // External-change detection: compare mtime against disk. F6: driven by the
  // filesystem watch (push) so an agent edit refreshes an open tab immediately —
  // clean buffer reloads silently, a dirty buffer offers Reload / Keep mine.
  // The window/tab-focus poll stays as the fallback (e.g. Linux, where fs.watch
  // recursion is unavailable).
  const bufRef = useRef(buf);
  useEffect(() => {
    bufRef.current = buf;
  }, [buf]);
  const check = useCallback(async (): Promise<void> => {
    const b = bufRef.current;
    if (b.kind !== "text") return;
    const mtime = await window.hv.fsMtime(workspace, relPath).catch(() => b.mtimeMs);
    if (mtime === null) {
      if (dirtyRef.current) setConflict("deleted");
      else setBuf({ kind: "error", message: "This file no longer exists on disk." });
      return;
    }
    if (mtime !== b.mtimeMs) {
      if (dirtyRef.current) setConflict("changed");
      else load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, relPath]);
  useEffect(() => {
    if (active) void check();
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, check]);
  // F6: react to the workspace fs-watch. A single mtime stat per event is cheap
  // (the watch is already debounced), so we recheck on any change in this
  // workspace rather than diffing relDirs against the file's parent.
  useEffect(() =>
    window.hv.onFsChanged((p) => { if (p.workspaceId === workspace) void check(); }),
  [workspace, check]);

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
    <div className={`min-h-0 min-w-0 flex-col ${className} ${active ? "flex" : "hidden"}`} style={gridArea ? { gridArea } : undefined}>
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
          {/* §21 round 12: the bar moved to the TOP, level with the tab strip, so
              a file tab and a chat tab have the same anatomy — the controls used
              to sit along the bottom and the eye had to find them twice. */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b-2 border-line bg-paper text-xs">
            {/* The switcher LEADS, as a two-icon pill with the current view lit.
                A single button whose label was the OTHER state ("Source" while
                showing source) is a riddle; a switch is not. */}
            {previewable && (
              <div className="flex items-center rounded-lg border-2 border-line-strong overflow-hidden shrink-0">
                <button
                  type="button"
                  onClick={() => setView("rendered")}
                  aria-pressed={showPreview}
                  aria-label="Preview rendered"
                  title="Preview rendered"
                  className={`flex items-center px-2 py-1 cursor-pointer ${
                    showPreview ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                  }`}
                >
                  <EyeGlyph />
                </button>
                <button
                  type="button"
                  onClick={() => setView("raw")}
                  aria-pressed={!showPreview}
                  aria-label="Edit source"
                  title="Edit source"
                  className={`flex items-center px-2 py-1 cursor-pointer ${
                    !showPreview ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                  }`}
                >
                  <CodeGlyph />
                </button>
              </div>
            )}
            <span className="font-mono text-ink-soft truncate flex-1" title={relPath}>{relPath}</span>
            {/* Round 11: only with a selection — `@file` already covers whole files,
                so silently sending everything would be the wrong thing. */}
            {onSendToChat && selection && !showPreview && (
              <button
                type="button"
                onClick={() => onSendToChat(formatSelection(relPath, selection.startLine, selection.endLine, selection.text))}
                title={`Send lines ${selection.startLine}–${selection.endLine} to the chat`}
                aria-label={`Send lines ${selection.startLine}–${selection.endLine} to the chat`}
                className="flex items-center rounded-lg border-2 border-line-strong px-2 py-1 text-ink-soft hover:bg-paper-deep/40 hover:text-ink cursor-pointer shrink-0"
              >
                <SendToChatGlyph />
              </button>
            )}
            {/* Save keeps its unsaved state VISIBLE rather than behind a hover —
                an icon that only announces "there is something to save" when
                pointed at is the one case where a tooltip arrives too late. */}
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              title={dirty ? "Save (⌘S) — unsaved changes" : "Save (⌘S)"}
              aria-label="Save (⌘S)"
              data-dirty={dirty ? "true" : "false"}
              className="flex items-center gap-1.5 rounded-lg bg-tangerine text-paper font-bold px-2.5 py-1 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40 transition-all shrink-0"
            >
              <SaveGlyph />
              {dirty && <span className="size-1.5 rounded-full bg-paper" title="Unsaved changes" />}
              {saving && <span>Saving…</span>}
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {showPreview ? (
              isHtml ? (
                // Sandboxed: no scripts, no same-origin. Relative asset/style
                // paths won't resolve (accepted — this is a quick visual check).
                <iframe title={relPath} sandbox="" srcDoc={content} className="h-full w-full bg-white" />
              ) : (
                <div className="h-full overflow-y-auto px-6 py-4">
                  <div className="md max-w-3xl mx-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                </div>
              )
            ) : (
              <Suspense
                fallback={<div className="h-full flex items-center justify-center text-sm text-ink-soft">Opening editor…</div>}
              >
                <CodeEditor path={relPath} doc={content} docVersion={docVersion} onChange={setContent} onSave={() => void save()} onSelectionChange={setSelection} saveKey={saveKey} searchKey={searchKey} />
              </Suspense>
            )}
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

/** F6: preview toggle glyphs (inline SVG — strict self CSP, no icon lib). */
function EyeGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
/** §21 round 12: the bar became icons — these are the two new ones. */
function SaveGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}
function SendToChatGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}
function CodeGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </svg>
  );
}
