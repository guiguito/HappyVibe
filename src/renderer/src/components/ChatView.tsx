import { useEffect, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";
import { AgentsMdPanel } from "./AgentsMdPanel";
import { emptyQueue, type QueueState } from "../queue";

function StatsChip({ refreshKey, sessionId }: { refreshKey: number; sessionId: string }): React.JSX.Element {
  const [stats, setStats] = useState<{ tokens?: { total?: number }; cost?: number } | null>(null);
  useEffect(() => {
    window.hv.getStats(sessionId).then((s) => setStats(s as { tokens?: { total?: number }; cost?: number }));
  }, [refreshKey, sessionId]);
  const tokens = stats?.tokens?.total ?? "–";
  const cost = typeof stats?.cost === "number" ? `$${stats.cost.toFixed(4)}` : "–";
  return (
    <span className="font-mono text-[11px] rounded-full border-2 border-line bg-card px-3 py-1 text-ink-soft">
      {tokens} tok · {cost}
    </span>
  );
}

export function ChatView({
  workspace,
  sessionId,
  title,
  items,
  busy,
  crashed,
  turns,
  queue = emptyQueue,
  onSend,
  onAbort,
  onRestart,
  onRetry,
  onOpenFolder,
}: {
  workspace: string | null;
  sessionId: string | null;
  title: string | null;
  items: TranscriptItem[];
  busy: boolean;
  crashed: number | null;
  turns: number;
  queue?: QueueState;
  onSend: (msg: string, behavior?: "followUp") => void;
  onAbort: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  const [agentsMdOpen, setAgentsMdOpen] = useState(false);

  if (!workspace || !sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-6 size-16 rounded-2xl bg-honey border-2 border-ink/80 shadow-pop -rotate-3 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="size-8 rotate-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
          </div>
          <h1 className="font-black text-3xl tracking-tight">Pick a project, make a vibe.</h1>
          <p className="text-ink-soft mt-2 mb-7">
            Add a workspace, then hit <span className="font-bold text-tangerine">+</span> next to it in the sidebar
            to start a session.
          </p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded-xl bg-tangerine text-paper font-bold px-6 py-3 border-2 border-tangerine-deep shadow-pop transition-all hover:brightness-105 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none cursor-pointer"
          >
            Add a workspace folder…
          </button>
        </div>
      </div>
    );
  }

  const queued = queue.steering.length + queue.followUp.length;

  const submit = (): void => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b-2 border-line bg-paper">
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="font-bold truncate" title={title ?? undefined}>{title ?? "Session"}</span>
          <span className="text-xs text-ink-soft truncate shrink-0" title={workspace}>
            {workspace.split("/").filter(Boolean).pop()}
          </span>
        </div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-tangerine">
            <span className="size-2 rounded-full bg-tangerine animate-pulse" />
            working
          </span>
        )}
        <button
          type="button"
          onClick={() => setAgentsMdOpen(true)}
          title="Edit AGENTS.md — project context for the agent (applies to new or restarted sessions)"
          className="font-mono text-[11px] rounded-full border-2 border-line bg-card px-3 py-1 text-ink-soft hover:border-honey hover:text-ink cursor-pointer transition-colors"
        >
          AGENTS.md
        </button>
        <StatsChip refreshKey={turns} sessionId={sessionId} />
      </header>

      {/* Crash banner */}
      {crashed !== null && (
        <div className="flex items-center gap-3 px-6 py-2.5 bg-berry-soft border-b-2 border-berry/40 text-sm font-semibold text-berry">
          <span className="flex-1">The agent process stopped (code {crashed}).</span>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Restart agent
          </button>
        </div>
      )}

      <Transcript items={items} busy={busy} onRetry={onRetry} />

      {/* Composer */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
        className="px-6 pb-5 pt-2"
      >
        {/* Queued messages (Pi queue_update). Abort preserves the queue — chips stay after Stop. */}
        {queued > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-1.5 px-1 pb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-widest text-ink-soft"
              title="Queued messages are kept even if you press Stop."
            >
              queued · kept on stop
            </span>
            {queue.steering.map((m, i) => (
              <span
                key={`s-${i}`}
                title={`Steering: delivered between tool calls — ${m}`}
                className="max-w-56 truncate rounded-full border-2 border-honey bg-honey-soft px-2.5 py-0.5 text-xs font-semibold"
              >
                ↪ {m}
              </span>
            ))}
            {queue.followUp.map((m, i) => (
              <span
                key={`f-${i}`}
                title={`Follow-up: runs after this turn — ${m}`}
                className="max-w-56 truncate rounded-full border-2 border-sky/50 bg-card px-2.5 py-0.5 text-xs font-semibold"
              >
                ⏭ {m}
              </span>
            ))}
          </div>
        )}
        <div className="max-w-3xl mx-auto flex gap-2 items-center rounded-2xl bg-card border-2 border-line-strong shadow-sticker-lg px-3 py-2 focus-within:border-tangerine transition-colors">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? "Steer the agent — lands between tool calls…" : "Ask for a change…"}
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[0.95rem] focus:outline-none placeholder:text-ink-soft/60"
          />
          {busy && (
            <>
              <button
                type="button"
                onClick={onAbort}
                className="rounded-xl border-2 border-berry text-berry font-bold text-sm px-4 py-2 hover:bg-berry-soft cursor-pointer"
              >
                Stop
              </button>
              <button
                type="button"
                disabled={!input.trim()}
                title="Queue for after this turn"
                onClick={() => {
                  if (!input.trim()) return;
                  onSend(input, "followUp");
                  setInput("");
                }}
                className="rounded-xl border-2 border-line-strong text-ink-soft font-bold text-sm px-4 py-2 enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
              >
                Queue
              </button>
            </>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker transition-all enabled:hover:brightness-105 enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none enabled:cursor-pointer disabled:opacity-40"
          >
            {busy ? "Steer" : "Send"}
          </button>
        </div>
      </form>
      {agentsMdOpen && <AgentsMdPanel workspace={workspace} onClose={() => setAgentsMdOpen(false)} />}
    </div>
  );
}
