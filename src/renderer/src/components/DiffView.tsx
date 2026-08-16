import { useState } from "react";
import { countDiffLines, statusGlyph } from "../gitui";

/**
 * §29 — the diff renderer, shared by the Changes panel and the file tab's
 * Changes mode.
 *
 * **One diff engine per surface, and this one's is git.** The tool cards use the
 * js `diff` library (diffs.ts) and keep it: they render an edit's own
 * before/after, which git never saw. But git and that library can split the same
 * change into DIFFERENT hunks — so if the panel rendered js-diff hunks and undid
 * through `git apply`, the hunk you see would not be the hunk you undo. Every
 * hunk here comes from main already parsed out of git's unified output, and
 * `hunk.raw` is fed back verbatim.
 */

export interface DiffViewProps {
  files: HvFileDiff[];
  /** Undo one hunk. Absent = read-only (history, a commit's diff). */
  onUndoHunk?: (file: HvFileDiff, hunk: HvDiffHunk) => void;
  onUndoFile?: (file: HvFileDiff) => void;
  /** Untracked files are DISCARDED, not undone — the caller says which. */
  isUntracked?: (path: string) => boolean;
  emptyLabel?: string;
  /**
   * Start each file collapsed. History passes false: a commit routinely touches
   * a dozen files, and expanding all of them buries the commit list you were
   * reading a moment ago under a wall of green and red. Everywhere else the diff
   * IS what you came for, so it stays open.
   */
  defaultOpen?: boolean;
}

export function DiffView({
  files,
  onUndoHunk,
  onUndoFile,
  isUntracked,
  emptyLabel,
  defaultOpen = true,
}: DiffViewProps): React.JSX.Element {
  if (!files.length) {
    return <div className="p-4 text-xs text-ink-soft">{emptyLabel ?? "No changes to show."}</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {files.map((f) => (
        <FileDiffBlock
          key={`${f.path}:${f.origPath ?? ""}`}
          file={f}
          onUndoHunk={onUndoHunk}
          onUndoFile={onUndoFile}
          untracked={isUntracked?.(f.path) ?? false}
          defaultOpen={defaultOpen}
        />
      ))}
    </div>
  );
}

function FileDiffBlock({
  file,
  onUndoHunk,
  onUndoFile,
  untracked,
  defaultOpen,
}: {
  file: HvFileDiff;
  onUndoHunk?: (file: HvFileDiff, hunk: HvDiffHunk) => void;
  onUndoFile?: (file: HvFileDiff) => void;
  untracked: boolean;
  defaultOpen: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const { additions, deletions } = countDiffLines(file.hunks);
  return (
    <div className="rounded-xl border-2 border-line bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b-2 border-line bg-paper-deep">
        {/* Chevron AND name are one control: a collapsed row is a target you
            aim at by its filename, and a 14px chevron is not that target. The
            counts stay outside it so they read as data, not as a button. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left text-ink-soft hover:text-ink cursor-pointer"
          aria-expanded={open}
          title={open ? "Collapse" : "Expand"}
        >
          <svg viewBox="0 0 24 24" className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="font-mono text-[11px] font-bold truncate text-ink" title={file.path}>
            {file.origPath && file.origPath !== file.path && (
              <span className="text-ink-soft">{file.origPath} → </span>
            )}
            {file.path}
          </span>
        </button>
        {/* Binary files have no lines to count — an honest nothing beats +0 −0. */}
        {!file.binary && (additions > 0 || deletions > 0) && (
          <span className="shrink-0 text-[10px] tabular-nums" title={`${additions} added, ${deletions} removed`}>
            {additions > 0 && <span className="text-leaf">+{additions}</span>}
            {additions > 0 && deletions > 0 && " "}
            {deletions > 0 && <span className="text-berry">−{deletions}</span>}
          </span>
        )}
        {onUndoFile && (
          <button
            type="button"
            onClick={() => onUndoFile(file)}
            className="shrink-0 rounded-lg border-2 border-line bg-card px-2 py-0.5 text-[10px] font-bold cursor-pointer hover:border-tangerine"
            title={untracked ? "Delete this new file" : "Undo every change in this file"}
          >
            {untracked ? "Discard new file" : "Undo file"}
          </button>
        )}
      </div>

      {open && (
        file.binary ? (
          <div className="px-3 py-2 text-xs text-ink-soft">Binary file — no line-by-line view.</div>
        ) : file.hunks.length === 0 ? (
          <div className="px-3 py-2 text-xs text-ink-soft">
            {file.origPath ? "Renamed, with no changes to its contents." : "No textual changes."}
          </div>
        ) : (
          file.hunks.map((h, i) => (
            <div key={`${h.header}:${i}`} className={i > 0 ? "border-t-2 border-line" : ""}>
              <div className="flex items-center gap-2 px-2.5 py-1 bg-paper">
                <span className="font-mono text-[10px] text-ink-soft truncate flex-1">{h.header}</span>
                {onUndoHunk && !untracked && (
                  <button
                    type="button"
                    onClick={() => onUndoHunk(file, h)}
                    className="shrink-0 rounded-lg border-2 border-line bg-card px-2 py-0.5 text-[10px] font-bold cursor-pointer hover:border-tangerine"
                    title="Undo just this hunk"
                  >
                    Undo
                  </button>
                )}
              </div>
              <pre className="overflow-x-auto text-[11px] leading-[1.45] font-mono">
                {h.lines.map((l, j) => (
                  <div key={j} className={lineClass(l)}>
                    {l === "" ? " " : l}
                  </div>
                ))}
              </pre>
            </div>
          ))
        )
      )}
    </div>
  );
}

function lineClass(line: string): string {
  const base = "px-2.5 whitespace-pre";
  if (line.startsWith("+")) return `${base} bg-leaf-soft text-leaf`;
  if (line.startsWith("-")) return `${base} bg-berry-soft text-berry`;
  if (line.startsWith("\\")) return `${base} text-ink-soft italic`;
  return `${base} text-ink-soft`;
}

/** Small status pill reused by the panel's file rows. */
export function StatusGlyph({ status }: { status: HvGitFileChange["status"] }): React.JSX.Element {
  const tint =
    status === "added" || status === "untracked" ? "text-leaf"
      : status === "deleted" ? "text-berry"
        : status === "renamed" ? "text-plum"
          : "text-sky";
  return (
    <span className={`font-mono text-[10px] font-bold w-3 text-center shrink-0 ${tint}`} title={status}>
      {statusGlyph(status)}
    </span>
  );
}
