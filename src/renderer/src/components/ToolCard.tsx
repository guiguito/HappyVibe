import { useState } from "react";
import { toolDiff, type DiffLine } from "../diffs";
import type { SubagentTrace } from "../agents";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error" | "denied";
  result?: unknown;
  /** Set when the permission modal granted this call. */
  approval?: "Allow" | "Allow for session";
  /** B6: subagent delegation trace (toolName "subagent" only) — live + final. */
  trace?: SubagentTrace;
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

const fmtCost = (c?: number): string => (c != null ? `$${c.toFixed(c < 0.01 ? 5 : 4)}` : "");

/**
 * Subagent delegation renders as a NESTED mini-conversation, distinct from a
 * normal tool card: the child transcript (live during the run, final at end),
 * per-agent model + usage + cost + turns. Collapsible; open while running so
 * the delegation is watchable, collapses on done.
 */
function SubagentCard({ card }: { card: ToolCardData }): React.JSX.Element {
  const running = card.status === "running";
  const [open, setOpen] = useState(true);
  const req = card.args as { agent?: string; task?: string } | undefined;
  const results = card.trace?.results ?? [];
  const denied = card.status === "denied";
  return (
    <div className={`rounded-xl border-2 border-l-4 bg-card shadow-sticker overflow-hidden ${denied ? "border-berry/50" : "border-sky/60"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-paper-deep/40 transition-colors"
      >
        <span className={`size-2.5 rounded-full shrink-0 ${running ? "bg-sky animate-pulse" : denied ? "bg-berry" : "bg-leaf"}`} />
        <span className="text-[11px] font-black uppercase tracking-wide text-sky shrink-0">subagent</span>
        <span className="font-bold text-sm shrink-0">{req?.agent ?? results[0]?.agent ?? "?"}</span>
        <span className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0" title={req?.task}>
          {req?.task ?? ""}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-soft">
          {running ? "delegating…" : denied ? "denied" : "done"}
        </span>
      </button>
      {open && (
        <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 flex flex-col gap-3">
          {results.length === 0 && <p className="text-xs text-ink-soft italic">Waiting for the subagent to respond…</p>}
          {results.map((r, i) => (
            <div key={i} className="rounded-lg border border-line bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line text-[11px]">
                <span className="font-bold">{r.agent}</span>
                {r.model && <span className="font-mono text-ink-soft">{r.model}</span>}
                <span className="flex-1" />
                {r.usage && (
                  <span className="font-mono text-ink-soft" title="input/output tokens · turns · cost">
                    {(r.usage.input ?? 0) + (r.usage.output ?? 0)} tok
                    {r.usage.turns != null ? ` · ${r.usage.turns} turn${r.usage.turns === 1 ? "" : "s"}` : ""}
                    {r.usage.cost != null ? ` · ${fmtCost(r.usage.cost)}` : ""}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5 px-2.5 py-2 max-h-64 overflow-y-auto">
                {r.messages.map((m, j) => (
                  <div key={j} className="text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mr-1.5">{m.role}</span>
                    <span className="whitespace-pre-wrap break-words">{m.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolCard({ card }: { card: ToolCardData }): React.JSX.Element {
  if (card.toolName === "subagent") return <SubagentCard card={card} />;
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
