import { costPill, fmtCost, type CostTone } from "../analytics-format";

/**
 * Session spend indicator — a small clickable pill beside the ContextBubble.
 * PRD §2: "how much they are spending in tokens" is a core promise, and §394
 * keeps money an ESTIMATE, so the pill never claims more than it knows.
 *
 * The label/tone decision lives in analytics-format.costPill (pure, unit-tested);
 * this component only maps a tone to classes and writes the tooltip. Amber is
 * reserved for genuinely unknown money — a plan-covered call is a fact, not a
 * gap, so it stays calm and is explained in the tooltip and the panel.
 */
/**
 * Round 15: two states per tone. The panel lost its close button — this pill IS
 * the toggle, so it shows whether the panel is open, like the Files/Changes
 * rail buttons do. The neutral tones take the ⌕ button's tangerine pressed
 * treatment; amber keeps its own hue, because there it means "unknown money"
 * and overwriting it to say "open" would trade information for state.
 */
const TONE: Record<CostTone, { rest: string; pressed: string }> = {
  quiet: {
    rest: "border-line bg-card text-ink-soft hover:border-honey",
    pressed: "border-tangerine bg-honey-soft text-tangerine-deep",
  },
  calm: {
    rest: "border-line bg-card text-ink hover:border-honey",
    pressed: "border-tangerine bg-honey-soft text-tangerine-deep",
  },
  amber: {
    rest: "border-honey/60 bg-honey-soft text-tangerine-deep hover:brightness-[0.97]",
    pressed: "border-honey bg-honey-soft text-tangerine-deep brightness-95",
  },
};

const plural = (n: number): string => (n === 1 ? "" : "s");

export function CostBubble({
  total,
  open,
  onToggle,
}: {
  total: HvLedgerTotal;
  /** Round 15: whether the cost panel is showing — the pill reflects it. */
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { label, tone } = costPill(total);
  const verb = open ? "close" : "open";

  let title: string;
  let aria: string;
  if (total.calls === 0) {
    title = `No API calls billed yet — ${verb} the cost breakdown`;
    aria = "Session cost: nothing measured yet";
  } else if (label === "plan") {
    title = `${total.calls} API call${plural(total.calls)} covered by your subscription — no per-token charge. ${open ? "Close" : "Open"} the cost breakdown.`;
    aria = "Session cost: covered by your subscription";
  } else {
    const planNote = total.plan
      ? ` · ${total.plan} call${plural(total.plan)} covered by a subscription (not billed per token)`
      : "";
    const unknownNote = total.unknown
      ? ` · ${total.unknown} call${plural(total.unknown)} has no price for its model`
      : "";
    title = `Estimated spend across ${total.metered} billed call${plural(total.metered)}${planNote}${unknownNote} — ${verb} the cost breakdown`;
    aria = `Session cost ${total.metered === 0 ? "unknown" : fmtCost(total.cost)} (estimated)`;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={title}
      aria-label={aria}
      className={`font-mono text-[11px] font-bold rounded-full border-2 px-2.5 py-1 cursor-pointer transition-colors ${open ? TONE[tone].pressed : TONE[tone].rest}`}
    >
      {label}
    </button>
  );
}
