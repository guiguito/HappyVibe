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

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;

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
      providerEnv: { DEEPSEEK_API_KEY: KEY! },
      rulesFile,
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
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

      // The stream saw the live child transcript (that part is display-only).
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

      // 1. The final output is what the child was asked to say — tiny.
      expect(contentText).toContain("HELLO");
      // 2. No child-transcript scaffolding in the context-entering text: the
      //    transcript rides details.results[].messages (s0.3), never content.
      expect(contentText).not.toContain('"role"');
      expect(contentText).not.toContain("acceptance-report");
      // 3. Content is bounded (final output only), not the multi-KB transcript.
      expect(contentChars).toBeLessThan(2_000);
      // 4. The heavyweight record exists but lives OUTSIDE content.
      expect(detailsChars).toBeGreaterThan(contentChars);
    } finally {
      client.stop();
    }
  },
  240_000,
);
