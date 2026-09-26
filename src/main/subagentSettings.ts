/**
 * The Agents page's per-agent switch, as `<agentDir>/settings.json` records it —
 * PURE, so vitest can exercise it. The bridge reads the result LIVE
 * (`twDisabledAgents`), so a toggle applies on the next call without a respawn.
 *
 * MERGES at three levels, because `<agentDir>/settings.json` is PI's file (models,
 * theme, providers) and HappyVibe is merely one writer of it: the top level, the
 * `subagents` object, and each agent entry. Idempotent.
 *
 * Also the locked tintinweb settings (TINTINWEB_SETTINGS, below).
 *
 * Split out of config.ts because config.ts imports electron's `app` for
 * `agentDir()`, so vitest cannot import it.
 */

/** The key the bridge reads user-disabled agents from (kept from the pre-tintinweb file). */
const OVERRIDES_KEY = "agentOverrides";

/**
 * Which agents end up disabled, given the user's explicit choices. `agentsEnabled`
 * is SPARSE — only names the user actually toggled — so an agent is on unless the
 * user said otherwise.
 */
export function resolveDisabledAgents(agentsEnabled: Record<string, boolean> = {}): Set<string> {
  return new Set(Object.entries(agentsEnabled).filter(([, on]) => !on).map(([name]) => name));
}

export function disabledAgentOverrides(
  settings: Record<string, unknown>,
  agentsEnabled: Record<string, boolean> = {},
): Record<string, unknown> {
  const out = { ...settings };
  const subagents = { ...((out.subagents as Record<string, unknown> | undefined) ?? {}) };
  const overrides = { ...((subagents[OVERRIDES_KEY] as Record<string, unknown> | undefined) ?? {}) };
  const disabled = resolveDisabledAgents(agentsEnabled);
  // Every name we have an opinion about gets an EXPLICIT boolean. Omitting the
  // key for a re-enabled agent would leave the `disabled: true` a previous run
  // already wrote on disk, so the toggle would appear to do nothing.
  for (const name of new Set([...disabled, ...Object.keys(agentsEnabled)])) {
    const existing = (overrides[name] as Record<string, unknown> | undefined) ?? {};
    overrides[name] = { ...existing, disabled: disabled.has(name) };
  }
  subagents[OVERRIDES_KEY] = overrides;
  out.subagents = subagents;
  return out;
}

/**
 * PRD §12 (2026-09-26): what HappyVibe writes to tintinweb's GLOBAL settings file,
 * `<agentDir>/subagents.json`. Every value is stated, none inherited — a future
 * upstream default flip must not change behaviour silently. The owned patch (P4)
 * stops a project's own `.pi/subagents.json` from overriding any of it.
 *
 *  - widgetMode/fleetView/agentMentions off: their TUI surfaces and `@handle` input
 *    hook; the renderer owns every surface and the composer owns `@`.
 *  - outputTranscript off: the `.output` copies land in os.tmpdir(), which "delete
 *    session" (§17) can never reach.
 *  - schedulingEnabled/worktreeIsolation off: ours are §35 and §29.
 *  - disableDefaultAgents + fallbackSubagent "none": our roster only, and an unknown
 *    name FAILS rather than silently becoming general-purpose (§16).
 *  - reportUsage off: §19 already counts each child's own session file.
 *  - rememberAgents on: the child's session file is what transcripts, cost and
 *    thinking read.
 *  - maxConcurrent 4: children share the session's process (R1); measured to hold.
 */
export const TINTINWEB_SETTINGS = {
  widgetMode: "off",
  fleetView: false,
  agentMentions: "off",
  outputTranscript: false,
  schedulingEnabled: false,
  worktreeIsolation: false,
  disableDefaultAgents: true,
  fallbackSubagent: "none",
  reportUsage: false,
  rememberAgents: true,
  maxConcurrent: 4,
  workflowsEnabled: true,
} as const;

/** Merge the locked set over whatever is there (the file's schema is upstream's). */
export function tintinwebSettings(existing: Record<string, unknown>): Record<string, unknown> {
  return { ...existing, ...TINTINWEB_SETTINGS };
}
