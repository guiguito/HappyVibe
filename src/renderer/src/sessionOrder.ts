/**
 * How the sidebar orders a workspace's sessions.
 *
 * The list LOOKED sorted before this — the ages read `6d, 6d, 8d, 9d…` — and it
 * was, by `updatedAt`. But `updatedAt` is not a "last used" stamp: it is bumped
 * by a rename, a model or thinking change, archive, hibernate, and the FIRST
 * prompt only. Prompting an existing session or opening it moved nothing, so
 * the session you had been in all morning sat where it was days ago while one
 * you merely renamed jumped to the top.
 *
 * Pure and free of any DOM, so the no-DOM suite can drive it directly — the
 * sort used to be an inline `.sort()` inside a `.map()` in the JSX, where
 * nothing could reach it.
 */

/** The two fields the order reads. Structural, so main's SessionMeta fits. */
export interface SessionLike {
  id: string;
  updatedAt: string;
  /** Set when the user opens or prompts the session; absent before it existed. */
  lastUsedAt?: string;
}

/**
 * When the user last opened or prompted this session.
 *
 * The fallback is the whole migration: a session created before `lastUsedAt`
 * existed reads as its `updatedAt`, which is exactly the order it already had,
 * so nothing jumps on the first launch after the change.
 *
 * The sidebar row's displayed age goes through this too. Order and age must
 * come from ONE fact — a row at the top showing an older age than the row below
 * it reads as a sorting bug, and two readers of one fact is the drift this repo
 * keeps paying for.
 */
export const lastUsed = (s: Pick<SessionLike, "updatedAt" | "lastUsedAt">): string =>
  s.lastUsedAt ?? s.updatedAt;

/**
 * Live first, then most recently used.
 *
 * `live` holds the sessions whose agent PROCESS is up — App's `statuses`
 * ("running" | "waking"), not its separate `busy` turn-in-flight flag. That
 * distinction is the design: pinning on `busy` would reshuffle the list at
 * every turn boundary, where pinning on the process gives "the sessions I have
 * going" a stable home at the top, and a long background run can never sink
 * out of view.
 *
 * `waking` belongs with `running` — it is the second or two while a hibernated
 * session resumes, and leaving it out would make a session you just clicked
 * drop to its old slot and jump back. `crashed` does not: the process is gone,
 * and a session you just crashed ranks high on last-used anyway.
 */
export function bySidebarOrder(live: ReadonlySet<string>): (a: SessionLike, b: SessionLike) => number {
  return (a, b) => {
    const al = live.has(a.id);
    const bl = live.has(b.id);
    if (al !== bl) return al ? -1 : 1;
    return lastUsed(b).localeCompare(lastUsed(a));
  };
}

/**
 * The order the pointer is standing on, kept while it stands there.
 *
 * Selecting a session IS use, so it re-sorts at once — and that moved the row UNDER
 * the pointer: click the session below a running one, it jumps above, the running
 * one slides into the spot, and the next click on "the same" trash icon deleted the
 * wrong session (a user lost a session mid-build this way, 2026-09-27). So while the
 * pointer is over the sidebar, rows keep the ranks captured when it arrived; the live
 * order applies the moment it leaves. A session that appeared meanwhile goes first
 * (where a new one belongs); one that vanished simply drops out.
 */
export function holdOrder<T extends { id: string }>(sorted: readonly T[], frozen: readonly string[] | null): T[] {
  if (!frozen) return [...sorted];
  const rank = new Map(frozen.map((id, i) => [id, i]));
  const fresh = sorted.filter((s) => !rank.has(s.id));
  const held = sorted.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...fresh, ...held];
}
