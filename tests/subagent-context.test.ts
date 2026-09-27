import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * W1.2 PART A contract test — sub-agent CONTEXT ISOLATION, on tintinweb (PRD §12).
 *
 * What enters the parent's context is the toolResult message's `content`. A child
 * runs in-process with its OWN session (`<sessions>/subagents/`), so its transcript
 * never reaches the parent's message list — this pins that on a real delegation, and
 * bounds the envelope around the answer.
 *
 * Live-gated (real model).
 */

import { TINTINWEB_SETTINGS } from "../src/main/subagentSettings";
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
fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }], workspaces: {} }));
fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));

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
  "only the sub-agent's final answer enters the main context; its transcript stays in its own session file",
  async () => {
    const spec = resolvePiSpawn(workDir, sessionDir, runtime, { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
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
          "Use the Agent tool right now in the FOREGROUND (run_in_background false) with subagent_type 'code-explorer', " +
          "description 'Say hello', and prompt 'reply with exactly the word HELLO and nothing else'. Do not do anything else.",
      });
      await done;

      const start = events.find((e) => e.type === "tool_execution_start" && (e as { toolName?: string }).toolName === "Agent") as
        | { toolCallId?: string } | undefined;
      expect(start?.toolCallId, "a real delegation ran").toBeTruthy();

      // What the provider is re-sent is the toolResult message's `content`.
      const resp = await client.send({ type: "get_entries" });
      const entries = ((resp.data ?? resp) as { entries?: Entry[] }).entries ?? [];
      const toolResult = entries.find((e) => e.type === "message" && e.message?.role === "toolResult" && e.message.toolCallId === start!.toolCallId);
      expect(toolResult, "Agent toolResult entry present in session").toBeTruthy();
      const contentText = (toolResult!.message!.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      const isBackground = (toolResult!.message!.details as { status?: unknown } | undefined)?.status === "background";

      // eslint-disable-next-line no-console
      console.log(`[subagent-context] context-entering content: ${contentText.length} chars (background: ${isBackground})`);

      // THE ISOLATION CONTRACT: the child's transcript never enters the parent's context.
      expect(contentText).not.toContain('"role"');
      expect(contentText).not.toContain("toolCall");
      if (isBackground) {
        // The model may still detach; then this is a receipt and the answer arrives later.
        expect(contentText).not.toContain("HELLO");
      } else {
        expect(contentText).toContain("HELLO");
      }
      // Bounded: tintinweb's envelope is one line ("Agent completed in …") around the answer.
      expect(contentText.length, "delegation context cost").toBeLessThan(2_000);
      // The transcript exists — in the child's own session file, never in the parent's.
      const kids = path.join(sessionDir, "subagents");
      expect(fs.existsSync(kids) ? fs.readdirSync(kids).filter((f) => f.endsWith(".jsonl")) : []).not.toEqual([]);
    } finally {
      client.stop();
    }
  },
  240_000,
);
