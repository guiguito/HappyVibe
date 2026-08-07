import { Section } from "./Section";
import { TERMINAL_PALETTES, contrastRatio } from "../terminalTheme";
import { DEFAULT_TERMINAL_SETTINGS } from "../../../main/terminalSettings";

/**
 * §26 — Settings → Terminal.
 *
 * Scope is GLOBAL, deliberately: every setting here is appearance or personal
 * habit, and the one per-workspace candidate (the shell) belongs in a project's
 * own dotfiles, where every other tool will read it too.
 *
 * All sixteen ship, because the count overstates the work — eleven are keys
 * xterm's constructor already accepts and are passed through verbatim, so they
 * cost a row each. Only shell path, arguments and extra environment need real
 * editors, and those three are also the only ones that can stop a terminal
 * opening at all, which is why each carries a reset and why a bad shell shows
 * an inert failure naming the path it tried rather than an empty tab.
 */

const STYLES = [
  { id: "workshop", name: "Workshop", note: "The app's own ink and paper — the treatment chat code blocks use" },
  { id: "paper", name: "Paper", note: "Cream, so the whole window is one temperature. Best for bright rooms" },
  { id: "carbon", name: "Carbon", note: "The palette de-warmed, neutral and high-contrast for long sessions" },
] as const;

const ANSI = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

// Imported rather than fetched, and rather than restated here. terminalSettings
// is electron-free precisely so both sides can share it — a second copy of the
// defaults is how a "Reset" button starts lying about what the default is.
const defaults = DEFAULT_TERMINAL_SETTINGS as unknown as HvTerminalSettings;

/**
 * Settings are OWNED BY APP and passed in, mirroring ShortcutsView's
 * `bindings` / `onChange` pair in the same render chain.
 *
 * Not a stylistic choice: this page held its own copy first, and the section
 * subtitle's promise — "changes apply to terminals you already have open" —
 * was then simply false. App mounts every emulator, so App has to be the one
 * that learns a setting changed; a page-local copy writes to disk and reaches
 * nothing on screen. Caught in the GUI, where the terminal stayed dark after
 * switching to Paper.
 */
