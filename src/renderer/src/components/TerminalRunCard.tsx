import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ToolIcon } from "./ToolCard";
import { TERMINAL_PALETTES } from "../terminalTheme";
import { fontStack } from "../../../main/terminalSettings";

/**
 * §26 part 2 — an agent terminal is a card in the transcript, not a tab.
 *
 * A tab is a surface the USER opened; an agent creating one unasked is the app
 * rearranging someone's workspace behind their back. A terminal is instead a
 * consequence of a tool call, so it belongs where the tool call is — which is
 * exactly what the sticky delegation card already is, and this is deliberately
 * its sibling (same anatomy, terminal glyph instead of the robot).
 *
 * Three things differ, because a terminal is not a subagent:
 *   1. it does not end on its own, so the stack is CAPPED (see visibleRuns);
 *   2. its content is a byte stream, so only the EXPANDED card hosts a live
 *      emulator — collapsed is a cheap text tail;
 *   3. it takes keyboard input, ungated.
 */

export interface TerminalRun {
  terminalId: string;
  /** The foreground command, else the shell name — polled by main. */
  title: string;
  running: boolean;
  /** The model's own headline for the call that opened it. */
  intent: string;
  startedAt: number;
}

/**
 * §26: two cards, then a strip.
 *
 * The delegation card assumes termination — it lingers after completion and
 * slides away. A terminal card pins INDEFINITELY, which is exactly what a dev
 * server needs and exactly what would eat the transcript at three of them.
 *
 * Terminal-only, NOT shared with delegation cards: a shared cap would change
 * how subagent cards behave, which is outside this feature and a behaviour
 * people are used to. Worst case is two terminal rows plus live delegations.
 */
export const STACK_CAP = 2;

export function visibleRuns(runs: TerminalRun[]): { cards: TerminalRun[]; collapsed: TerminalRun[] } {
  const live = runs.filter((r) => r.running);
  return live.length > STACK_CAP ? { cards: [], collapsed: live } : { cards: live, collapsed: [] };
}

