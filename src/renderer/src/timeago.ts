/**
 * Round 15 — "how long ago" and "how long it took", in the fewest characters
 * that stay unambiguous.
 *
 * Two consumers with slightly different needs, so one function each rather than
 * a format flag: the sidebar shows a bare age in a slot ~24px wide (`3h`), and
 * the transcript suffixes it (`3h ago`) where there is room for the word.
 *
 * Deliberately no Intl.RelativeTimeFormat: it produces "3 hours ago", which is
 * three times the width for the same fact, and its rounding for "yesterday" /
 * "last month" reads oddly on a list where every row is minutes apart.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/**
 * A compact age: `now`, `5m`, `3h`, `2d`, `4mo`.
 *
 * Anything under a minute is "now" — a session row ticking `12s`, `13s` would
 * be motion with no information. A future timestamp (clock skew, a machine that
 * slept) also reads "now" rather than a negative age.
 */
export function timeago(tsMs: number, nowMs: number = Date.now()): string {
  const d = nowMs - tsMs;
  if (!Number.isFinite(d) || d < MIN) return "now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < MONTH) return `${Math.floor(d / DAY)}d`;
  return `${Math.floor(d / MONTH)}mo`;
}

/**
 * How long a turn took: `0.8s`, `34s`, `2m 10s`, `1h 4m`.
 *
 * Sub-minute keeps one decimal below 10s, because the difference between a
 * 0.4s and a 4s turn is the difference between "instant" and "it thought about
 * it", and both would otherwise print as `0s` / `4s`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < MIN) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) {
    const m = Math.floor(ms / MIN);
    const s = Math.round((ms % MIN) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MIN);
  return m ? `${h}h ${m}m` : `${h}h`;
}