export function TerminalView({
  settings,
  onChange,
}: {
  settings: HvTerminalSettings | null;
  onChange: (next: HvTerminalSettings) => void;
}): React.JSX.Element {
  const s = settings;
  if (!s) return <div className="p-6 text-sm text-ink-soft">Loading…</div>;

  const apply = (next: HvTerminalSettings): void => {
    // Optimistic, then reconciled with what main actually stored — main
    // range-checks every field, so a typed-in fontSize of 0 comes back as 6
    // and the input must show that rather than the rejected value.
    onChange(next);
    void window.hv.setTerminalSettings(next).then(onChange);
  };

  const patch = (next: Partial<HvTerminalSettings>): void => apply({ ...s, ...next });

  const resetAll = (): void => apply(defaults);

  const changed = <K extends keyof HvTerminalSettings>(key: K): boolean =>
    JSON.stringify(defaults[key]) !== JSON.stringify(s[key]);

  const reset = <K extends keyof HvTerminalSettings>(key: K): void => {
    patch({ [key]: defaults[key] } as Partial<HvTerminalSettings>);
  };

  /** One settings row, with the per-row reset §26 asks for. */
  const Row = ({
    label,
    hint,
    field,
    children,
  }: {
    label: string;
    hint?: string;
    field: keyof HvTerminalSettings;
    children: React.ReactNode;
  }): React.JSX.Element => (
    <div className="flex items-start gap-4 py-2.5 border-b border-line last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label}</div>
        {hint && <div className="text-[12px] text-ink-soft mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={() => reset(field)}
          disabled={!changed(field)}
          title="Reset to the default"
          className="text-[11px] px-1.5 py-0.5 rounded border-2 border-line text-ink-soft enabled:hover:text-ink enabled:hover:border-line-strong disabled:opacity-0 cursor-pointer"
        >
          Reset
        </button>
      </div>
    </div>
  );

  const input = "rounded-lg border-2 border-line bg-paper px-2 py-1 text-[13px] outline-none focus:border-tangerine";
  const num = (v: number, on: (n: number) => void, step = 1, w = "w-20"): React.JSX.Element => (
    <input type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} className={`${input} ${w}`} />
  );
  const toggle = (v: boolean, on: (b: boolean) => void): React.JSX.Element => (
    <button
      type="button"
      role="switch"
      aria-checked={v}
      onClick={() => on(!v)}
      className={`w-11 h-6 rounded-full border-2 transition-colors cursor-pointer ${v ? "bg-tangerine border-tangerine-deep" : "bg-paper-deep border-line"}`}
    >
      <span className={`block size-4 rounded-full bg-card border border-line transition-transform ${v ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
  const pick = <T extends string>(v: T, opts: readonly T[], on: (x: T) => void): React.JSX.Element => (
    <select value={v} onChange={(e) => on(e.target.value as T)} className={input}>
      {opts.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );

  return (
    <div className="p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Terminal</h1>
          <p className="text-sm text-ink-soft">
            A real shell, in a tab, at your project folder. These settings are global.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="rounded-xl border-2 border-line-strong px-3 py-1.5 text-[13px] font-bold hover:bg-paper-deep cursor-pointer"
        >
          Reset all
        </button>
      </div>

      <Section icon="terminal" title="Style" subtitle="Three presets. Every one is contrast-checked, so no colour is unreadable on its own background.">
        <div className="grid gap-3 sm:grid-cols-3">
          {STYLES.map(({ id, name, note }) => {
            const p = TERMINAL_PALETTES[id];
            const active = s.style === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => patch({ style: id })}
                aria-pressed={active}
                className={`text-left rounded-xl border-2 p-3 cursor-pointer transition-colors ${
                  active ? "border-tangerine bg-honey-soft/50" : "border-line hover:border-line-strong"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold text-sm">{name}</span>
                  {id === "workshop" && <span className="text-[10px] uppercase tracking-wide text-ink-soft">default</span>}
                </div>
                {/* The real palette, not an approximation — a swatch that lies
                    about the theme is worse than no swatch. */}
                <div className="rounded-lg p-2 font-mono text-[11px]" style={{ background: p.background, color: p.foreground }}>
                  <div>$ npm test</div>
                  <div className="flex gap-1 mt-1">
                    {ANSI.map((k) => (
                      <span key={k} style={{ color: p[k] }} title={`${k} — ${contrastRatio(p.background, p[k]).toFixed(2)}:1`}>
                        ●
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-[11px] text-ink-soft mt-2 leading-snug">{note}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section icon="terminal" title="Appearance" subtitle="Passed straight to the emulator; changes apply to terminals you already have open.">
        <Row label="Font family" hint="JetBrains Mono ships with the app. Name any font installed on your machine." field="fontFamily">
          <input value={s.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className={`${input} w-64`} />
        </Row>
        <Row label="Font size" field="fontSize">{num(s.fontSize, (v) => patch({ fontSize: v }))}</Row>
        <Row label="Line height" field="lineHeight">{num(s.lineHeight, (v) => patch({ lineHeight: v }), 0.1)}</Row>
        <Row label="Letter spacing" field="letterSpacing">{num(s.letterSpacing, (v) => patch({ letterSpacing: v }), 0.5)}</Row>
        <Row label="Cursor style" field="cursorStyle">{pick(s.cursorStyle, ["bar", "block", "underline"] as const, (v) => patch({ cursorStyle: v }))}</Row>
        <Row label="Cursor blink" field="cursorBlink">{toggle(s.cursorBlink, (v) => patch({ cursorBlink: v }))}</Row>
        <Row
          label="Minimum contrast ratio"
          hint="Auto-lightens unreadable output from a badly-behaved program. The palettes above already pass on their own."
          field="minimumContrastRatio"
        >
          {num(s.minimumContrastRatio, (v) => patch({ minimumContrastRatio: v }), 0.5)}
        </Row>
      </Section>

      <Section icon="terminal" title="Shell" subtitle="What gets started, and in what environment. Leave the path blank to use your login shell.">
        <Row label="Shell path" hint={`Blank uses $SHELL. ${s.shellPath ? "" : "Currently: your login shell."}`} field="shellPath">
          <input
            value={s.shellPath ?? ""}
            placeholder="$SHELL"
            onChange={(e) => patch({ shellPath: e.target.value.trim() ? e.target.value : null })}
            className={`${input} w-64`}
          />
        </Row>
        <Row label="Shell arguments" hint="Space-separated. `-l` starts a login shell, so your real PATH and version managers work." field="shellArgs">
          <input
            value={s.shellArgs.join(" ")}
            onChange={(e) => patch({ shellArgs: e.target.value.split(/\s+/).filter(Boolean) })}
            className={`${input} w-64`}
          />
        </Row>
        <Row label="Extra environment" hint="One KEY=value per line. Merged over the inherited environment." field="env">
          <textarea
            rows={3}
            value={Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join("\n")}
            onChange={(e) =>
              patch({
                env: Object.fromEntries(
                  e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.includes("="))
                    .map((line) => {
                      const i = line.indexOf("=");
                      return [line.slice(0, i).trim(), line.slice(i + 1)];
                    })
                    .filter(([k]) => k.length > 0),
                ),
              })
            }
            className={`${input} w-64 font-mono`}
          />
        </Row>
      </Section>

      <Section icon="terminal" title="Behaviour" subtitle="How the terminal reacts to you.">
        <Row label="Scrollback" hint="Lines kept per terminal. Also the window the agent can read in a later build." field="scrollback">
          {num(s.scrollback, (v) => patch({ scrollback: v }), 500, "w-28")}
        </Row>
        <Row label="Copy on select" field="copyOnSelect">{toggle(s.copyOnSelect, (v) => patch({ copyOnSelect: v }))}</Row>
        <Row label="Right-click pastes" hint="Off by default — the macOS convention is a context menu." field="rightClickPastes">
          {toggle(s.rightClickPastes, (v) => patch({ rightClickPastes: v }))}
        </Row>
        <Row
          label="Warn on multi-line paste"
          hint="A safety setting, not a preference: a pasted block ending in a newline runs the moment it lands."
          field="warnMultilinePaste"
        >
          {toggle(s.warnMultilinePaste, (v) => patch({ warnMultilinePaste: v }))}
        </Row>
        <Row label="Confirm close while running" hint="Closing a terminal tab kills its process." field="confirmCloseRunning">
          {toggle(s.confirmCloseRunning, (v) => patch({ confirmCloseRunning: v }))}
        </Row>
        <Row label="Bell" field="bell">{pick(s.bell, ["off", "visual", "sound"] as const, (v) => patch({ bell: v }))}</Row>
        <Row label="Word separators" hint="Characters that end a word for double-click selection." field="wordSeparator">
          <input value={s.wordSeparator} onChange={(e) => patch({ wordSeparator: e.target.value })} className={`${input} w-64 font-mono`} />
        </Row>
      </Section>
    </div>
  );
}
