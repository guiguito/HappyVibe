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

/**
 * Words that named macOS in copy the whole app shows (PRD §4, Windows round).
 *
 * "this Mac" photographs perfectly well on Windows and is simply untrue, which is the
 * class of bug a green test suite cannot see. Where a neutral word is honest on every
 * platform it wins outright — "this computer" needs no third variant for Linux, and a
 * beginner reads it the same way. Where the thing itself has a platform NAME, the name
 * is what the user is looking for on screen, so it varies.
 */

/** Neutral on purpose — true on all three platforms, no Linux variant needed. */
export const THIS_COMPUTER = "this computer";
export const YOUR_COMPUTER = "your computer";

/** The OS file manager, by the name it has in that OS's own UI. */
export function revealLabel(platform: string): string {
  if (platform === "darwin") return "Reveal in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Show in file manager";
}
export const REVEAL_IN_FILE_MANAGER: string = revealLabel(here);

/** Where a user turns the microphone back on, and what it takes to apply. */
export const MIC_DENIED_HINT: string =
  here === "darwin"
    ? "Access is denied. Grant it in System Settings — macOS requires the app to be restarted before the change takes effect."
    : here === "win32"
      ? "Access is denied. Turn the microphone on for HappyVibe in Settings → Privacy & security → Microphone."
      : "Access is denied. Grant microphone access to HappyVibe in your system settings.";
