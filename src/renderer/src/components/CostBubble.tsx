import { fmtCost } from "../analytics-format";

/**
 * Session spend indicator — a small clickable pill beside the ContextBubble.
 * PRD §2: "how much they are spending in tokens" is a core promise, and §394
 * keeps money an ESTIMATE, so the pill never claims more than it knows:
 *
 *  - no calls yet        → "—" (nothing measured, not "$0.00")
 *  - every call unpriced → "$?" (the provider had no price table; $0.00 here
 *                          would read as free, which is the lie we're avoiding)
 *  - some calls unpriced → the known total with a "+?" suffix
 *
 * Deliberately quiet styling: it sits in the tab strip next to the context
 * bubble and only turns amber when part of the total is unknown.
 */
export function CostBubble({
  total,
  onOpen,
}: {
  total: HvLedgerTotal;
  onOpen: () => void;
}): React.JSX.Element {
  const base =
    "font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 cursor-pointer transition-colors";

  if (total.calls === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="No API calls billed yet — open the cost breakdown"
        aria-label="Session cost: nothing measured yet"
        className={`${base} border-line bg-card text-ink-soft hover:border-honey`}
      >
        —
      </button>
    );
  }

  const allUnpriced = total.unpriced === total.calls;
  const someUnpriced = total.unpriced > 0;
  const label = allUnpriced ? "$?" : fmtCost(total.cost) + (someUnpriced ? "+?" : "");
  const unknownNote = someUnpriced
    ? ` · ${total.unpriced} of ${total.calls} call${total.calls === 1 ? "" : "s"} has no price for its model — set one in Settings → Custom endpoint`
    : "";

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Estimated spend across ${total.calls} API call${total.calls === 1 ? "" : "s"}${unknownNote} — open the cost breakdown`}
      aria-label={`Session cost ${allUnpriced ? "unknown" : fmtCost(total.cost)} (estimated)`}
      className={
        someUnpriced
          ? `${base} border-honey/60 bg-honey-soft text-tangerine-deep hover:brightness-[0.97]`
          : `${base} border-line bg-card text-ink hover:border-honey`
      }
    >
      {label}
    </button>
  );
}
