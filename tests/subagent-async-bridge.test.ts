import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * Async subagent contract test (docs/validation/d1.md §hv.subagent).
 *
 * Pins the two load-bearing behaviors of async-by-default delegations:
 *  1. A delegation returns IMMEDIATELY — tool_execution_end carries
 *     details.asyncId and the bridge relays an hv.subagent `started` notify, so
 *     the parent turn ends and the user could keep chatting.
 *  2. The result is auto-delivered later: an hv.subagent `complete` notify plus a
 *     SECOND agent turn (triggered by pi-subagents' injected subagent-notify).
 *     This is the session-id-continuity delivery contract — a pin-bump gate.
 *
 * Plus a foreground regression: with async:false the old blocking shape holds
 * (tool_execution_update carries the live child transcript).
 *
 * DEEPSEEK-gated (real child Pi spawn), same harness as subagent-context.test.ts.
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
  fs.writeFileSync(f, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent", action: "allow" }], workspaces: {} }));
  return f;
}

type Ev = { type?: string; toolName?: string; args?: { agent?: string }; result?: { details?: { asyncId?: string } }; partialResult?: unknown; toolCallId?: string };
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
      // The bridge relayed a `started` notify with a runId.
      const started = uis.map(subNotify).find((p) => p?.stage === "started");
      expect(started?.runId, "hv.subagent started notify with runId").toBeTruthy();
      // The dispatch turn ended (parent is free — the user could keep chatting).
      await waitFor(() => agentEndsSeen() >= 1, 30_000, "dispatch turn agent_end");
      const endsAfterDispatch = agentEndsSeen();

      // 2. Completion auto-delivers: a `complete` notify AND a second (triggered) turn.
      await waitFor(() => uis.map(subNotify).some((p) => p?.stage === "complete"), 180_000, "hv.subagent complete notify");
      await waitFor(() => agentEndsSeen() > endsAfterDispatch, 60_000, "triggered completion turn");
      const complete = uis.map(subNotify).find((p) => p?.stage === "complete");
      expect(complete?.runId).toBe(started?.runId);
    } finally {
      client.stop();
    }
  },
  300_000,
);

test.skipIf(!KEY)(
  "async:false keeps the foreground blocking shape (live child transcript in tool_execution_update)",
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
      const done = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no agent_end")), 150_000);
        client.on("event", (e) => { if ((e as Ev).type === "agent_end") { clearTimeout(t); resolve(); } });
      });
      await client.send({
        type: "prompt",
        message:
          "Use the subagent tool right now with async: false (mode: single) to delegate to the agent named " +
          "'code-explorer' with the task 'reply with exactly the word PONG and nothing else'. Do not do anything else.",
      });
      await done;

      const delegation = events.find((e) => e.type === "tool_execution_end" && e.toolName === "subagent" && typeof e.args?.agent === "string");
      // Foreground: NO asyncId on the end, and the live transcript streamed via _update.
      expect(delegation?.result?.details?.asyncId, "foreground end has no asyncId").toBeFalsy();
      const hadUpdate = events.some((e) => e.type === "tool_execution_update" && e.toolName === "subagent");
      expect(hadUpdate, "foreground streamed a live child transcript via tool_execution_update").toBe(true);
    } finally {
      client.stop();
    }
  },
  240_000,
);
