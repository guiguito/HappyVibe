/**
 * §26 — the terminal's settings, as one object.
 *
 * Deliberately electron-free so it can be unit-tested and imported by both the
 * config layer and the manager. Sixteen settings sounds like a lot of plumbing
 * and is not: eleven of them are keys xterm's own constructor accepts and are
 * passed through verbatim by the renderer. Scope is GLOBAL (§26) — appearance
 * is a property of the person, not of the project.
 */
// TYPE-ONLY, and that is load-bearing: three renderer components import values from
// this module (fontStack, DEFAULT_TERMINAL_SETTINGS), so a runtime import of the
// platform seam would put node:child_process in the BROWSER bundle. It typechecks and
// it runs in dev; `npm run build` fails with "spawnSync is not exported by
// __vite-browser-external". Same trap as src/main/schedules.ts, one module over — so
// resolveSpawn takes the platform as an argument rather than reaching for it.
import type { Platform } from "./platform";

export type TerminalStyle = "workshop" | "paper" | "carbon";
export type CursorStyle = "bar" | "block" | "underline";
export type BellStyle = "off" | "visual" | "sound";

export interface TerminalSettings {
  // Appearance — every field below is handed straight to xterm.
  style: TerminalStyle;
  /** A single FAMILY NAME, not a CSS stack — the picker offers verified
   *  monospace families and the renderer appends the fallbacks (fontStack). */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  /** xterm auto-lightens ANSI that fails this. The mitigation for badly-behaved
   *  PROGRAMS — not the palette's safety net; the palettes pass on their own. */
  minimumContrastRatio: number;

  // Shell and behaviour.
  /** null = the login shell ($SHELL). The escape hatch for non-macOS. */
  shellPath: string | null;
  shellArgs: string[];
  /** Merged OVER the inherited environment. */
  env: Record<string, string>;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickPastes: boolean;
  /** A safety setting, not a preference: a newline-terminated paste executes. */
  warnMultilinePaste: boolean;
  confirmCloseRunning: boolean;
  bell: BellStyle;
  wordSeparator: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  style: "workshop",
  fontFamily: "JetBrains Mono Variable",
  fontSize: 13,
  lineHeight: 1.4,
  letterSpacing: 0,
  cursorStyle: "bar",
  cursorBlink: true,
  minimumContrastRatio: 4.5,
  shellPath: null,
  shellArgs: ["-l"],
  env: {},
  scrollback: 5000,
  copyOnSelect: false,
  rightClickPastes: false,
  warnMultilinePaste: true,
  confirmCloseRunning: true,
  bell: "visual",
  wordSeparator: " ()[]{}',\"`",
};

const STYLES: TerminalStyle[] = ["workshop", "paper", "carbon"];
const CURSORS: CursorStyle[] = ["bar", "block", "underline"];
const BELLS: BellStyle[] = ["off", "visual", "sound"];

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;

/**
 * A stored value → a bare family name.
 *
 * `fontFamily` used to hold a whole CSS stack, because the field was free text.
 * It now holds one family, and this is the whole migration: take the first
 * entry and unquote it. Doing it in the merge rather than in a migration step
 * means a config written by an older build reads correctly forever, and a user
 * who hand-edits a stack back in gets the same treatment.
 */
export function normalizeFamily(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "").trim();
}

/**
 * A family name → what xterm is actually given. The fallbacks matter: a font
 * uninstalled after it was chosen must degrade to *a monospace*, never to the
 * proportional default, which would silently ruin every column alignment.
 */
export function fontStack(family: string): string {
  return `"${family.replace(/"/g, "")}", ui-monospace, monospace`;
}

/**
 * A stored partial → a complete, sane settings object.
 *
 * Every field is range-checked rather than trusted: this reads a JSON file a
 * user can hand-edit, and a fontSize of 0 or a scrollback of -1 would reach
 * xterm's constructor.
 */
