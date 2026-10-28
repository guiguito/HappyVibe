/**
 * Appearance › Density — how much room the app gives everything.
 *
 * Compact is ONE variable, not a second stylesheet: Tailwind derives every
 * spacing step (padding, margin, gap, and the width or height of anything sized
 * in steps) from `--spacing`, so overriding it on the root tightens the whole
 * app at once and nothing can be forgotten. Type sizes are their own tokens and
 * keep their size, so nothing gets harder to read. The conversation's column
 * (`max-w-chat`, the `--container-chat` token) widens with it: on a wide window
 * its side margins were the space people asked to get back. The rule lives in
 * styles.css; the switch is `data-density` on the root element.
 *
 * Ultra-compact goes one step further and makes TEXT smaller too: the root font
 * size drops to 14px, so everything sized in rem (spacing, type, icons, widths)
 * shrinks by the same eighth and the proportions hold. Tightening `--spacing`
 * alone further was tried first and rejected: steps also size icons and the
 * sidebar, which shrank below legible while text kept its size.
 *
 * Global, like the Terminal settings: main stores it in config.json and hands
 * it to every window at boot, synchronously, so a compact app never paints one
 * comfortable frame first.
 *
 * Imports nothing: main validates with it, the renderer draws the page from it.
 */

export type Density = "comfortable" | "compact" | "ultra-compact";

export const DEFAULT_DENSITY: Density = "comfortable";

export const DENSITIES: ReadonlyArray<{ id: Density; name: string; note: string }> = [
  { id: "comfortable", name: "Comfortable", note: "Room around everything, and the conversation in a reading-width column." },
  { id: "compact", name: "Compact", note: "Tighter spacing everywhere, and the conversation uses more of the window. Text keeps its size." },
  { id: "ultra-compact", name: "Ultra-compact", note: "Compact, with text a size smaller too, to fit more on the screen." },
];

export function isDensity(v: unknown): v is Density {
  return v === "comfortable" || v === "compact" || v === "ultra-compact";
}
