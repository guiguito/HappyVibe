import { fmtCost, fmtNum } from "../analytics-format";
import { EmptyState } from "./EmptyState";
import { GoTo } from "./GoTo";

/**
 * §20 round 17 — doctrine rule 6: a fact the user needs TO DECIDE is inline, a
 * fact for the curious is a tooltip. The estimate caveat was per-cell hover;
 * it is one visible line now, where the numbers are actually read.
 *
 * Exported as data because the renderer suite has no DOM.
 */
export const COST_COPY = {
  estimates: "Every billed call in this session, newest first. All costs are estimates.",
  cache:
    "Cached prompt tokens: read from the provider's cache, or written into it for a later turn to read back cheaply. This is where an estimate and an invoice diverge hardest.",
} as const;

/**
 * Human names for the token classes a price table can leave unpriced. Exported
 * as DATA because the renderer suite has no DOM — the mapping is asserted
 * directly, the way STATUS_MARK is (`tests/cost-panel.test.ts`).
 */
export const UNPRICED_LABEL = {
  input: "input",
  output: "output",
  cacheRead: "cache reads",
  cacheWrite: "cache writes",
} as const;

/**
 * The tooltip for a call whose total is a FLOOR rather than the amount owed.
 *
 * It says "not priced in this build's table" rather than "unpriced by the
 * provider" on purpose: a rate of exactly 0 cannot be told apart from genuinely
 * free, and the table is the only thing we can honestly speak for.
 */
export function unpricedNote(unpriced: readonly (keyof typeof UNPRICED_LABEL)[]): string {
  const names = unpriced.map((k) => UNPRICED_LABEL[k]);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `${list} are not priced in this build's table, so the real cost is higher than this figure.`;
}

/**
 * The ⓘ exists to make the tooltip DISCOVERABLE — a bare title= on a plain
 * <th> gives no sign that hovering does anything. The tooltip itself is still
 * the browser's, so this adds no floating surface to fight the z-index scale or
 * the browser-pane coverage hit-test.
 */
