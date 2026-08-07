/**
 * Round 11: the CSS grid for a 2×2 pane layout, derived from the tab model.
 *
 * Its OWN module, not App.tsx: vite-plugin-react's Fast Refresh requires a
 * component module to export only components, so exporting this from App made
 * every App edit a FULL page reload ("Could not Fast Refresh — buildGridStyle
 * export is incompatible"). A reload drops tabsByWs, which is not persisted, so
 * each edit dumped the app back to an empty layout — it looked like a crash.
 *
 * Every pane's content is mounted ONCE and placed by `grid-area` (the invariant
 * in tabs.ts), so the geometry has to be expressible as named areas in ONE flat
 * grid — no nested containers. Two consequences, both deliberate:
 *
 *  - a half that is NOT cross-split spans the tracks below its strip, so it fills
 *    its side while the other half is divided;
 *  - the cross divider is shared (`sizes.cross`), because in a flat grid the two
 *    halves' inner tracks are literally the same tracks.
 *
 * THERE IS NO TOOLBAR TRACK. A global toolbar used to occupy a third column
 * present only in row 1, while content below spanned into it — so a pane's content
 * measured 628px while its own strip measured 552px, and no two strips shared a
 * right edge. Reserving that column in every row would have left a permanently
 * dead ~76px gutter; making it an overlay instead pushed the top-right pane's
 * controls 96px inward while every other pane's sat flush. Both were the same
 * mistake: a layout-wide control cannot share a per-pane row. Every layout control
 * now lives in its own pane's strip (TabStrip.tsx), so the grid is purely panes and
 * every strip spans exactly the one it belongs to.
 */
import type { WorkspaceTabs } from "./tabs";

/** Tab-strip height — must match the `h-11` on every strip cell. */
const STRIP_PX = 44;


/**
 * Which edges a pane draws, so adjacent panes never double a rule or leave a gap.
 *
 * A pane can sit in column 2 AND row 2 at once — slot 3 always does — and the old
 * per-area rule returned only ONE border, so the primary divider stopped halfway
 * down at the cross split (measured: contentD had border-t and no border-l, while
 * contentB above it had border-l). The caller must also apply `top` to the tab
 * STRIP only: a strip already draws its own bottom rule, so a border-t on the
 * content beneath it doubled the line to 4px.
 */
export function paneEdges(t: WorkspaceTabs, slot: number): { left: boolean; top: boolean } {
  if (!t.split) return { left: false, top: false };
  const v = t.split === "v";
  // Which grid cell the slot occupies: halves lie along the primary axis, their
  // cross partners across it.
  const col2 = v ? slot === 1 || slot === 3 : slot === 2 || slot === 3;
  const row2 = v ? slot === 2 || slot === 3 : slot === 1 || slot === 3;
  return { left: col2, top: row2 };
}

export function buildGridStyle(t: WorkspaceTabs): React.CSSProperties {
  /** Two columns whose boundary lands exactly at `r` of the full width. */
  const cols = (r: number): string => `${r * 100}% minmax(0,1fr)`;
  /** Four rows (strip, content, strip, content) with the boundary at `r` of the height. */
  const rows = (r: number): string =>
    `${STRIP_PX}px calc(${r * 100}% - ${STRIP_PX}px) ${STRIP_PX}px minmax(0,1fr)`;
  const [subA, subB] = t.subSplit;

  if (!t.split) {
    return {
      gridTemplateColumns: "minmax(0,1fr)",
      gridTemplateRows: `${STRIP_PX}px minmax(0,1fr)`,
      gridTemplateAreas: '"stripA" "contentA"',
    };
  }

  if (t.split === "v") {
    // Halves side by side; a cross-split half divides into ROWS.
    if (!subA && !subB) {
      return {
        gridTemplateColumns: cols(t.sizes.main),
        gridTemplateRows: `${STRIP_PX}px minmax(0,1fr)`,
        gridTemplateAreas: '"stripA stripB" "contentA contentB"',
      };
    }
    const colA = subA ? ["contentA", "stripC", "contentC"] : ["contentA", "contentA", "contentA"];
    const colB = subB ? ["contentB", "stripD", "contentD"] : ["contentB", "contentB", "contentB"];
    return {
      gridTemplateColumns: cols(t.sizes.main),
      gridTemplateRows: rows(t.sizes.cross),
      gridTemplateAreas: [
        '"stripA stripB"',
        `"${colA[0]} ${colB[0]}"`,
        `"${colA[1]} ${colB[1]}"`,
        `"${colA[2]} ${colB[2]}"`,
      ].join(" "),
    };
  }

  // split === "h": halves stacked; a cross-split half divides into COLUMNS.
  if (!subA && !subB) {
    return {
      gridTemplateColumns: "minmax(0,1fr)",
      gridTemplateRows: rows(t.sizes.main),
      gridTemplateAreas: '"stripA" "contentA" "stripB" "contentB"',
    };
  }
  const rowA = subA
    ? ['"stripA stripC"', '"contentA contentC"']
    : ['"stripA stripA"', '"contentA contentA"'];
  const rowB = subB
    ? ['"stripB stripD"', '"contentB contentD"']
    : ['"stripB stripB"', '"contentB contentB"'];
  return {
    gridTemplateColumns: cols(t.sizes.cross),
    gridTemplateRows: rows(t.sizes.main),
    gridTemplateAreas: [...rowA, ...rowB].join(" "),
  };
}
