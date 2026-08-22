/**
 * FR4 — the child's half of the permission engine: the SAME rules, with `ask`
 * clamped to `deny`.
 *
 * Why there is no third option. A sub-agent child runs `--mode json -p` with
 * stdin ignored and a no-op UI context, so `ctx.ui.select` inside one returns
 * `undefined` — silently. That is fail-closed, but it is mislabeled
 * `source:"user"` (nobody chose it) and its audit notify reaches nothing. A child
 * cannot ask a human, so the honest translation of "ask" in a child is "refuse,
 * and tell the model where this belongs".
 *
 * PURE, like hv-rules.ts, and it REUSES that engine rather than re-deriving a
 * verdict. One engine: a child must be judged by exactly the rules the user
 * wrote for the parent, or the audit log describes a policy nobody configured.
 */
import { evaluate, SAFE_TOOLS, type RuleAction, type RulesFile, type ToolCall } from "./hv-rules";

export interface ChildDecision {
  /** What happens. A child has no `ask`. */
  action: "allow" | "deny";
  /** Present on every deny, absent on every allow. */
  reason?: string;
  /**
   * The ENGINE's verdict (allow | ask | deny), kept verbatim.
   *
   * Same reasoning as the parent's `wouldHave` audit field: "ask" is not an
   * outcome, and mapping it onto one is exactly the misreport this field exists
   * to prevent. It is what lets a row say "denied in a sub-agent; the rules would
   * have prompted you" instead of implying the user configured a deny.
   */
  wouldHave: RuleAction;
}

function denyReason(tool: string, wouldHave: RuleAction): string {
  const because =
    wouldHave === "ask"
      ? "it would have needed your approval, and a sub-agent cannot ask"
      : "a permission rule denies it";
  return (
    `Blocked: '${tool}' is outside the boundary approved for this sub-agent — ${because}. ` +
    `Do not retry it and do not work around it. Finish what you can with the tools you have and ` +
    `report what you could not do, so the main session can run it where each call is checked ` +
    `individually.`
  );
}

/**
 * Decide one child tool call.
 *
 * `rulesReadable: false` means the rules file was absent or unparseable, and it
 * must NOT collapse to "no rules, so the safe defaults apply" — that would turn a
 * missing file into a permission grant. Safe-default reads stay open, because
 * reading is not the hazard and a child that cannot read is indistinguishable
 * from a broken feature.
 */
export function childDecision(
  rules: RulesFile,
  call: ToolCall,
  opts: { bypass: boolean; rulesReadable: boolean },
): ChildDecision {
  const v = evaluate(rules, call);
  // FR6: bypass extends to children — bypass means bypass (PRD §10) — but the row
  // still records the verdict it overrode, exactly like the parent's
  // source:"bypass". Checked before the fail-closed branch so an unreadable rules
  // file cannot re-arm a gate the user explicitly turned off.
  if (opts.bypass) return { action: "allow", wouldHave: v.action };
  if (!opts.rulesReadable && !SAFE_TOOLS.has(call.tool)) {
    return { action: "deny", reason: denyReason(call.tool, "ask"), wouldHave: "ask" };
  }
  if (v.action === "allow") return { action: "allow", wouldHave: v.action };
  return { action: "deny", reason: denyReason(call.tool, v.action), wouldHave: v.action };
}
