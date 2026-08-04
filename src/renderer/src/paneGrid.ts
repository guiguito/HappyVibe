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
 * THE TOOLBAR IS NOT A COLUMN. It used to occupy a third column present only in
 * row 1, while content below spanned into it — so a pane's content measured 628px
 * while its own tab strip measured 552px, strips in different rows had different
 * right edges, and the bottom-right pane's controls sat flush against the window
 * while the top-right pane's stopped short. Reserving that column in every row
 * instead would leave a permanently dead ~76px gutter. So the toolbar is an
 * absolute overlay (App.tsx) and only the strip that shares row 1 with it —
 * `toolbarSlot` below — pads itself clear. Every strip now spans exactly its pane.
 */
import type { WorkspaceTabs } from "./tabs";

/** Tab-strip height — must match the `h-11` on every strip cell. */
const STRIP_PX = 44;

/**
 * Which pane's strip shares row 1 with the toolbar overlay, and therefore has to
 * keep its own controls clear of it.
 */
export function toolbarSlot(t: WorkspaceTabs): number {
  if (!t.split) return 0;
  if (t.split === "v") return 1; // halves side by side → B is rightmost in row 1
  return t.subSplit[0] ? 2 : 0; // halves stacked → row 1 is A, or A|C when A is split
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