export function summaryLabel(runs: TerminalRun[]): string {
  return `${runs.length} running · ${runs.map((r) => r.title).join(", ")}`;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The sticky stack. Rendered beside DelegationSection, below it. */
export function TerminalStack({
  runs,
  settings,
  onStop,
  onOpenAsTab,
}: {
  runs: TerminalRun[];
  settings: HvTerminalSettings;
  onStop: (terminalId: string) => void;
  onOpenAsTab: (terminalId: string) => void;
}): React.JSX.Element | null {
  // Only ONE expanded card at a time, so only one emulator is ever mounted.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stripOpen, setStripOpen] = useState(false);
  const { cards, collapsed } = visibleRuns(runs);
  if (!cards.length && !collapsed.length) return null;

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col">
      {cards.map((run) => (
        <TerminalRunCard
          key={run.terminalId}
          run={run}
          settings={settings}
          open={expanded === run.terminalId}
          onToggle={() => setExpanded((e) => (e === run.terminalId ? null : run.terminalId))}
          onStop={onStop}
          onOpenAsTab={onOpenAsTab}
        />
      ))}
      {collapsed.length > 0 && (
        <div className="pt-3">
          <button
            type="button"
            onClick={() => setStripOpen((o) => !o)}
            aria-expanded={stripOpen}
            title="See the running terminals"
            className="w-full rounded-xl border-2 border-tangerine/60 bg-card shadow-sticker-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-3 text-left cursor-pointer"
          >
            <span className="size-2.5 rounded-full shrink-0 bg-tangerine animate-pulse" />
            <ToolIcon kind="terminal" className="size-4 shrink-0 text-tangerine-deep" />
            <span className="flex-1 min-w-0 break-words">{summaryLabel(collapsed)}</span>
            <span className="shrink-0 text-[11px] text-ink-soft">{stripOpen ? "▾" : "▸"}</span>
          </button>
          {stripOpen && (
            <div className="flex flex-col">
              {collapsed.map((run) => (
                <TerminalRunCard
                  key={run.terminalId}
                  run={run}
                  settings={settings}
                  open={expanded === run.terminalId}
                  onToggle={() => setExpanded((e) => (e === run.terminalId ? null : run.terminalId))}
                  onStop={onStop}
                  onOpenAsTab={onOpenAsTab}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TerminalRunCard({
  run,
  settings,
  open,
  onToggle,
  onStop,
  onOpenAsTab,
}: {
  run: TerminalRun;
  settings: HvTerminalSettings;
  open: boolean;
  onToggle: () => void;
  onStop: (terminalId: string) => void;
  onOpenAsTab: (terminalId: string) => void;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const [tail, setTail] = useState<string[]>([]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Collapsed: a cheap three-line DOM tail, the same treatment tool-card output
  // gets. Never an emulator — three of those in a sticky stack is three live
  // terminals rendering a firehose nobody is looking at.
  useEffect(() => {
    if (open) return;
    let buf = "";
    const off = window.hv.onTermData(({ id, data }) => {
      if (id !== run.terminalId) return;
      buf += data;
      const lines = buf.replace(/\r(?!\n)/g, "\n").split("\n");
      buf = lines.slice(-4).join("\n");
      setTail(
        lines
          // eslint-disable-next-line no-control-regex
          .map((l) => l.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trimEnd())
          .filter((l) => l.length > 0)
          .slice(-3),
      );
    });
    return off;
  }, [open, run.terminalId]);

  return (
    <div className="pt-3">
      <div className="rounded-xl border-2 border-tangerine/60 bg-card shadow-sticker-lg overflow-hidden">
        <div className="w-full flex items-start gap-3 px-4 py-2.5 text-sm font-semibold">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            title={open ? "Collapse this terminal" : "Open this terminal — you can type in it"}
            className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
          >
            <span className="mt-1 size-2.5 rounded-full shrink-0 bg-tangerine animate-pulse" />
            {/* The terminal glyph, not the robot: this is a running COMMAND. */}
            <ToolIcon kind="terminal" className="mt-0.5 size-4 shrink-0 text-tangerine-deep" />
            <span className="flex-1 min-w-0 break-words">
              <span className="font-black text-tangerine-deep">{run.title}</span>
              {run.intent && <span className="text-ink-soft font-medium"> — {run.intent}</span>}
            </span>
          </button>
          <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
            {formatElapsed(now - run.startedAt)}
          </span>
          {open && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAsTab(run.terminalId);
              }}
              title="Move this terminal into a tab of its own"
              className="shrink-0 rounded-md border border-ink/40 text-ink-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-paper-deep cursor-pointer"
            >
              Open as tab
            </button>
          )}
          {/* No confirmation: the human can always kill an agent terminal (§26). */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStop(run.terminalId);
            }}
            title="Stop this terminal and the process in it"
            className="shrink-0 rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-berry/10 cursor-pointer"
          >
            ◼ Stop
          </button>
          <button type="button" onClick={onToggle} aria-hidden tabIndex={-1} className="shrink-0 text-[11px] text-ink-soft cursor-pointer">
            {open ? "▾" : "▸"}
          </button>
        </div>
        {!open && (
          <>
            <div className="h-1 hv-shimmer" aria-hidden />
            {tail.length > 0 && (
              <pre className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-words">
                {tail.join("\n")}
              </pre>
            )}
          </>
        )}
        {open && <LiveTerminal terminalId={run.terminalId} settings={settings} />}
      </div>
    </div>
  );
}

/**
 * The expanded card's emulator. Mounted on expand, disposed on collapse —
 * affordable only because the scrollback lives in MAIN, so re-expanding
 * replays it rather than losing it. Third time that decision pays for itself.
 */
function LiveTerminal({ terminalId, settings }: { terminalId: string; settings: HvTerminalSettings }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const live = useRef(settings);
  live.current = settings;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const t = new Terminal({
      fontFamily: fontStack(live.current.fontFamily),
      fontSize: live.current.fontSize,
      lineHeight: live.current.lineHeight,
      letterSpacing: live.current.letterSpacing,
      cursorStyle: live.current.cursorStyle,
      cursorBlink: live.current.cursorBlink,
      minimumContrastRatio: live.current.minimumContrastRatio,
      scrollback: live.current.scrollback,
      wordSeparator: live.current.wordSeparator,
      theme: TERMINAL_PALETTES[live.current.style],
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);

    let disposed = false;
    // Repaint from main's mirror BEFORE subscribing, so nothing arriving in
    // between is written ahead of the history it belongs after.
    void window.hv.termSnapshot(terminalId).then((snapshot) => {
      if (disposed || !snapshot) return;
      t.write(snapshot);
    });
    // Bytes go straight to term.write(), never through React state (§7).
    const off = window.hv.onTermData(({ id, data }) => {
      if (id === terminalId) t.write(data);
    });
    // §26: typing is UNGATED. Permissions gate the agent, not the human — and
    // main sees these keystrokes, which is what drives the interleave hold.
    const input = t.onData((d) => void window.hv.termInput(terminalId, d));

    const resize = (): void => {
      try {
        fit.fit();
        void window.hv.termResize(terminalId, t.cols, t.rows);
      } catch {
        /* the host is being torn down */
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    t.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      off();
      input.dispose();
      t.dispose();
    };
  }, [terminalId]);

  return <div ref={host} className="border-t-2 border-line h-64 px-2 py-1.5 bg-paper-deep/40" />;
}
