import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { askUntil } from "./reask";

/**
 * Async subagent contract test (docs/validation/d1.md §hv.subagent).
 *
 * Pins the two load-bearing behaviors of async-by-default delegations:
 *  1. A delegation returns IMMEDIATELY — tool_execution_end carries
 *     details.asyncId, which is the id the run card is keyed by, so the parent
 *     turn ends and the user can keep chatting.
 *  2. The result is auto-delivered later: an hv.subagent `complete` notify plus a
 *     SECOND agent turn (triggered by pi-subagents' injected subagent-notify).
 *     This is the session-id-continuity delivery contract — a pin-bump gate.
 *
 * Plus the foreground shape: `async:false` still blocks its one turn and returns
 * the child's answer inline, which is how the model opts into waiting (PRD §12)
 * and why HappyVibe disables `subagent_wait` outright.
 *
 * RE-TIMED for pi-subagents 0.50 (2026-08-17). Three things moved, all measured:
 * the `started` notify is no longer emitted for a top-level delegation (every one
 * runs as mode:"workflow" now, and that path emits only async-complete);
 * `tool_execution_update` is not emitted at all, so there is no live child
 * transcript; and `tool_execution_end` carries no `args`, so the delegation has to
 * be found by correlating START→END on toolCallId — the previous version of this
 * file passed its foreground assertion VACUOUSLY for want of that. Details and
 * the retraction that preceded them: docs/validation/d1.md §pi-subagents 0.50.
 *
 * Live-model gated (real child Pi spawn), same harness as subagent-context.test.ts.
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");

/** agentDir with the bundled agents + async-by-default subagent config. */
function makeAgentDir(asyncByDefault: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-dir-"));
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  for (const name of fs.readdirSync(path.join(runtime, "agents"))) {
    fs.copyFileSync(path.join(runtime, "agents", name), path.join(dir, "agents", name));
  }
  fs.mkdirSync(path.join(dir, "extensions", "subagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "extensions", "subagent", "config.json"),
    JSON.stringify({ asyncByDefault, completionBatch: { enabled: false } }),
  );
  return dir;
}

function rulesAllowingSubagent(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-rules-")), "permission-rules.json");
  fs.writeFileSync(f, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }], workspaces: {} }));
  return f;
}

type Ev = { type?: string; toolName?: string; args?: { agent?: string; async?: unknown }; result?: { details?: { asyncId?: string } }; partialResult?: unknown; toolCallId?: string };
type Ui = { method?: string; message?: string };
const subNotify = (u: Ui): Record<string, unknown> | null => {
  if (u.method !== "notify") return null;
  try {
    const p = JSON.parse(u.message ?? "") as Record<string, unknown>;
    return p.kind === "hv.subagent" ? p : null;
  } catch { return null; }
};

