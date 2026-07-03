/**
 * StatsBadge — shows cumulative token usage and cost from `get_session_stats`.
 *
 * Data shape (from pi-coding-agent dist/core/agent-session.d.ts SessionStats):
 *   tokens.input  : number
 *   tokens.output : number
 *   tokens.cacheRead  : number
 *   tokens.cacheWrite : number
 *   tokens.total  : number   ← displayed
 *   cost          : number   ← displayed (USD, plain number — NOT cost.total)
 *
 * `window.hv.getStats()` returns `response.data` (the SessionStats object directly),
 * per the ipc handler: `(await client?.send({ type: "get_session_stats" }))?.data ?? null`
 */
import { useEffect, useState } from "react";

type StatsShape = {
  tokens?: { total?: number };
  cost?: number;
};

export function StatsBadge({ refreshKey }: { refreshKey: number }): React.JSX.Element {
  const [stats, setStats] = useState<StatsShape | null>(null);

  useEffect(() => {
    window.hv.getStats().then((s) => setStats(s as StatsShape));
  }, [refreshKey]);

  if (!stats) return <span className="stats-badge">tokens: –</span>;

  const tokens = stats.tokens?.total ?? "?";
  const cost = typeof stats.cost === "number" ? stats.cost.toFixed(4) : "?";

  return (
    <span className="stats-badge">
      tokens: {tokens} · cost: ${cost}
    </span>
  );
}
