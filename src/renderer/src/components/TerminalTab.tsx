import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_PALETTES } from "../terminalTheme";
import { fontStack } from "../../../main/terminalSettings";

/**
 * §26 — one mounted emulator, bound to one terminal id in main.
 *
 * Mounted ONCE and placed by CSS grid-area, exactly like FileTab and ChatView.
 * That invariant matters more here than anywhere else in the app: a remount
 * does not merely lose an edit buffer, it detaches the PTY listener and throws
 * away the entire terminal. So this component is a flat child of App's grid and
 * is never nested inside a pane.
 *
 * PTY bytes go straight to `term.write()` and never through React state — §7's
 * streaming invariant, and the reason a firehose of build output does not
 * re-render the app.
 *
 * The buffer is repainted from MAIN's headless mirror on mount, which is what
 * makes a terminal survive ⌘R: the PTY never died, so a restored tab just
 * re-attaches to it.
 */
export function TerminalTab({
  terminalId,
  settings,
  gridArea,
  hidden,
  searchKey,
  dividerClass,
  onExit,
}: {
  terminalId: string;
  settings: HvTerminalSettings;
  gridArea?: string;
  /** Round 15: App's `paneDivider(area)` — the SAME border the chat, file and
      empty cells draw. Computed there, never re-derived here, or the five pane
      kinds drift apart (three drew it, two did not). */
  dividerClass?: string;
  hidden: boolean;
  /** The one `search` action, focus-scoped — a third consumer beside chat and editor. */
  searchKey: string;
  onExit?: (code: number) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");

  // Settings the emulator can absorb without being rebuilt. Kept in a ref so
  // the mount effect does not depend on them — re-running it would kill the
  // terminal every time the user nudged a font size.
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
    const f = new FitAddon();
    const s = new SearchAddon();
    t.loadAddon(f);
    t.loadAddon(s);
    // §7 round 4: a link opens in the OS browser, never in the app window —
    // navigating the SPA away would take the whole session with it.
    t.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void window.hv.openExternal(uri);
      }),
    );
    t.open(el);
    term.current = t;
    fit.current = f;
    search.current = s;

    let disposed = false;

    // Repaint from main's mirror BEFORE subscribing, so nothing arriving in
    // between is written ahead of the history it belongs after.
    void window.hv.termSnapshot(terminalId).then((snapshot) => {
      if (disposed || !snapshot) return;
      t.write(snapshot);
    });

    const offData = window.hv.onTermData(({ id, data }) => {
      if (id === terminalId) t.write(data);
    });
    const offExit = window.hv.onTermExit(({ id, code }) => {
      if (id !== terminalId) return;
      setExited(code);
      onExit?.(code);
    });

    const offInput = t.onData((data) => void window.hv.termInput(terminalId, data));

    // Bell. "visual" is the default because a terminal that beeps out of a
    // window the user is not looking at is a worse citizen than one that flashes.
    const offBell = t.onBell(() => {
      if (live.current.bell === "off") return;
      if (live.current.bell === "visual") {
        el.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: 120 });
      } else {
        void new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
        ).play().catch(() => {});
      }
    });

    const offSelection = t.onSelectionChange(() => {
      if (live.current.copyOnSelect) {
        const sel = t.getSelection();
        if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
      }
    });

    const resize = (): void => {
      if (disposed || !host.current || host.current.clientWidth === 0) return;
      try {
        f.fit();
        void window.hv.termResize(terminalId, t.cols, t.rows);
      } catch {
        /* the pane is mid-layout; the next observation will catch it */
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      offExit();
      offInput.dispose();
      offBell.dispose();
      offSelection.dispose();
      t.dispose();
      term.current = null;
    };
    // terminalId only: the emulator is bound to ONE terminal for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // Appearance changes apply to a LIVE terminal — they must never respawn the
  // PTY, which is why they are options writes rather than a remount.
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = fontStack(settings.fontFamily);
    t.options.fontSize = settings.fontSize;
    t.options.lineHeight = settings.lineHeight;
    t.options.letterSpacing = settings.letterSpacing;
    t.options.cursorStyle = settings.cursorStyle;
    t.options.cursorBlink = settings.cursorBlink;
    t.options.minimumContrastRatio = settings.minimumContrastRatio;
    t.options.scrollback = settings.scrollback;
    t.options.wordSeparator = settings.wordSeparator;
    t.options.theme = TERMINAL_PALETTES[settings.style];
    try {
      fit.current?.fit();
      void window.hv.termResize(terminalId, t.cols, t.rows);
    } catch {
      /* hidden pane — the ResizeObserver refits when it is shown */
    }
  }, [settings, terminalId]);

  // A hidden pane has zero width, so xterm cannot measure a cell. Refit when
  // this tab is brought back to the front, or it renders one column wide.
  useEffect(() => {
    if (hidden) return;
    const id = requestAnimationFrame(() => {
      try {
        fit.current?.fit();
        const t = term.current;
        if (t) void window.hv.termResize(terminalId, t.cols, t.rows);
        t?.focus();
      } catch {
        /* not laid out yet */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [hidden, terminalId]);

  /**
   * Pasting is where a terminal can hurt someone who did not mean it: a block
   * ending in a newline EXECUTES on arrival. §26 calls this a safety setting
   * rather than a preference, which is why it defaults on.
   */
  const onPaste = (e: React.ClipboardEvent): void => {
    if (!live.current.warnMultilinePaste) return;
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text.trim()) && !text.endsWith("\n")) return;
    const lines = text.trimEnd().split("\n").length;
    if (!window.confirm(`Paste and run ${lines} lines? A pasted newline executes immediately.`)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onContextMenu = (e: React.MouseEvent): void => {
    if (!live.current.rightClickPastes) return; // macOS convention is a menu
    e.preventDefault();
    void navigator.clipboard.readText().then((text) => {
      if (text) void window.hv.termInput(terminalId, text);
    });
  };

  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!host.current?.contains(document.activeElement)) return;
      const combo = `${e.metaKey || e.ctrlKey ? "Mod-" : ""}${e.shiftKey ? "Shift-" : ""}${e.key.toLowerCase()}`;
      if (combo === searchKey.toLowerCase()) {
        e.preventDefault();
        setFinding(true);
      } else if (e.key === "Escape" && finding) {
        setFinding(false);
        search.current?.clearDecorations();
        term.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hidden, searchKey, finding]);

  return (
    <div
      className={`relative min-h-0 min-w-0 overflow-hidden ${dividerClass ?? ""}`}
      style={{ gridArea, display: hidden ? "none" : "block", background: TERMINAL_PALETTES[settings.style].background }}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
    >
      <div ref={host} className="absolute inset-0 p-2" />

      {finding && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border-2 border-line-strong bg-paper px-2 py-1 shadow-pop">
          <input
            autoFocus
            value={query}
            placeholder="Find in terminal"
            onChange={(e) => {
              setQuery(e.target.value);
              search.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) search.current?.findPrevious(query);
                else search.current?.findNext(query);
              }
            }}
            className="w-44 bg-transparent text-[13px] outline-none"
          />
          <button
            type="button"
            aria-label="Close search"
            className="px-1 text-ink-soft hover:text-berry font-bold cursor-pointer"
            onClick={() => {
              setFinding(false);
              search.current?.clearDecorations();
              term.current?.focus();
            }}
          >
            ×
          </button>
        </div>
      )}

      {exited !== null && (
        // Inert rather than self-closing: §26 refuses to close a tab out from
        // under someone. The scrollback stays readable, which is usually the
        // whole reason they are looking.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t-2 border-line-strong bg-paper/95 px-3 py-1.5 text-[12px] font-bold text-ink-soft">
          process exited (code {exited}) — ⌘W closes this tab
        </div>
      )}
    </div>
  );
}