test.skipIf(!KEY)(
  "async delegation returns immediately, then the result is auto-delivered on a triggered turn",
  async () => {
    const spec = resolvePiSpawn(
      fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-cwd-")),
      fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-sess-")),
      runtime,
      { agentDir: makeAgentDir(true), providerEnv: PROVIDER_ENV, rulesFile: rulesAllowingSubagent(), model: MODEL },
    );
    const client = new PiClient(spec);
    const events: Ev[] = [];
    const uis: Ui[] = [];
    client.on("event", (e) => events.push(e as Ev));
    client.on("ui-request", (u) => uis.push(u as Ui));
    const agentEndsSeen = (): number => events.filter((e) => e.type === "agent_end").length;
    const waitFor = (pred: () => boolean, ms: number, what: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const iv = setInterval(() => {
          if (pred()) { clearInterval(iv); resolve(); }
          else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timeout: ${what}`)); }
        }, 200);
      });
    try {
      await client.start();
      await client.send({
        type: "prompt",
        message:
          "Use the subagent tool right now (mode: single) to delegate to the agent named 'code-explorer' " +
          "with the task 'reply with exactly the word PONG and nothing else'. Do not do anything else.",
      });

      // 1. The delegation returns immediately: tool_execution_end with details.asyncId.
      await waitFor(
        () => events.some((e) => e.type === "tool_execution_end" && e.toolName === "subagent" && typeof e.result?.details?.asyncId === "string"),
        120_000,
        "async tool_execution_end with asyncId",
      );
      const dispatch = events.find((e) => e.type === "tool_execution_end" && e.toolName === "subagent" && typeof e.result?.details?.asyncId === "string");
      const runId = dispatch!.result!.details!.asyncId!;

      // THE CARD'S IDENTITY COMES FROM HERE, NOT FROM A `started` NOTIFY.
      // pi-subagents 0.50 removed its legacy single/chain/parallel entry points, so
      // every top-level delegation runs as mode:"workflow" — and the workflow path
      // emits `subagent:async-complete` but NEVER `subagent:async-started`. Measured
      // 2026-08-17 with a probe extension logging inside the bridge's own handler:
      // it does not fire (docs/validation/d1.md §pi-subagents 0.50). So the renderer
      // re-keys the foreground card it already raised to this asyncId instead of
      // waiting for a notify that never comes; without that, an async delegation
      // showed the user nothing for its whole life. asyncId is what makes it
      // possible, so it is asserted here rather than assumed.
      expect(runId, "the dispatch names the run the card will be keyed by").toBeTruthy();
      // A `started` notify is still relayed when upstream emits one (nested/single
      // runs), and MUST agree when it does — but its absence is no longer a failure.
      const started = uis.map(subNotify).find((p) => p?.stage === "started");
      if (started) expect(started.runId).toBe(runId);

      // The dispatch turn ended (parent is free — the user could keep chatting).
      await waitFor(() => agentEndsSeen() >= 1, 30_000, "dispatch turn agent_end");
      const endsAfterDispatch = agentEndsSeen();

      // 2. Completion auto-delivers: a `complete` notify AND a second (triggered) turn.
      await waitFor(() => uis.map(subNotify).some((p) => p?.stage === "complete"), 180_000, "hv.subagent complete notify");
      // 120s, not 60s: the completion notify has already arrived by here, so what
      // this waits on is a WHOLE EXTRA MODEL TURN that pi-subagents triggers to fold
      // the result in. It passed twice in isolation and timed out inside the serial
      // batch at 60s — i.e. the thing demonstrably arrives, only late, which is the
      // one case where a longer wait is the fix rather than a papered-over flake
      // (the ui-fallback-bridge precedent). The test's own timeout is raised to match.
      await waitFor(() => agentEndsSeen() > endsAfterDispatch, 120_000, "triggered completion turn");
      const complete = uis.map(subNotify).find((p) => p?.stage === "complete");
      // Same run id as the dispatch: this is what lets the completion find the card.
      expect(complete?.runId).toBe(runId);
      // The bridge drops upstream's generic `agent:"workflow"` so the hand-off notice
      // cannot name a pipeline the user never asked for.
      expect(complete?.agent).not.toBe("workflow");
    } finally {
      client.stop();
    }
  },
  420_000,
);

test.skipIf(!KEY)(
  "async:false still blocks its one turn and returns the child's answer inline",
  async () => {
    const spec = resolvePiSpawn(
      fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-cwd-")),
      fs.mkdtempSync(path.join(os.tmpdir(), "hv-async-sess-")),
      runtime,
      { agentDir: makeAgentDir(true), providerEnv: PROVIDER_ENV, rulesFile: rulesAllowingSubagent(), model: MODEL },
    );
    const client = new PiClient(spec);
    const events: Ev[] = [];
    client.on("event", (e) => events.push(e as Ev));
    try {
      await client.start();
      // The model picks `async` itself, and with the SAME prompt it picks differently
      // between runs — observed twice: one run blocked, the next detached. So this
      // insists on the call the test is about (askUntil, never a wider timeout: a
      // longer wait cannot make a finished turn produce a different tool call).
      // Correlate START (which carries the args) to END (which carries the result)
      // by toolCallId. tool_execution_END has NO `args` at 0.50 — which is also how
      // the previous version of this test passed vacuously: `undefined?.result?
      // .details?.asyncId` is falsy, so "foreground end has no asyncId" held for a
      // delegation it had never found.
      const blockingDelegation = (): Ev | undefined => {
        const starts = events.filter((e) =>
          e.type === "tool_execution_start" && e.toolName === "subagent" && typeof e.args?.agent === "string");
        for (const s of starts) {
          const end = events.find((e) => e.type === "tool_execution_end" && e.toolCallId === s.toolCallId);
          if (end && !end.result?.details?.asyncId) return end;
        }
        return undefined;
      };
      const asked = await askUntil(
        () => client.send({
          type: "prompt",
          message:
            "Use the subagent tool right now with async: false to delegate to the agent named " +
            "'code-explorer' with the task 'reply with exactly the word PONG and nothing else'. " +
            "You MUST pass async: false. Do not do anything else.",
        }),
        () => blockingDelegation() !== undefined,
        { attempts: 3, waitMs: 60_000 },
      );
      // Diagnostic in the message, because the two ways this fails need different
      // fixes: the model never passing async:false is noise (re-ask), while upstream
      // detaching a call that DID pass it would mean `async:false` no longer works —
      // and PRD §12 offers it as the model's way to block on a quick lookup.
      const seen = events
        .filter((e) => e.type === "tool_execution_end" && e.toolName === "subagent")
        .map((e) => ({ args: e.args, detached: !!e.result?.details?.asyncId }));
      expect(asked, `the model made a blocking (async:false) delegation; saw ${JSON.stringify(seen)}`).toBe(true);

      const delegation = blockingDelegation();
      // The blocking shape is the absence of asyncId: nothing was detached, so this
      // one turn owned the whole delegation. That is what `async:false` is FOR, and
      // it stays the model's way to opt into blocking (PRD §12) — which is why
      // HappyVibe needs no `subagent_wait` and disables it outright.
      expect(delegation?.result?.details?.asyncId, "foreground end has no asyncId").toBeFalsy();

      // …and the answer comes back inline, on this turn, rather than as a later
      // injected message. `finalOutput` is where it lives (the content text also
      // carries a "Run fan-out:" receipt around it — see the async test).
      const results = (delegation?.result?.details as { results?: Array<{ finalOutput?: string }> } | undefined)?.results ?? [];
      const inline = results.map((r) => r.finalOutput ?? "").join("\n");
      expect(inline, "the child's answer is on the foreground result").toContain("PONG");

      // NO assertion that tool_execution_update fired. It used to be required here,
      // and at 0.50 a foreground delegation emits none at all — measured 2026-08-17,
      // and the reason the renderer's live child transcript is now empty until the
      // run finishes. Re-timed rather than deleted: the blocking CONTRACT above is
      // what this test protects, and it still holds. Wire shapes: d1.md §0.50.
    } finally {
      client.stop();
    }
  },
  240_000,
);
