import { useEffect, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";

function StatsChip({ refreshKey }: { refreshKey: number }): React.JSX.Element {
  const [stats, setStats] = useState<{ tokens?: { total?: number }; cost?: number } | null>(null);
  useEffect(() => {
    window.hv.getStats().then((s) => setStats(s as { tokens?: { total?: number }; cost?: number }));
  }, [refreshKey]);
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
  items,
  busy,
  crashed,
  turns,
  onSend,
  onAbort,
  onRestart,
  onOpenFolder,
}: {
  workspace: string | null;
  items: TranscriptItem[];
  busy: boolean;
  crashed: number | null;
  turns: number;
  onSend: (msg: string) => void;
  onAbort: () => void;
  onRestart: () => void;
  onOpenFolder: () => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");

  if (!workspace) {
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
            The agent works inside one folder at a time. Point it somewhere fun.
          </p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded-xl bg-tangerine text-paper font-bold px-6 py-3 border-2 border-tangerine-deep shadow-pop transition-all hover:brightness-105 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none cursor-pointer"
          >
            Open a project folder…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b-2 border-line bg-paper">
        <div className="font-bold truncate flex-1 min-w-0" title={workspace}>
          {workspace.split("/").filter(Boolean).pop()}
        </div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-tangerine">
            <span className="size-2 rounded-full bg-tangerine animate-pulse" />
            working
          </span>
        )}
        <StatsChip refreshKey={turns} />
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

      <Transcript items={items} busy={busy} />

      {/* Composer */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!input.trim()) return;
          onSend(input);
          setInput("");
        }}
        className="px-6 pb-5 pt-2"
      >
        <div className="max-w-3xl mx-auto flex gap-2 items-center rounded-2xl bg-card border-2 border-line-strong shadow-sticker-lg px-3 py-2 focus-within:border-tangerine transition-colors">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for a change…"
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[0.95rem] focus:outline-none placeholder:text-ink-soft/60"
          />
          {busy && (
            <button
              type="button"
              onClick={onAbort}
              className="rounded-xl border-2 border-berry text-berry font-bold text-sm px-4 py-2 hover:bg-berry-soft cursor-pointer"
            >
              Stop
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker transition-all enabled:hover:brightness-105 enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none enabled:cursor-pointer disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
