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
 *   1. it does not end on its own, so it never leaves the rail by itself;
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
  /**
   * A1 prereq 3 (2026-09-10): the `terminal_run` call that opened this
   * terminal. The transcript CARD has always known it and the circle has always
   * known the terminal id, with nothing joining the two — so the card→circle
   * flight had no way to find its own destination. The bridge now carries it
   * through `hv.terminal-run` and main echoes it on the started notify.
   *
   * Optional because a terminal the USER opened has no tool call, and because
   * an older session file replays notifies that predate the field.
   */
  toolCallId?: string;
  /**
   * A2 (2026-09-10): this run is retiring and its circle should play its exit.
   * Terminals had no equivalent of a delegation's `leaving` at all, so a killed
   * one vanished in a single frame.
   */
  leaving?: true;
}

/**
 * §26 (2026-08-30): the cap and the summary strip are gone.
 *
 * They existed because a shared cap would have changed how delegation cards
 * behave, which was out of that round's scope — the avatar row IS that shared
 * treatment, arrived at deliberately (PRD §26, 2026-08-30). A row of circles is
 * already the summary the strip stood in for, and it stays legible past three.
 *
 * `formatElapsed` stays exported: the rail's hover readout uses it.
 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * §26 (2026-08-31): the cheap three-line tail, now in the RAIL's hover readout.
 *
 * It used to be the collapsed card's body; the circle is the collapsed state
 * now, so this is where "what is that terminal actually doing" belongs. Only
 * mounted while a circle is hovered, so it polls for a second or two at a time
 * rather than continuously.
 *
 * It reads MAIN's rendered grid rather than accumulating raw PTY bytes here, and
 * that is not fastidiousness. The first version did accumulate bytes and
 * stripped CSI escapes with a regex, which leaves CONTROL characters behind:
 * zsh's line editor writes `s`, then a backspace, then rewrites the line, so
 * `sleep 600` rendered as `ssleep 600` in the card while the terminal itself was
 * perfectly fine. §26's whole reason for a headless mirror is that a second
 * parser over raw bytes gets this wrong — so there is not one.
 *
 * ponytail: polled at 1s. The push channel could trigger it instead, but a
 * firehose would then re-read on every chunk; upgrade to a debounced push if a
 * 1s tail ever feels stale.
 */
export function TerminalTail({ terminalId }: { terminalId: string }): React.JSX.Element | null {
  const [tail, setTail] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const pull = (): void => {
      void window.hv.termText(terminalId, 3).then((text) => {
        if (!alive) return;
        setTail((text ?? "").split("\n").filter((l) => l.trim().length > 0).slice(-3));
      });
    };
    pull();
    const t = setInterval(pull, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [terminalId]);
  if (!tail.length) return null;
  return (
    <pre className="rounded border border-line bg-paper-deep/60 px-2 py-1 text-[10px] font-mono text-ink-soft whitespace-pre-wrap break-words max-h-16 overflow-hidden">
      {tail.join("\n")}
    </pre>
  );
}

export function TerminalRunCard({
  run,
  settings,
  onClose,
  onStop,
  onOpenAsTab,
}: {
  run: TerminalRun;
  settings: HvTerminalSettings;
  /** Back to the circle. The PTY is untouched — main owns it (§26). */
  onClose: () => void;
  onStop: (terminalId: string) => void;
  onOpenAsTab: (terminalId: string) => void;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="pt-3">
      <div className="rounded-xl border-2 border-tangerine/60 bg-card shadow-sticker-lg overflow-hidden">
        <div className="w-full flex items-start gap-3 px-4 py-2.5 text-sm font-semibold">
          {/* §26 (2026-08-31): inert. The card IS the expanded state — the rail's
              circle is what "collapsed" means — so there is nothing to toggle,
              and a stray click on the title used to close the emulator you had
              just opened. */}
          <span className="flex-1 min-w-0 flex items-start gap-3 text-left">
            <span className="mt-1 size-2.5 rounded-full shrink-0 bg-tangerine animate-pulse" />
            {/* The terminal glyph, not the robot: this is a running COMMAND. */}
            <ToolIcon kind="terminal" className="mt-0.5 size-4 shrink-0 text-tangerine-deep" />
            <span className="flex-1 min-w-0 break-words">
              <span className="font-black text-tangerine-deep">{run.title}</span>
              {run.intent && <span className="text-ink-soft font-medium"> — {run.intent}</span>}
            </span>
          </span>
          <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
            {formatElapsed(now - run.startedAt)}
          </span>
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
          <button
            type="button"
            onClick={onClose}
            title="Close — the terminal keeps running, and its circle stays in the row"
            aria-label="Close this terminal's card"
            className="shrink-0 text-sm leading-none text-ink-soft hover:text-ink cursor-pointer px-0.5"
          >
            ✕
          </button>
        </div>
        <LiveTerminal terminalId={run.terminalId} settings={settings} />
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
