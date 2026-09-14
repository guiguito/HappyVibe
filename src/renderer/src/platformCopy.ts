/**
 * PRD §4 (Windows round): the modifier glyph, for COPY.
 *
 * Shortcut MATCHING already collapses ⌘ and Ctrl to `Mod` (shortcuts.ts's
 * `eventToBinding`), so a binding works on Windows without any of this. What did not
 * travel is the printed text: sixteen renderer files spelled `⌘` as a literal, and a
 * Windows user read a hint naming a key their keyboard does not have.
 *
 * A build-time platform constant, not an IPC round trip — `window.hv.platform` is a
 * property of THIS process and is available before the first paint.
 */
export function modKey(platform: string): string {
  return platform === "darwin" ? "⌘" : "Ctrl";
}

/** This process's platform, safe to read from a module imported by a pure test. */
const here = typeof window !== "undefined" && window.hv ? window.hv.platform : "darwin";

/** The running platform's modifier glyph, for interpolation into copy. */
export const MOD: string = modKey(here);

export const IS_WINDOWS: boolean = here === "win32";

/** `true` when shortcut text should use Mac glyphs — what formatBinding's flag wants. */
export const IS_MAC: boolean = here === "darwin";
