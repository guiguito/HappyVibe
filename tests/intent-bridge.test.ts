import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * W1.1 contract test — the bridge adds a REQUIRED `intent` param to the
 * registered `subagent` tool (schema mutation at session_start; see
 * requireIntent in happyvibe-bridge.ts), and the model actually supplies it:
 * a real delegation's tool_execution_start args carry a non-empty intent.
 *
 * DEEPSEEK-gated (needs a live model to prove the model-side behavior).
 * Pattern of agents-bridge.test.ts; client killed in a finally.
 */

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;

const runtime = path.join(process.cwd(), "pi-runtime");
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-intent-dir-"));
fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
for (const name of fs.readdirSync(path.join(runtime, "agents"))) {
  fs.copyFileSync(path.join(runtime, "agents", name), path.join(agentDir, "agents", name));
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-intent-cwd-"));
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-intent-sess-"));
// Allow subagent up front so the run never stalls on a permission prompt.
const rulesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-intent-rules-")), "permission-rules.json");
fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent", action: "allow" }], workspaces: {} }));

type PiEvent = { type?: string; toolName?: string; args?: Record<string, unknown>; [k: string]: unknown };

test.skipIf(!KEY)(
  "a real delegation's tool_execution_start args include a non-empty intent",
  async () => {
    const spec = resolvePiSpawn(workDir, sessionDir, runtime, {
      agentDir,
      providerEnv: { DEEPSEEK_API_KEY: KEY! },
      rulesFile,
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
    });
    const client = new PiClient(spec);
    const events: PiEvent[] = [];
    client.on("event", (e) => events.push(e as PiEvent));
    try {
      await client.start();
      const done = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no agent_end")), 150_000);
        client.on("event", (e) => {
          if ((e as PiEvent).type === "agent_end") {
            clearTimeout(t);
            resolve();
          }
        });
      });
      await client.send({
        type: "prompt",
        message:
          "Use the subagent tool right now (mode: single) to delegate to the agent named 'code-explorer' " +
          "with the task 'reply with exactly the word HELLO and nothing else'. Do not do anything else.",
      });
      await done;

      const starts = events.filter((e) => e.type === "tool_execution_start" && e.toolName === "subagent");
      expect(starts.length, "expected a subagent tool_execution_start").toBeGreaterThan(0);
      // The DELEGATION call (agent+task) must carry the intent the model wrote;
      // it rides the echoed input untouched. (Registered-tool args are not
      // hard-validated by Pi, so this is the model-compliance proof — the UI
      // keeps a derived fallback label either way.)
      const delegation = starts.find((s) => typeof s.args?.agent === "string") ?? starts[0];
      const intent = delegation.args?.intent;
      expect(typeof intent, `intent missing; args: ${JSON.stringify(delegation.args)}`).toBe("string");
      expect((intent as string).trim().length).toBeGreaterThan(0);
    } finally {
      client.stop();
    }
  },
  240_000,
);