function InfoDot({ text }: { text: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block size-3 ml-1 align-[-1px] text-ink-soft/70"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      role="img"
      aria-label={text}
    >
      <title>{text}</title>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  );
}

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
  leaving,
}: {
  /** Animations round: true while ChatView holds this mounted for its exit. */
  leaving?: boolean;
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
    // Round 15: an IN-PANE panel, not a full-window scrim drawer.
    //
    // It used to be `fixed inset-0` from the screen edge, so opening the cost of
    // ONE session dimmed the whole app and covered every other pane — including
    // the second chat that was streaming beside it. Cost and context are
    // properties of a session, so the panel is bounded by the pane that owns
    // the pill: `absolute` inside ChatView's relative content area, below the
    // top bar the pill sits in, exactly where the Files and Changes panels sit
    // relative to the top bar THEY are opened from.
    //
    // Deliberately not a right-drawer panel beside Files/Changes: the drawer is
    // workspace-global, and in a 2x2 with two chats it would have to guess which
    // session you meant. The scrim becomes a transparent catcher confined to the
    // same pane, so click-outside still closes without dimming anything.
    <div className="absolute inset-0 z-30 flex justify-end" onMouseDown={onClose}>
      <div
        // Animations round (2026-09-10): it slides in from its OWN edge, 12px,
        // never from off-screen — the browser-pane rule, and the same distance
        // the Files drawer travels, since this is the same gesture one surface
        // over. `leaving` is supplied by ChatView, which owns the conditional
        // render and therefore owns the exit.
        data-leaving={leaving || undefined}
        className="w-[34rem] max-w-full h-full bg-paper border-l-2 border-line-strong shadow-sticker-lg flex flex-col motion-safe:transition-[opacity,translate] motion-safe:duration-270 motion-safe:ease-hv-out motion-safe:starting:opacity-0 motion-safe:starting:translate-x-3 motion-safe:data-[leaving]:opacity-0 motion-safe:data-[leaving]:translate-x-3 motion-safe:data-[leaving]:duration-180 motion-safe:data-[leaving]:ease-hv-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b-2 border-line">
          <h2 className="font-black text-lg flex-1">Session cost</h2>
          {/* Round 15: no close button. The pill in the top bar that opened
              this is a toggle now and shows a pressed state, so a second exit
              inside the panel is the same duplication the Files panel's ⇥ was
              — one entry point, one exit, the same control. Clicking outside
              still closes. */}
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
            {hasCustomUnknown && <> Set $/Mtok on the <GoTo view="models" /> page.</>}
          </div>
        )}

        {/* Partial-price warning. Separate from the one above because it is a
            different failure: the price is not missing, it is INCOMPLETE, and
            the total below is a floor rather than an estimate either side of
            the truth. Measured at this pin: 91 of the 340 input-priced
            OpenRouter models price cache reads at 0, and cache reads are most
            of a coding agent's prompt tokens. */}
        {total.partial > 0 && (
          <div className="px-5 py-2.5 border-b-2 border-honey/40 bg-honey-soft text-xs text-tangerine-deep">
            <strong>{total.partial}</strong> of {total.calls} call{total.calls === 1 ? "" : "s"} burned
            tokens this build&rsquo;s price table does not price — those rows show{" "}
            <span className="font-mono">+</span>, and the total is a floor, not the amount owed.
          </div>
        )}

        {/* Calls */}
        <div className="px-5 py-2 text-xs text-ink-soft border-b-2 border-line">
          {COST_COPY.estimates}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <EmptyState copy="costs" className="m-5" />
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-paper">
                <tr className="text-[10px] font-bold uppercase tracking-wide text-ink-soft border-b-2 border-line">
                  <th className="text-left px-3 py-1.5 font-bold">When</th>
                  <th className="text-left px-2 py-1.5 font-bold">Model</th>
                  <th className="text-right px-2 py-1.5 font-bold">In</th>
                  <th className="text-right px-2 py-1.5 font-bold">Out</th>
                  <th className="text-right px-2 py-1.5 font-bold">
                    Cache
                    <InfoDot text={COST_COPY.cache} />
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
                    {/* A delegation's calls are the session's spend too, but a
                        reader has to be able to tell whose turn burned it.
                        The agent goes on its OWN line rather than after the
                        model: this column truncates at 11rem and a model id is
                        already longer than that, so an inline suffix was clipped
                        away every time — the marker the footnote promises has to
                        survive the truncation that hides it. */}
                    <td
                      className="px-2 py-1.5 font-mono max-w-[11rem]"
                      title={`${c.provider} / ${c.model}${c.agent ? ` — sub-agent ${c.agent}` : ""}`}
                    >
                      <span className="block truncate">{c.model}</span>
                      {c.agent && (
                        <span className="block truncate text-[10px] text-tangerine-deep">↳ {c.agent}</span>
                      )}
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
                        would read as money owed.

                        A PARTIAL call is the third shape and the reason this
                        column exists at all: priced input and output, an
                        unpriced cache read, and a total that is therefore a
                        floor. It renders the figure with a trailing "+" in
                        amber but NOT bold — bold is reserved for "?", which is
                        a bigger gap. Before this, a call understated by the
                        bulk of its spend was indistinguishable from an exact
                        one. */}
                    <td
                      className={`px-3 py-1.5 font-mono text-right ${
                        c.billing === "unknown"
                          ? "text-tangerine-deep font-bold"
                          : c.billing === "plan"
                            ? "text-ink-soft"
                            : c.unpriced?.length
                              ? "text-tangerine-deep"
                              : ""
                      }`}
                      title={
                        c.billing === "unknown"
                          ? "No price for this model — cost unknown"
                          : c.billing === "plan"
                            ? `Covered by your ${c.provider} subscription — no per-token charge`
                            : c.unpriced?.length
                              ? unpricedNote(c.unpriced)
                              : undefined
                      }
                    >
                      {c.billing === "metered"
                        ? `${fmtCost(c.cost)}${c.unpriced?.length ? "+" : ""}`
                        : c.billing === "plan"
                          ? "plan"
                          : "?"}
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
          spend is included: a delegation's own calls appear as rows named after the agent that made
          them.
        </div>
      </div>
    </div>
  );
}
