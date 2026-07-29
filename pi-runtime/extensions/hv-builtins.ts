/**
 * §13 round 6 — which built-in custom tools this session may register, plus the
 * user's append to Plan Mode's prompt. Resolved by main at spawn and passed in
 * HV_BUILTINS (same pattern as HV_BYPASS). Fail-open: a corrupt value must
 * never silently disable a tool the user believes is on.
 */
export interface BuiltinToggles {
  plan: boolean;
  askUser: boolean;
  planAppend: string;
}

export function parseBuiltins(raw: string | undefined): BuiltinToggles {
  const out: BuiltinToggles = { plan: true, askUser: true, planAppend: "" };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<{ plan: boolean; askUser: boolean; planAppend: string }>;
    if (p.plan === false) out.plan = false;
    if (p.askUser === false) out.askUser = false;
    if (typeof p.planAppend === "string") out.planAppend = p.planAppend;
  } catch {
    /* fail open */
  }
  return out;
}
