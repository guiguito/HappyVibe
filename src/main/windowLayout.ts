/**
 * §7 round 23 — the persisted layout is a LIST of window records, primary first.
 *
 * `setLayout()` wrote a single `layout` record keyed by workspace, so two
 * windows both writing it was last-write-wins: whichever renderer saved second
 * erased the other's tabs. The stored shape therefore grows a window dimension.
 *
 * Main stays ignorant of what a tab is: `tabsByWs` and `ui` are stored and
 * handed back OPAQUELY, and the renderer validates and prunes them
 * (layoutPersist.ts) — the same division of labour getLayout/setLayout already
 * had, and the reason this module validates only the outer list.
 *
 * Records are POSITIONAL. A window has no identity across launches, so "the
 * primary window" means "the first record", not a remembered id.
 *
 * Electron-free (the spawn.ts precedent) so the suite can drive it directly.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowRecord {
  /** Where the window was. Never persisted before round 23; comes along free. */
  bounds?: Bounds;
  /** Opaque: Record<workspaceId, WorkspaceTabs>, validated in the renderer. */
  tabsByWs: unknown;
  /** Opaque: the per-window chrome that used to sit in the shared localStorage. */
  ui: Record<string, string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Below this a restored window would be unusable, so it is better centred at default size. */
const MIN_W = 200;
const MIN_H = 150;

function parseBounds(raw: unknown): Bounds | undefined {
  if (!isRecord(raw)) return undefined;
  const n = (k: string): number | null =>
    typeof raw[k] === "number" && Number.isFinite(raw[k]) ? (raw[k] as number) : null;
  const x = n("x"), y = n("y"), width = n("width"), height = n("height");
  if (x === null || y === null || width === null || height === null) return undefined;
  if (width < MIN_W || height < MIN_H) return undefined;
  return { x, y, width, height };
}

function parseRecord(raw: unknown): WindowRecord | null {
  // The KEY must be present, even holding `{}`: an empty window (⌘⇧N, nothing
  // opened yet) is a real thing to restore, and only its absence is junk.
  if (!isRecord(raw) || !("tabsByWs" in raw)) return null;
  const ui: Record<string, string> = {};
  if (isRecord(raw.ui)) {
    for (const [k, v] of Object.entries(raw.ui)) if (typeof v === "string") ui[k] = v;
  }
  const bounds = parseBounds(raw.bounds);
  return { ...(bounds ? { bounds } : {}), tabsByWs: raw.tabsByWs ?? {}, ui };
}

/**
 * The stored value → the windows to open. Junk yields `[]`, never a throw: a
 * corrupt layout must cost the user their window arrangement, not their app
 * (layoutPersist.ts's own rule, one level out).
 */
export function parseLayoutFile(raw: unknown): WindowRecord[] {
  if (!isRecord(raw)) return [];
  if ("windows" in raw) {
    return Array.isArray(raw.windows)
      ? raw.windows.map(parseRecord).filter((r): r is WindowRecord => r !== null)
      : [];
  }
  // Legacy: the whole value WAS Record<workspaceId, WorkspaceTabs>. A workspace
  // id is its absolute path (WorkspaceRegistry stores paths), so a key called
  // "windows" cannot occur and the discriminator above is unambiguous.
  return [{ tabsByWs: raw, ui: {} }];
}
