/**
 * Round 11: a workspace's decorative emoji, DERIVED from its path.
 *
 * No picker, no stored field, no `WorkspaceEntry` change and no migration — the
 * registry flattens workspaces to bare path strings, and widening that to carry
 * one cosmetic character would not have earned its keep. Nothing depends on the
 * value, so the trade-off is accepted: moving or renaming the folder changes the
 * emoji.
 *
 * It also replaces the two-letter initials in the collapsed icon rail, which is
 * where it actually pays off — a column of emoji is scannable where `HA` / `FL`
 * / `DE` is not.
 *
 * ponytail: FNV-1a over the path rather than a hash dependency. Six lines, and
 * the only requirements are "stable" and "spread out".
 */

/** Warm, workshop-ish, and visually distinct at 16px. Length is deliberately prime-ish. */
const PALETTE = [
  "🌱", "🔧", "🎨", "🚀", "🐙", "📦", "🌊", "🔮", "🍋", "🧩",
  "🛠️", "🌵", "🎯", "🦊", "🫧", "🪴", "⚡", "🧭", "🍄", "🎸",
  "🐝", "🌻", "🥕",
];

export function workspaceEmoji(path: string): string {
  const key = path.replace(/\/+$/, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
