/**
 * §35 — the read-only RUN mode.
 *
 * A scheduled run the user marked "Read-only" spawns with HV_READONLY=1, and
 * this clamp runs on every tool call BEFORE the bypass check and before the
 * rule engine. Read-only must mean read-only or the pill lies — exactly Plan
 * mode's rule, and this reuses Plan mode's gate to stay one implementation.
 *
 * It is deliberately NOT Plan mode itself, for two reasons the code made
 * visible rather than any preference:
 *
 *   1. `/hv-plan` is registered only while the Built-in tools "Plan mode"
 *      switch is on. With it off, sending that command puts the literal text
 *      `/hv-plan on` in front of the model as a user message and the run goes
 *      ahead at FULL permissions with nothing on screen saying so.
 *   2. The planning prompt tells the model to finish with `plan_complete`, and
 *      main writes that plan to `.agents/plans/NNN-*.md`. A daily review would
 *      commit a plan file into the user's repository every single morning.
 *
 * So this mode has no command, no toggle and no tool: nothing inside the
 * session can turn it off. The only way in is the environment, which only main
 * sets, and only for a schedule whose mode is "readonly".
 */
import { gatePlanCall, type PlanGate } from "./hv-plan";

/**
 * Blocked outright, on top of everything Plan mode blocks.
 *
 * The plan tools because a run reports, it never plans — and because
 * `plan_complete` writes a file. The three schedule WRITERS because a run must
 * not edit the schedules that produced it; note they are BLOCKED rather than
 * floor-asked, since a prompt nobody is present to answer is not a refusal,
 * it is a hang. `schedule_list` is deliberately absent: reading is fine.
 */
export const READONLY_BLOCKED: ReadonlySet<string> = new Set([
  "plan_start", "plan_complete", "plan_status_update",
  "schedule_create", "schedule_update", "schedule_delete",
]);

export function readonlyFromEnv(env: NodeJS.ProcessEnv): boolean {
  return env.HV_READONLY === "1";
}

/**
 * The gate. Same verdict shape as Plan mode's, so the bridge resolves it
 * through the same `resolvePlanVerdict` and the renderer draws the same quiet
 * "Skipped" card — one mechanism, two entrances.
 */
export function gateReadonlyCall(toolName: string, input: unknown): PlanGate {
  if (READONLY_BLOCKED.has(toolName)) {
    return { kind: "block", reason: `This is a read-only run — '${toolName}' is not available. Report your findings in chat.` };
  }
  const g = gatePlanCall(toolName, input);
  // Re-voice the reason: the user reading this card never chose plan mode, they
  // chose a read-only schedule, and a message naming a mode they did not pick
  // reads as a bug.
  if (g.kind === "block") {
    return {
      kind: "block",
      reason: g.reason
        .replace(/^Plan mode is read-only —/, "This is a read-only run —")
        .replace(/^Plan mode blocks/, "A read-only run blocks")
        .replace(/Explore and draft a plan; the user implements it later\./, "Read, search and report what you find.")
        .replace(/Delegate a read-only exploration instead, or leave plan mode to run it\./, "Delegate a read-only exploration instead."),
    };
  }
  return g;
}

export const READONLY_PROMPT_MARKER = "[HAPPYVIBE READ-ONLY RUN]";

/**
 * The system-prompt block, appended per turn.
 *
 * DERIVED from the gate (§20 Principle 11) and filtered to the tools this
 * session actually registered (§26's rule: never name a tool the model does
 * not have). It never mentions planning — this mode has no plan to write.
 */
export function buildReadonlyPrompt(registeredTools?: Iterable<string>): string {
  const have = registeredTools ? [...registeredTools] : [];
  const blocked = have.filter((t) => !READONLY_BLOCKED.has(t) && gateReadonlyCall(t, {}).kind === "block");
  const names = blocked.length ? blocked.join(", ") : "file edits and shell writes";
  return `<happyvibe_readonly_run>
${READONLY_PROMPT_MARKER}
This is a scheduled, read-only run. Nobody is watching it live, so your final
message IS the report: read, search and analyse, then say what you found and
what it means, in full, in chat. Do not end a turn by announcing what you are
about to do.

Blocked here: ${names}; bash is limited to a read-only allowlist. Do not try to
plan, to schedule anything, or to ask a question — there is no one to answer.
</happyvibe_readonly_run>`;
}
