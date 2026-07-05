import { useState } from "react";

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

export function ToolCard({ card }: { card: ToolCardData }): React.JSX.Element {
  const [open, setOpen] = useState(false);
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
        <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
          {typeof card.args === "string" ? card.args : JSON.stringify(card.args)?.slice(0, 160)}
        </code>
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
      {open && (
        <pre className="font-mono text-xs bg-paper-deep/60 border-t-2 border-line px-3.5 py-2.5 overflow-x-auto max-h-64">
          {JSON.stringify(card.result ?? card.args, null, 2)}
        </pre>
      )}
    </div>
  );
}
