import { fmtCost, fmtNum } from "../analytics-format";

/**
 * Per-call cost breakdown (opened from the CostBubble). A flat, time-ordered
 * list with a model column — a session can change model mid-way, so a single
 * blended rate would be a fiction.
 *
 * Cache reads get their OWN column rather than being folded into "input"
 * because that is where estimate and invoice diverge hardest: Pi bills from a
 * price table pinned at the vendored pi-ai version, and 128 of its 266
 * OpenRouter entries price cacheRead at 0 while cache reads are the large
 * majority of a coding agent's prompt tokens. Showing the split is what makes a
 * mismatch against a provider dashboard diagnosable instead of mysterious.
 *
 * Every number is an ESTIMATE (PRD §394) and says so. A call with tokens but no
 * price shows "?" — not "$0.00", which would read as free.
 */
const time = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const day = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="font-mono text-sm font-bold">{value}</span>
    </div>
  );
}

export function CostPanel({
  calls,
  total,
  onClose,
}: {
  calls: HvApiCall[];
  total: HvLedgerTotal;
  onClose: () => void;
}): React.JSX.Element {
  // Newest first: the call you just paid for is the one you came to look at.
  const rows = [...calls].reverse();
  // A day header only helps once a session spans more than one date.
  const multiDay = new Set(calls.map((c) => day(c.ts))).size > 1;
  const allPlan = total.calls > 0 && total.metered === 0 && total.unknown === 0;
  // Custom endpoints are the only unknown-price case the user can fix, and they
  // are exactly the `hv-<id>` provider keys modelsJson writes.
  const hasCustomUnknown = calls.some((c) => c.billing === "unknown" && c.provider.startsWith("hv-"));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onMouseDown={onClose}>
      <div
        className="w-[34rem] max-w-full h-full bg-paper border-l-2 border-line-strong shadow-sticker-lg flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b-2 border-line">
          <h2 className="font-black text-lg flex-1">Session cost</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:text-ink text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Totals */}
        <div className="px-5 py-3 border-b-2 border-line flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-2xl">
              {allPlan ? "plan" : total.metered === 0 && total.calls > 0 ? "$?" : fmtCost(total.cost)}
            </span>
            {!allPlan && (
              <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-paper-deep text-ink-soft">
                estimated
              </span>
            )}
            <span className="font-mono text-xs text-ink-soft">
              {total.calls} call{total.calls === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Stat label="input" value={fmtNum(total.input)} />
            <Stat label="output" value={fmtNum(total.output)} />
            <Stat label="cache read" value={fmtNum(total.cacheRead)} />
            <Stat label="cache write" value={fmtNum(total.cacheWrite)} />
          </div>
        </div>

        {/* Plan note — a fact, not a warning, so it stays calm. Naming it is what
            stops the user reading "plan" rows as spend we failed to measure. */}
        {total.plan > 0 && (
          <div className="px-5 py-2.5 border-b-2 border-line bg-card text-xs text-ink-soft">
            <strong className="text-ink">{total.plan}</strong> of {total.calls} call
            {total.calls === 1 ? "" : "s"} ran on a flat subscription, so there is no per-token charge
            for {total.plan === 1 ? "it" : "them"} — those rows show <span className="font-mono">plan</span>{" "}
            and are left out of the total.
          </div>
        )}

        {/* Unknown-price warning — the "$0.00 always" case, named so it's fixable.
            The Settings hint appears only when a HappyVibe-managed endpoint is
            actually involved (providerKey is `hv-<id>`); pointing a Copilot or
            zai user at "Custom endpoint" would be wrong advice. */}
        {total.unknown > 0 && (
          <div className="px-5 py-2.5 border-b-2 border-honey/40 bg-honey-soft text-xs text-tangerine-deep">
            <strong>{total.unknown}</strong> of {total.calls} call{total.calls === 1 ? "" : "s"} has no
            price for its model, so its cost is unknown — not zero.
            {hasCustomUnknown && " Set $/Mtok in Settings → Custom endpoint."}
          </div>
        )}

        {/* Calls */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-soft">
              No API calls billed to this session yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-paper">
                <tr className="text-[10px] font-bold uppercase tracking-wide text-ink-soft border-b-2 border-line">
                  <th className="text-left px-3 py-1.5 font-bold">When</th>
                  <th className="text-left px-2 py-1.5 font-bold">Model</th>
                  <th className="text-right px-2 py-1.5 font-bold">In</th>
                  <th className="text-right px-2 py-1.5 font-bold">Out</th>
                  <th className="text-right px-2 py-1.5 font-bold" title="Cached prompt tokens (cache read / write)">
                    Cache
                  </th>
                  <th className="text-right px-3 py-1.5 font-bold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  // Pi can emit two calls in the same millisecond, so the index
                  // is part of the key — ts alone is not unique.
                  <tr key={`${c.ts}-${i}`} className="border-b border-line/60 hover:bg-card">
                    <td className="px-3 py-1.5 font-mono text-ink-soft whitespace-nowrap">
                      {multiDay && <span className="mr-1">{day(c.ts)}</span>}
                      {time(c.ts)}
                    </td>
                    <td className="px-2 py-1.5 font-mono max-w-[11rem] truncate" title={`${c.provider} / ${c.model}`}>
                      {c.model}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-right">{fmtNum(c.input)}</td>
                    <td className="px-2 py-1.5 font-mono text-right">{fmtNum(c.output)}</td>
                    <td
                      className="px-2 py-1.5 font-mono text-right text-ink-soft"
                      title={`${c.cacheRead.toLocaleString()} read · ${c.cacheWrite.toLocaleString()} written`}
                    >
                      {fmtNum(c.cacheRead + c.cacheWrite)}
                    </td>
                    {/* "plan" is muted (a fact), "?" is amber (a gap). Pi's
                        API-rate arithmetic for a plan call is never shown — it
                        would read as money owed. */}
                    <td
                      className={`px-3 py-1.5 font-mono text-right ${
                        c.billing === "unknown" ? "text-tangerine-deep font-bold" : c.billing === "plan" ? "text-ink-soft" : ""
                      }`}
                      title={
                        c.billing === "unknown"
                          ? "No price for this model — cost unknown"
                          : c.billing === "plan"
                            ? `Covered by your ${c.provider} subscription — no per-token charge`
                            : undefined
                      }
                    >
                      {c.billing === "metered" ? fmtCost(c.cost) : c.billing === "plan" ? "plan" : "?"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t-2 border-line text-[11px] text-ink-soft leading-snug">
          Estimated from the price table pinned in this build — a provider that routes to different
          upstreams (OpenRouter) or discounts cache hits will invoice a different figure. Sub-agent
          spend is reported on each delegation card, not here.
        </div>
      </div>
    </div>
  );
}
