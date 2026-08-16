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

/**
 * §28 round 1 — which SIDES of a pane touch another pane, i.e. where a drag
 * divider runs. `paneEdges` above answers only "does this pane draw a border"
 * (left/top); the embedded browser needs all four, because it insets its
 * composited view away from every divider so the 10px drag strip stays live.
 *
 * Derived from the grid cells rather than from the split rules directly: two
 * panes are neighbours when they share a row and differ by column, or share a
 * column and differ by row. That is the same question the user is asking with
 * the mouse, and it cannot drift out of step with the layout.
 */
export function paneNeighbours(
  t: WorkspaceTabs,
  slot: number,
): { left: boolean; top: boolean; right: boolean; bottom: boolean } {
  const out = { left: false, top: false, right: false, bottom: false };
  if (!t.split || t.panes[slot] == null) return out;
  const cell = (i: number): { col: number; row: number } => {
    const v = t.split === "v";
    return {
      col: (v ? i === 1 || i === 3 : i === 2 || i === 3) ? 1 : 0,
      row: (v ? i === 2 || i === 3 : i === 1 || i === 3) ? 1 : 0,
    };
  };
  const me = cell(slot);
  for (let i = 0; i < 4; i++) {
    if (i === slot || t.panes[i] == null) continue;
    const other = cell(i);
    if (other.row === me.row && other.col === me.col - 1) out.left = true;
    if (other.row === me.row && other.col === me.col + 1) out.right = true;
    if (other.col === me.col && other.row === me.row - 1) out.top = true;
    if (other.col === me.col && other.row === me.row + 1) out.bottom = true;
  }
  return out;
}

/**
 * §7 round 13 — which live pane occupies the TOP-RIGHT cell.
 *
 * The Files/Changes cluster is layout-wide but has to be rendered inside a
 * strip, because the alternatives are the two this module's header already
 * records as failures: a toolbar TRACK leaves content spanning under it (a pane
 * measuring 628px against its own 552px strip), and an overlay leaves a dead
 * gutter or pushes one pane's controls inward. Rendering it as the last item of
 * the top-right strip keeps it in the normal flow — no track, no overlay, no
 * reserved padding — and this function is the only thing that has to know which
 * strip that is.
 *
 * Derived from the same cell mapping `paneNeighbours` uses, so it cannot drift
 * out of step with the layout.
 */
export function topRightSlot(t: WorkspaceTabs): number {
  const v = t.split === "v";
  const cell = (i: number): { col: number; row: number } => ({
    col: (v ? i === 1 || i === 3 : i === 2 || i === 3) ? 1 : 0,
    row: (v ? i === 2 || i === 3 : i === 1 || i === 3) ? 1 : 0,
  });
  let best = -1;
  let bestCol = -1;
  for (let i = 0; i < 4; i++) {
    if (t.panes[i] == null) continue;
    const c = cell(i);
    // Row 0 only: the cluster belongs in the TOP bar, never in a strip that sits
    // halfway down the window.
    if (c.row !== 0) continue;
    if (c.col > bestCol) {
      bestCol = c.col;
      best = i;
    }
  }
  // Every layout has at least one live pane in row 0, but never assume it.
  return best === -1 ? 0 : best;
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
