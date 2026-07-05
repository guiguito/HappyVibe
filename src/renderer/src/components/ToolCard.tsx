import { useState } from "react";
import { toolDiff, type DiffLine } from "../diffs";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error" | "denied";
  result?: unknown;
  /** Set when the permission modal granted this call. */
  approval?: "Allow" | "Allow for session";
}

const STATUS: Record<ToolCardData["status"], { dot: string; label: string }> = {
  running: { dot: "bg-sky animate-pulse", label: "running" },
  done: { dot: "bg-leaf", label: "done" },
  error: { dot: "bg-berry", label: "error" },
  denied: { dot: "bg-berry", label: "denied" },
};

const LINE_STYLE: Record<DiffLine["type"], { row: string; sign: string }> = {
  add: { row: "bg-leaf-soft", sign: "+" },
  del: { row: "bg-berry-soft", sign: "−" },
  ctx: { row: "", sign: " " },
};

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  return (
    <pre className="font-mono text-xs bg-card border-t-2 border-line overflow-x-auto overflow-y-auto max-h-64 py-1.5">
      {lines.map((l, i) => {
        const s = LINE_STYLE[l.type];
        return (
          <div key={i} className={`px-3.5 ${s.row}`}>
            <span className="select-none inline-block w-4 text-ink-soft">{s.sign}</span>
            {l.text}
          </div>
        );
      })}
    </pre>
  );
}

export function ToolCard({ card }: { card: ToolCardData }): React.JSX.Element {
  // Edit diffs open by default (the diff IS the payload); write stays collapsed
  // (a full new file can be long). Bash keeps the raw output card.
  const diff = card.toolName === "edit" || card.toolName === "write" ? toolDiff(card.toolName, card.args) : null;
  const [open, setOpen] = useState(diff?.kind === "edit");
  const s = STATUS[card.status];
  const denied = card.status === "denied";
  return (
    <div
      className={`rounded-xl border-2 bg-card shadow-sticker overflow-hidden ${
        denied ? "border-berry/50" : "border-line"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-paper-deep/40 transition-colors"
      >
        <span className={`size-2.5 rounded-full shrink-0 ${s.dot}`} />
        <span className="font-bold text-sm">{card.toolName}</span>
        {diff ? (
          <span className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
            {diff.path}
            {diff.kind === "write" && (
              <span className="ml-2 font-sans text-[10px] font-bold uppercase tracking-wide text-leaf">
                new file · {diff.lines.length} lines
              </span>
            )}
          </span>
        ) : (
          <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
            {typeof card.args === "string" ? card.args : JSON.stringify(card.args)?.slice(0, 160)}
          </code>
        )}
        {card.approval && (
          <span
            className={`shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
              card.approval === "Allow"
                ? "bg-leaf-soft text-leaf border-leaf/40"
                : "bg-honey-soft text-tangerine-deep border-honey/60"
            }`}
          >
            {card.approval === "Allow" ? "allowed" : "session pass"}
          </span>
        )}
        {denied && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-berry-soft text-berry border border-berry/40">
            denied
          </span>
        )}
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-soft">{s.label}</span>
      </button>
      {open &&
        (diff ? (
          <DiffView lines={diff.lines} />
        ) : (
          <pre className="font-mono text-xs bg-paper-deep/60 border-t-2 border-line px-3.5 py-2.5 overflow-x-auto max-h-64">
            {JSON.stringify(card.result ?? card.args, null, 2)}
          </pre>
        ))}
      {/* Tool errors keep their message visible even when the diff view owns the body. */}
      {card.status === "error" && diff && (
        <div className="border-t-2 border-berry/30 bg-berry-soft/60 px-3.5 py-2 font-mono text-xs text-berry whitespace-pre-wrap">
          {typeof card.result === "string" ? card.result : JSON.stringify(card.result)?.slice(0, 400)}
        </div>
      )}
    </div>
  );
}
