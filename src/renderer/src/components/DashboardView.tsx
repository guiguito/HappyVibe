import { useEffect, useState } from "react";
import { fmtCost, fmtDuration, fmtNum } from "../analytics-format";
import { Section } from "./Section";

/** B7 — local-only analytics. Everything here is read from the JSONL event log
 * in main; nothing is ever sent anywhere. Money is labeled as an estimate. */

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-2xl bg-card border-2 border-line shadow-sticker px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">{label}</div>
      <div className="font-black text-2xl tracking-tight mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-soft mt-0.5">{sub}</div>}
    </div>
  );
}

/** Hand-rolled SVG day bars — no chart dep. Empty days between first/last render as gaps. */
function DayBars({ data }: { data: HvAnalytics["sessionsPerDay"] }): React.JSX.Element {
  if (data.length === 0) return <p className="text-sm text-ink-soft">No sessions yet — start one from a workspace in the sidebar.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const w = 22;
  const gap = 6;
  const h = 90;
  return (
    <div className="overflow-x-auto">
      <svg width={data.length * (w + gap)} height={h + 22} role="img" aria-label="Sessions per day">
        {data.map((d, i) => {
          const bh = Math.max(3, Math.round((d.count / max) * h));
          const x = i * (w + gap);
          return (
            <g key={d.date}>
              <rect x={x} y={h - bh} width={w} height={bh} rx={3} className="fill-tangerine" />
              <text x={x + w / 2} y={h - bh - 3} textAnchor="middle" className="fill-ink" fontSize="10" fontWeight="700">
                {d.count}
              </text>
              <text x={x + w / 2} y={h + 14} textAnchor="middle" className="fill-ink-soft" fontSize="8">
                {d.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BreakdownTable({
  rows,
  labelKey,
}: {
  rows: HvBreakdown[];
  labelKey?: (k: string) => string;
}): React.JSX.Element {
  if (rows.length === 0) return <p className="text-sm text-ink-soft">No data yet — this fills in once you've run a session.</p>;
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate font-bold" title={r.key}>
            {labelKey ? labelKey(r.key) : r.key}
          </span>
          <div className="flex-1 h-4 rounded-full bg-paper-deep overflow-hidden border border-line">
            <div className="h-full bg-honey" style={{ width: `${(r.tokens / max) * 100}%` }} />
          </div>
          <span className="w-28 shrink-0 text-right text-xs text-ink-soft tabular-nums">
            {r.sessions} · {fmtNum(r.tokens)} tok · {fmtCost(r.cost)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chips({ counts }: { counts: Record<string, number> }): React.JSX.Element {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <span className="text-sm text-ink-soft">Nothing yet — this fills in once you've run a session.</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1.5 rounded-full border-2 border-line bg-paper-deep px-2.5 py-0.5 text-xs font-bold"
        >
          {k}
          <span className="text-ink-soft tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  );
}

export function DashboardView({ workspaces }: { workspaces: string[] }): React.JSX.Element {
  const [workspaceId, setWorkspaceId] = useState("");
  const [data, setData] = useState<HvAnalytics | null>(null);

  useEffect(() => {
    let stale = false;
    setData(null);
    const filter = workspaceId ? { workspaceId } : undefined;
    void window.hv.getAnalytics(filter).then((a) => {
      if (!stale) setData(a);
    });
    return () => {
      stale = true;
    };
  }, [workspaceId]);

  const empty = data && data.totalSessions === 0 && data.permissions.total === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Stats</h1>
        <p className="text-sm text-ink-soft mb-6">
          Your usage, computed entirely on this machine — nothing is ever sent anywhere.
        </p>

        <div className="flex gap-3 mb-5">
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws} value={ws}>
                {basename(ws)}
              </option>
            ))}
          </select>
        </div>

        {data === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : empty ? (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-8 text-center">
            <div className="text-4xl mb-2">📊</div>
            <p className="font-bold">Nothing to show yet.</p>
            <p className="text-sm text-ink-soft mt-1">
              Start a session and chat with the agent — your stats will build up here.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Card
                label="Sessions"
                value={String(data.totalSessions)}
                sub={data.openSessions > 0 ? `${data.openSessions} still open` : undefined}
              />
              <Card
                label="Tokens"
                value={fmtNum(data.tokens.input + data.tokens.output)}
                sub={`${fmtNum(data.tokens.input)} in · ${fmtNum(data.tokens.output)} out`}
              />
              {/* Round 11: the "+?" suffix and the sub-label carry §19's rule —
                  a total that hides unknown-price calls reads as complete when
                  it is not. Plan spend is already excluded upstream. */}
              <Card
                label="Cost (est.)"
                value={fmtCost(data.cost) + (data.costUnknown ? "+?" : "")}
                sub={data.costUnknown ? "estimate — some prices unknown" : "local estimate, plan spend excluded"}
              />
              <Card
                label="Avg session"
                value={fmtDuration(data.duration.avgMs)}
                sub={data.duration.medianMs != null ? `median ${fmtDuration(data.duration.medianMs)}` : undefined}
              />
            </div>

            {/* Round 15 — the model calls the app makes on your behalf: naming a
                session, drafting AGENTS.md, writing a commit message, drafting a
                pull request. They run with no session, so they carry no usage
                record and no price: tokens, estimated, stated in a sentence
                rather than a tile, and deliberately OUTSIDE the cost above.
                §19's rule is that the ledger means what SESSIONS cost. */}
            {data.oneShot.count > 0 && (
              <p className="mt-3 text-xs text-ink-soft">
                Plus <b>{fmtNum(data.oneShot.count)}</b> model call{data.oneShot.count === 1 ? "" : "s"} the app made
                itself (session titles, AGENTS.md, commit messages, PR drafts) — roughly{" "}
                <b>{fmtNum(data.oneShot.estTokens)}</b> tokens, estimated, and not counted in the cost above.
                {data.oneShot.failed > 0 && ` ${fmtNum(data.oneShot.failed)} did not complete.`}{" "}
                <span className="text-ink-soft/70">Each one is listed in the audit log.</span>
              </p>
            )}

            <Section icon="stats" title="Sessions over time" subtitle="How much you've used the agent, day by day.">
              <DayBars data={data.sessionsPerDay} />
            </Section>

            <Section icon="models" title="By workspace" subtitle="Where your sessions happen.">
              <BreakdownTable rows={data.perWorkspace} labelKey={basename} />
            </Section>

            {data.perModel.length > 0 && (
              <Section icon="models" title="By model" subtitle="Which models you actually use — and what each one cost.">
                <BreakdownTable rows={data.perModel} />
              </Section>
            )}

            <Section icon="permissions" title="Permission activity" subtitle="What the agent asked for, and what you decided.">
              {data.permissions.total === 0 ? (
                <p className="text-sm text-ink-soft">No permission decisions yet — they appear here once the agent asks for something.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1.5">
                      by decision
                    </div>
                    <Chips counts={data.permissions.byDecision} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1.5">
                      by source
                    </div>
                    <Chips counts={data.permissions.bySource} />
                  </div>
                </div>
              )}
            </Section>

            {data.crashes > 0 && (
              <p className="text-sm text-berry font-semibold">
                {data.crashes} session{data.crashes === 1 ? "" : "s"} crashed.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
