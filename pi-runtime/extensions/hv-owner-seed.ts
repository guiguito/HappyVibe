/**
 * Claim pi-subagents' completion-owner id from HappyVibe's session identity.
 *
 * pi-subagents 0.51 (upstream #1225) scopes async completion delivery to the Pi
 * PROCESS that launched the run. `runs/background/notify.ts` refuses any
 * non-foreground completion whose `completionOwnerId` differs from the current
 * process's:
 *
 *     if (result.source !== "foreground" && (!state.completionOwnerId
 *         || result.completionOwnerId !== state.completionOwnerId)) return false;
 *
 * There is no config off-switch, and — unlike `result-watcher.ts`, which falls
 * back to a mission-binding file when deciding whether to READ a result — the
 * delivery path has no fallback at all. The id itself is a `randomUUID()` cached
 * on `globalThis` under a registry symbol, documented "stable for one parent Pi
 * process across extension reloads" (`shared/completion-owner.ts`).
 *
 * That guard is right for the case it was written for (two windows sharing one
 * session file) and wrong for ours. HappyVibe respawns Pi deliberately —
 * hibernation wake, MCP live-reload, app relaunch — and resumes the SAME session
 * file precisely so a detached run is never orphaned (PRD §12). A per-process id
 * makes the resumed parent a stranger to its own child: the artifact lands on
 * disk, `/hv-subagent-list` resyncs the card, and the answer never reaches the
 * model. Measured at 0.50: delivered. Measured at 0.51: refused.
 *
 * So we claim the id first, from something stable across exactly that respawn.
 * `??=` is what makes this work — a value already in the registry wins, and
 * upstream never overwrites it. HappyVibe never runs two Pi processes against one
 * session file (a respawn stops the old child before starting the new one), so
 * this is #1225's intent, keyed on the identity that actually owns the session.
 *
 * WHY THIS IS ITS OWN EXTENSION, and not part of happyvibe-bridge.ts:
 * the id is minted during pi-subagents' own registration, and Pi loads `-e`
 * extensions strictly sequentially — import + factory, one at a time, in argv
 * order (`core/extensions/loader.js`). The bridge is pinned to be LAST so the
 * permission gate sees final, post-mutation tool input, so it can never run
 * early enough. This file registers no tools and no `tool_call` handler, so
 * being first costs the gate nothing.
 *
 * Deliberately import-free: a throw here would be reported as a load error for
 * the FIRST extension in every session. `loadExtension` catches it and keeps
 * going, but there is no reason to have anything that can fail.
 *
 * Fails OPEN — no `HV_SUBAGENT_OWNER` (the utility client, which never delegates)
 * leaves upstream to mint its own id exactly as before.
 *
 * Pinned by tests/pi-subagents-contract.test.ts (the upstream mechanism, plus a
 * behavioural test of the refusal itself) and tests/mcp-spawn.test.ts (the load
 * order and both env cases).
 */

const OWNER_SYMBOL = Symbol.for("pi-subagents.completion-owner-id");

const claimed = process.env.HV_SUBAGENT_OWNER;
if (claimed) {
  (globalThis as Record<symbol, unknown>)[OWNER_SYMBOL] ??= claimed;
}

/**
 * Pi requires an extension to default-export a factory function, and returns
 * `undefined` (a reported load error, not a crash) when it does not. The claim
 * above already happened at module load, which is the only moment early enough —
 * so there is genuinely nothing to register here.
 */
export default function registerOwnerSeed(): void {
  /* intentionally empty — see the module comment */
}
