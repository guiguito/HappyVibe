import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * W1.2 PART A contract test — subagent CONTEXT ISOLATION measurement.
 *
 * The suspicion: the subagent's full child transcript pollutes the MAIN
 * agent's context. What actually enters context is the toolResult message's
 * `content` blocks — `details` (which carries the child transcript in
 * tool_execution_update and the outcome record in _end) is display-only and
 * is never serialized to the provider (pi-ai openai-completions.js only maps
 * content text blocks into the `tool` role message).
 *
 * This test pins that empirically: run a real delegation, then get_entries
 * and inspect the persisted toolResult for the subagent call. The context-
 * entering content must be the FINAL OUTPUT only — small, no child-transcript
 * scaffolding — while the full detail record may be much larger.
 *
 * DEEPSEEK-gated (real child Pi spawn), same harness as agents-bridge.test.ts.
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-subctx-dir-"));
fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
for (const name of fs.readdirSync(path.join(runtime, "agents"))) {
  fs.copyFileSync(path.join(runtime, "agents", name), path.join(agentDir, "agents", name));
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-subctx-cwd-"));
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-subctx-sess-"));
const rulesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-subctx-rules-")), "permission-rules.json");
fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent", action: "allow" }], workspaces: {} }));

interface Entry {
  type: string;
  message?: {
    role?: string;
    toolName?: string;
    toolCallId?: string;
    content?: Array<{ type?: string; text?: string }>;
    details?: unknown;
  };
}

test.skipIf(!KEY)(
  "only the subagent's final output enters the main context (toolResult.content); the child transcript stays in details",
  async () => {
    const spec = resolvePiSpawn(workDir, sessionDir, runtime, {
      agentDir,
      providerEnv: PROVIDER_ENV,
      rulesFile,
      model: MODEL,
    });
    const client = new PiClient(spec);
    const events: Array<{ type?: string; [k: string]: unknown }> = [];
    client.on("event", (e) => events.push(e as { type?: string }));
    try {
      await client.start();
      const done = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no agent_end")), 150_000);
        client.on("event", (e) => {
          if ((e as { type?: string }).type === "agent_end") { clearTimeout(t); resolve(); }
        });
      });
      await client.send({
        type: "prompt",
        message:
          "Use the subagent tool right now (mode: single) to delegate to the agent named 'code-explorer' " +
          "with the task 'reply with exactly the word HELLO and nothing else'. Do not do anything else.",
      });
      await done;

      // The DELEGATION call (not the model's optional `subagent list` warm-up)
      // is the start whose args carry an agent + task.
      const delegationStart = events.find(
        (e) =>
          e.type === "tool_execution_start" &&
          (e as { toolName?: string }).toolName === "subagent" &&
          typeof ((e as { args?: { agent?: string } }).args?.agent) === "string",
      ) as { toolCallId?: string } | undefined;
      expect(delegationStart?.toolCallId, "a real delegation ran").toBeTruthy();
      const callId = delegationStart!.toolCallId!;

      // The stream used to carry a live child transcript here. At 0.50 it carries
      // nothing: `tool_execution_update` is not emitted for a subagent call at all
      // (measured on both paths — see tests/agents-bridge.test.ts, which asserts the
      // absence). Kept as a measurement rather than deleted, because the number in
      // the log line below is how we would notice streaming coming back.
      const updates = events.filter(
        (e) => e.type === "tool_execution_update" && (e as { toolCallId?: string }).toolCallId === callId,
      );
      const liveTranscriptChars = JSON.stringify(
        (updates[updates.length - 1] as { partialResult?: { details?: unknown } } | undefined)?.partialResult?.details ?? {},
      ).length;

      // What the SESSION holds — and what the provider will be re-sent — is
      // the toolResult message. Its `content` is the context-entering part.
      const resp = await client.send({ type: "get_entries" });
      const entries = ((resp.data ?? resp) as { entries?: Entry[] }).entries ?? [];
      const toolResult = entries.find((e) => e.type === "message" && e.message?.role === "toolResult" && e.message.toolCallId === callId);
      expect(toolResult, "subagent toolResult entry present in session").toBeTruthy();

      const contentText = (toolResult!.message!.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const contentChars = contentText.length;
      const detailsChars = JSON.stringify(toolResult!.message!.details ?? null).length;

      // eslint-disable-next-line no-console
      console.log(
        `[subagent-context] context-entering content: ${contentChars} chars | ` +
          `toolResult.details (display/session only): ${detailsChars} chars | ` +
          `live transcript over updates: ${liveTranscriptChars} chars`,
      );

      // 1. THE ISOLATION CONTRACT STILL HOLDS: the child's TRANSCRIPT never enters
      //    context. That is the invariant this test exists for and it is intact.
      expect(contentText).not.toContain('"role"');
      expect(contentText).not.toContain("acceptance-report");

      // 2. Every delegation now announces itself with a fan-out receipt, on both
      //    paths — new at 0.50 (run-fanout-budget.ts), and the first thing the main
      //    agent reads about its own delegation.
      expect(contentText).toMatch(/Run fan-out:/);

      // 3. Content is BOUNDED — the assertion that protects the context window.
      //
      //    Which bound applies depends on a choice THE MODEL makes: given one prompt
      //    that does not mention `async`, it detached on one run and blocked on the
      //    next (observed twice). So the path is measured, not assumed — an assertion
      //    whose truth depends on the model's mood is the flake CLAUDE.md warns about.
      const isAsync = typeof (toolResult!.message!.details as { asyncId?: unknown } | undefined)?.asyncId === "string";
      if (isAsync) {
        // Async — what HappyVibe ships. A receipt only; the answer arrives on the
        // triggered completion turn (asserted in subagent-async-bridge.test.ts).
        // Measured 2026-08-17: 1,255 chars, no "HELLO".
        expect(contentText).not.toContain("HELLO");
        expect(contentChars).toBeLessThan(2_000);
      } else {
        // ⚠ REGRESSION WATCH — the number is written down because it is a real cost.
        // A BLOCKING delegation inlines the entire workflow return JSON: launch
        // contract digest, resolved-extension hashes, artifact paths, usage,
        // acceptance scaffolding, childReport, toolCalls. Measured 4,947–5,532 chars
        // to carry a one-word answer, against the 2,000 this test used to enforce.
        // The answer IS in there, so the delegation works and isolation holds (no
        // transcript, asserted above) — but PRD §12's "only the call and the final
        // result enter the main agent's context" now costs ~5 KB a delegation.
        // Raised deliberately, not silently: see docs/validation/d1.md §0.50.
        expect(contentText).toContain("HELLO");
        expect(contentChars, "blocking delegation context cost").toBeLessThan(8_000);
      }

      // 4. The heavyweight record exists but lives OUTSIDE content.
      expect(detailsChars).toBeGreaterThan(contentChars);
    } finally {
      client.stop();
    }
  },
  240_000,
);
