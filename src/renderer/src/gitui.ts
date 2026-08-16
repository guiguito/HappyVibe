/**
 * §29 — pure renderer helpers for the Changes panel.
 *
 * Everything here is a decision about what the user SEES, kept out of the
 * components so it can be tested without a DOM: which tint the badge takes,
 * which primary button the panel is showing, how the file list groups.
 */

/**
 * The badge's colour, from CHANGED LINES rather than file count — one 800-line
 * file outweighs ten one-liners, and "would I be sad to lose this" tracks lines.
 *
 * There is deliberately NO red tier. Red means "broken" everywhere else in this
 * app (a failed tool call, a blocked page, a dead MCP server) and an uncommitted
 * pile is never broken — it is just getting big. Amber IS the commit nudge.
 */
export function badgeTint(changedLines: number): "green" | "amber" {
  return changedLines < AMBER_AT ? "green" : "amber";
}

export const AMBER_AT = 50;

/** Drawer width bounds (§1a). 256 was the tree's fixed width and stays the floor. */
export const DRAWER_MIN = 256;
export const DRAWER_MAX = 720;

export function clampDrawer(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_MIN;
  return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, Math.round(px)));
}

export interface PanelState {
  files: HvGitFileChange[];
  stagedCount: number;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** False on an unborn HEAD: there is nothing to publish yet. */
  hasCommits: boolean;
}

export type PrimaryAction =
  | { kind: "save"; label: string; count?: [number, number] }
  | { kind: "publish"; label: string }
  | { kind: "sync"; label: string; n: number }
  | { kind: "none" };

/**
 * Which button the panel offers, in the human verb set (§0). Note what is NOT
 * here: the ahead/behind pair. It is git-speak, so it lives in the button's
 * tooltip and the mono command line, and the human altitude gets a count.
 */
export function primaryAction(s: PanelState): PrimaryAction {
  if (s.files.length > 0) {
    if (s.stagedCount > 0 && s.stagedCount < s.files.length) {
      return { kind: "save", label: `Save ${s.stagedCount} of ${s.files.length}`, count: [s.stagedCount, s.files.length] };
    }
    return { kind: "save", label: "Save a version" };
  }
  if (!s.hasCommits) return { kind: "none" };
  if (!s.upstream) return { kind: "publish", label: "Publish branch" };
  const n = s.ahead + s.behind;
  return n > 0 ? { kind: "sync", label: `Sync (${n})`, n } : { kind: "none" };
}

export interface DirGroup {
  dir: string;
  files: HvGitFileChange[];
}

/**
 * Group by directory, alphabetically, with the repo root LAST — a root file is
 * the odd one out in a project of any size, and leading with it buries the
 * directory the user is actually working in.
 */
export function groupByDir(files: HvGitFileChange[]): DirGroup[] {
  const map = new Map<string, HvGitFileChange[]>();
  for (const f of files) {
    const slash = f.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : f.path.slice(0, slash);
    const list = map.get(dir);
    if (list) list.push(f);
    else map.set(dir, [f]);
  }
  return [...map.entries()]
    .map(([dir, list]) => ({ dir, files: list.sort((a, b) => a.path.localeCompare(b.path)) }))
    .sort((a, b) => (a.dir === "" ? 1 : b.dir === "" ? -1 : a.dir.localeCompare(b.dir)));
}

export function statusGlyph(status: HvGitFileChange["status"]): string {
  return status === "added" ? "A"
    : status === "modified" ? "M"
      : status === "deleted" ? "D"
        : status === "renamed" ? "R"
          : "U";
}

/**
 * `+n −m` for one file's diff, counted from the hunks themselves.
 *
 * `FileDiff` carries no totals — the status payload does, but a commit's diff
 * (`gitShow`) has no status behind it, and a collapsed file with no counts is a
 * row that says nothing at all. Counting the hunk lines is the only source that
 * exists for both.
 *
 * `\ No newline at end of file` is git's own annotation, not a changed line.
 */
export function countDiffLines(hunks: HvDiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+")) additions++;
      else if (l.startsWith("-")) deletions++;
    }
  }
  return { additions, deletions };
}

export interface ChangeSummary {
  files: number;
  additions: number;
  deletions: number;
  staged: number;
  /** What the badge tints on. */
  changedLines: number;
}

export function summarise(files: HvGitFileChange[]): ChangeSummary {
  let additions = 0;
  let deletions = 0;
  let staged = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
    if (f.staged) staged++;
  }
  return { files: files.length, additions, deletions, staged, changedLines: additions + deletions };
}
