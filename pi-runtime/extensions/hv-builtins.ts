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
  /** §26 part 2: the grouped "Terminal" entry — all three tools or none. */
  terminal: boolean;
  /** §28: the grouped "Browser" entry — all ten tools or none, same reason. */
  browser: boolean;
  /** §32: the grouped "Web tools" entry — all four tools or none, same reason.
   * Off also drops the steer line, so a prompt never names a tool the model
   * does not have. */
  web: boolean;
  /**
   * §13 round 12 — the model-authored `intent` on registered tools.
   *
   * ON by default and fail-open like the rest: a corrupt value must never
   * silently strip the headline every tool card shows. Turning it off changes
   * LABELS, never safety — the permission prompt has always shown the factual
   * action rather than the model's sentence.
   */
  intent: boolean;
}

export function parseBuiltins(raw: string | undefined): BuiltinToggles {
  const out: BuiltinToggles = { plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<{ plan: boolean; askUser: boolean; planAppend: string; terminal: boolean; intent: boolean; browser: boolean; web: boolean }>;
    if (p.plan === false) out.plan = false;
    if (p.askUser === false) out.askUser = false;
    if (p.terminal === false) out.terminal = false;
    if (p.intent === false) out.intent = false;
    if (p.browser === false) out.browser = false;
    if (p.web === false) out.web = false;
    if (typeof p.planAppend === "string") out.planAppend = p.planAppend;
    // Defence in depth (Important 3): Plan mode's prompt and applyPlanTools'
    // `required` array both hard-require ask_user — a hand-edited config with
    // plan:true, askUser:false would leave the model told to use a tool that
    // doesn't exist. The Settings UI already disables the Ask-user toggle while
    // Plan is on, but that only prevents NEW broken configs from the UI; this
    // repairs one that reached HV_BUILTINS some other way (hand-edited config,
    // future write path). Plan wins: force askUser back on.
    if (out.plan) out.askUser = true;
  } catch {
    /* fail open */
  }
  return out;
}
