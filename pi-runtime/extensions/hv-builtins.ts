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
  /**
   * §31: the Documents entry — `document_read` plus the `read` hint. One tool,
   * so no grouping question arises; off also disables the composer's Attach
   * document row (with the reason) and stops the hint.
   */
  document: boolean;
  /**
   * §33: the Memory entry — memory_save / memory_recall / memory_forget, plus the policy
   * paragraph and both indexes injected every turn. All three or none: an agent that can save
   * but not recall carries a cost it can never spend, and one that can save but not forget
   * cannot obey "forget that".
   *
   * OFF COSTS 0 — no policy, no index, no tool schemas. That is the row's whole argument.
   */
  memory: boolean;
  /**
   * §35: schedule_list / schedule_create / schedule_update / schedule_delete.
   *
   * Gates the MODEL's tools only. The scheduler itself is never gated by it —
   * turning this off removes four tool schemas from the session, it does not
   * stop the user's schedules from running.
   */
  schedules: boolean;
  /** §33: the user's append to the memory policy (PromptRow, Plan mode's shape). */
  memoryAppend: string;
  /**
   * §13 round 26 — the family switches. Each is enforced at SPAWN by not loading the family
   * (main never passes its -e / --skill), so the bridge reads them only to keep every prompt
   * line from naming a tool the session lacks (§26).
   */
  mcp: boolean;
  subagents: boolean;
  /** `SubagentWorkflow` alone (~5.5k tok/request); meaningful only while `subagents` is on. */
  workflows: boolean;
  skills: boolean;
  /** §13 round 26: Pi core tools switched off, one by one (`--exclude-tools`). Sparse. */
  coreOff: string[];
}

/** §13 round 26: Pi's core tools, exactly its default set. */
export const CORE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

/** The core set as this session has it — `powershell` stands in for `bash` on Windows (§4). */
export function coreToolNames(shell: "bash" | "powershell"): string[] {
  return CORE_TOOLS.map((t) => (t === "bash" ? shell : t));
}

const SHELLS = ["bash", "powershell"];

/**
 * The stored list, made safe and made whole. Only core names survive (it becomes argv), and the
 * shell is ONE switch: the name stored is whichever shell the session had when the user clicked,
 * but the shell can change under it (Git Bash installed later on Windows) and tintinweb children
 * always get `bash` — so either name switches both off.
 */
export function normalizeCoreOff(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const valid: readonly string[] = [...CORE_TOOLS, "powershell"];
  const out = [...new Set(list.filter((t): t is string => typeof t === "string" && valid.includes(t)))];
  if (out.some((t) => SHELLS.includes(t))) for (const s of SHELLS) if (!out.includes(s)) out.push(s);
  return out;
}

/** Every name the spawn hands Pi's `--exclude-tools`. */
export function excludedTools(b: Pick<BuiltinToggles, "coreOff" | "subagents" | "workflows">): string[] {
  return [...normalizeCoreOff(b.coreOff), ...(b.subagents && !b.workflows ? ["SubagentWorkflow"] : [])];
}

/**
 * The refusal a sub-agent child gets for a switched-off core tool, or null. A child is its own
 * session and an agent file with no `tools:` gets every core tool, so the parent's
 * `--exclude-tools` alone would leave a delegated way round the switch.
 */
export function offToolRefusal(tool: string, b: Pick<BuiltinToggles, "coreOff">): string | null {
  return normalizeCoreOff(b.coreOff).includes(tool)
    ? `The user switched off '${tool}' in Settings → Built-in tools. Do not retry it and do not work around it; finish what you can with the tools you have.`
    : null;
}

export function parseBuiltins(raw: string | undefined): BuiltinToggles {
  const out: BuiltinToggles = { plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true, mcp: true, subagents: true, workflows: true, skills: true, coreOff: [] };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<{ plan: boolean; askUser: boolean; planAppend: string; terminal: boolean; intent: boolean; browser: boolean; web: boolean; document: boolean; memory: boolean; memoryAppend: string; schedules: boolean; mcp: boolean; subagents: boolean; workflows: boolean; skills: boolean; coreOff: unknown[] }>;
    if (p.plan === false) out.plan = false;
    if (p.askUser === false) out.askUser = false;
    if (p.terminal === false) out.terminal = false;
    if (p.intent === false) out.intent = false;
    if (p.browser === false) out.browser = false;
    if (p.web === false) out.web = false;
    if (p.document === false) out.document = false;
    if (p.memory === false) out.memory = false;
    if (p.schedules === false) out.schedules = false;
    if (p.mcp === false) out.mcp = false;
    if (p.subagents === false) out.subagents = false;
    if (p.workflows === false) out.workflows = false;
    if (p.skills === false) out.skills = false;
    out.coreOff = normalizeCoreOff(p.coreOff);
    if (typeof p.memoryAppend === "string") out.memoryAppend = p.memoryAppend;
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