export function mergeTerminalSettings(
  partial: Partial<TerminalSettings> | undefined | null,
): TerminalSettings {
  const p = (partial ?? {}) as Record<string, unknown>;
  const d = DEFAULT_TERMINAL_SETTINGS;
  return {
    style: STYLES.includes(p.style as TerminalStyle) ? (p.style as TerminalStyle) : d.style,
    fontFamily: normalizeFamily(str(p.fontFamily, d.fontFamily)) || d.fontFamily,
    fontSize: num(p.fontSize, d.fontSize, 6, 48),
    lineHeight: num(p.lineHeight, d.lineHeight, 1, 3),
    letterSpacing: num(p.letterSpacing, d.letterSpacing, -5, 20),
    cursorStyle: CURSORS.includes(p.cursorStyle as CursorStyle)
      ? (p.cursorStyle as CursorStyle)
      : d.cursorStyle,
    cursorBlink: bool(p.cursorBlink, d.cursorBlink),
    minimumContrastRatio: num(p.minimumContrastRatio, d.minimumContrastRatio, 1, 21),
    shellPath: typeof p.shellPath === "string" && p.shellPath.trim() ? p.shellPath.trim() : null,
    shellArgs: Array.isArray(p.shellArgs) && p.shellArgs.every((a) => typeof a === "string")
      ? (p.shellArgs as string[])
      : d.shellArgs,
    env:
      p.env && typeof p.env === "object" && !Array.isArray(p.env)
        ? Object.fromEntries(
            Object.entries(p.env as Record<string, unknown>).filter(
              ([k, v]) => k.length > 0 && typeof v === "string",
            ),
          ) as Record<string, string>
        : d.env,
    scrollback: Math.round(num(p.scrollback, d.scrollback, 0, 200_000)),
    copyOnSelect: bool(p.copyOnSelect, d.copyOnSelect),
    rightClickPastes: bool(p.rightClickPastes, d.rightClickPastes),
    warnMultilinePaste: bool(p.warnMultilinePaste, d.warnMultilinePaste),
    confirmCloseRunning: bool(p.confirmCloseRunning, d.confirmCloseRunning),
    bell: BELLS.includes(p.bell as BellStyle) ? (p.bell as BellStyle) : d.bell,
    wordSeparator: typeof p.wordSeparator === "string" ? p.wordSeparator : d.wordSeparator,
  };
}

/**
 * What to actually spawn.
 *
 * The default comes from the platform seam: `$SHELL` then `/bin/zsh` on macOS (its
 * default login shell, not `/bin/sh`), `/bin/bash` on Linux, and pwsh → powershell →
 * %COMSPEC% on Windows. An explicit `shellPath` always wins — that field is the
 * escape hatch, which is why it ships as free text on every platform. The extra environment is
 * merged OVER the inherited one so a user can override an inherited value —
 * that is the point of the field — but TERM is forced last, because xterm.js
 * IS an xterm-256color terminal and letting a stale inherited TERM through
 * produces a shell that renders colours it is not being given.
 */
export function resolveSpawn(
  s: TerminalSettings,
  env: NodeJS.ProcessEnv,
  /** PRD §4 Windows round: REQUIRED — see the type-only import above. */
  plat: Platform,
): { file: string; args: string[]; env: Record<string, string> } {
  const inherited: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") inherited[k] = v;
  return {
    file: s.shellPath ?? plat.terminalShell(),
    args: s.shellArgs,
    // BROWSER=none stops a dev server started in here from throwing the page at
    // the SYSTEM browser. Not a Node behaviour — it is the create-react-app
    // convention Vite and react-scripts read (vite openBrowser: `.js` path ⇒ run
    // it, "none" ⇒ do nothing, else an app name). §28 gives us a browser of our
    // own, so stealing focus into Chrome is never the wanted default.
    //
    // Before `s.env`, not after: this is a DEFAULT, and the settings env field
    // exists precisely so a user can say otherwise. Unlike TERM, which is forced
    // last because xterm.js genuinely is xterm-256color and a wrong value is a
    // broken terminal — "open my real browser" is a preference, not a defect.
    env: { ...inherited, BROWSER: "none", ...s.env, TERM: "xterm-256color" },
  };
}
