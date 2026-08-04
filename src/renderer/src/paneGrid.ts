/**
 * Round 11: the CSS grid for a 2×2 pane layout, derived from the tab model.
 *
 * Its OWN module, not App.tsx: vite-plugin-react's Fast Refresh requires a
 * component module to export only components, so exporting this from App made
 * every App edit a FULL page reload ("Could not Fast Refresh — buildGridStyle
 * export is incompatible"). A reload drops tabsByWs, which is not persisted, so
 * each edit dumped the app back to an empty layout — it looked like a crash.
 */
import type { WorkspaceTabs } from "./tabs";

/**
 * Build the grid.
 *
 * Every pane's content is mounted ONCE and placed by `grid-area` (the invariant
 * in tabs.ts), so the geometry has to be expressible as named areas in ONE flat
 * grid — no nested containers. Consequences, both deliberate:
 *
 *  - a half that is NOT cross-split spans both content rows/columns, so it fills
 *    its side while the other half is divided;
 *  - the cross divider is shared (`sizes.cross`), because in a flat grid the two
 *    halves' inner tracks are literally the same tracks.
 *
 * The toolbar (§7 round 5.1) keeps its own always-present cell in the strip row,
 * and content in the rows BELOW it spans into that column rather than wasting it.
 *
 * That span is why the first track is an exact PERCENTAGE and not an `fr`. With
 * `1fr 1fr auto`, half A gets (W−toolbar)/2 while half B gets (W−toolbar)/2 +
 * toolbar — measured 538 vs 718 at a claimed 50/50, and the draggable handle,
 * positioned at `main%` of the container, sat 90px off the boundary it moves. A
 * percentage first track puts that boundary exactly at `main%` of the full width,
 * so the halves are equal AND the handle is on its own line.
 *
 * The row form subtracts the strip rows for the same reason: the cross boundary
 * is `44px + inner`, so the inner track is `calc(cross% − 44px)`.
 */
/** Tab-strip height — must match the `h-11` on every strip cell. */
const STRIP_PX = 44;

export function buildGridStyle(t: WorkspaceTabs): React.CSSProperties {
  /** Two columns whose FIRST boundary lands exactly at `r` of the full width. */
  const cols = (r: number): string => `${r * 100}% minmax(0,1fr)`;
  /** Four rows (strip, content, strip, content) with the boundary at `r` of the height. */
  const rows = (r: number): string =>
    `${STRIP_PX}px calc(${r * 100}% - ${STRIP_PX}px) ${STRIP_PX}px minmax(0,1fr)`;
  const [subA, subB] = t.subSplit;

  if (!t.split) {
    return {
      gridTemplateColumns: "minmax(0,1fr) auto",
      gridTemplateRows: `${STRIP_PX}px minmax(0,1fr)`,
      gridTemplateAreas: '"stripA toolbar" "contentA contentA"',
    };
  }

  if (t.split === "v") {
    // Halves side by side; a cross-split half divides into ROWS.
    if (!subA && !subB) {
      return {
        gridTemplateColumns: `${cols(t.sizes.main)} auto`,
        gridTemplateRows: `${STRIP_PX}px minmax(0,1fr)`,
        gridTemplateAreas: '"stripA stripB toolbar" "contentA contentB contentB"',
      };
    }
    // Four rows: stripA/B, upper content, the inner strip row, lower content.
    const colA = subA ? ["contentA", "stripC", "contentC"] : ["contentA", "contentA", "contentA"];
    const colB = subB ? ["contentB", "stripD", "contentD"] : ["contentB", "contentB", "contentB"];
    return {
      gridTemplateColumns: `${cols(t.sizes.main)} auto`,
      gridTemplateRows: rows(t.sizes.cross),
      gridTemplateAreas: [
        '"stripA stripB toolbar"',
        `"${colA[0]} ${colB[0]} ${colB[0]}"`,
        `"${colA[1]} ${colB[1]} ${colB[1]}"`,
        `"${colA[2]} ${colB[2]} ${colB[2]}"`,
      ].join(" "),
    };
  }

  // split === "h": halves stacked; a cross-split half divides into COLUMNS.
  if (!subA && !subB) {
    return {
      gridTemplateColumns: "minmax(0,1fr) auto",
      gridTemplateRows: rows(t.sizes.main),
      gridTemplateAreas:
        '"stripA toolbar" "contentA contentA" "stripB stripB" "contentB contentB"',
    };
  }
  const rowA = subA
    ? ['"stripA stripC toolbar"', '"contentA contentC contentC"']
    : ['"stripA stripA toolbar"', '"contentA contentA contentA"'];
  const rowB = subB
    ? ['"stripB stripD stripD"', '"contentB contentD contentD"']
    : ['"stripB stripB stripB"', '"contentB contentB contentB"'];
  return {
    gridTemplateColumns: `${cols(t.sizes.cross)} auto`,
    gridTemplateRows: rows(t.sizes.main),
    gridTemplateAreas: [...rowA, ...rowB].join(" "),
  };
}
