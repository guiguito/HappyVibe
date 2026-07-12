import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * V2.B contract test — the registered ask_user tool surfaces a real
 * extension_ui_request (method "input", title JSON kind "hv.ask-user"), the
 * answer rides back over the wire as {value: JSON answers}, and the tool
 * result reaches the model (round-trip proven by tool_execution_end).
 *
 * DEEPSEEK-gated; pattern of intent-bridge.test.ts; client killed in finally.
 */

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;

const runtime = path.join(process.cwd(), "pi-runtime");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ask-cwd-"));
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ask-sess-"));

type PiEvent = { type?: string; toolName?: string; isError?: boolean; result?: unknown; [k: string]: unknown };
type UiReq = { id: string; method?: string; title?: string; [k: string]: unknown };

test.skipIf(!KEY)(
  "ask_user round-trips: hv.ask-user input request → answered over the wire → tool result reaches the model",
  async () => {
    const spec = resolvePiSpawn(workDir, sessionDir, runtime, {
      providerEnv: { DEEPSEEK_API_KEY: KEY! },
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
    });
    const client = new PiClient(spec);
    const events: PiEvent[] = [];
    client.on("event", (e) => events.push(e as PiEvent));

    let askReq: UiReq | undefined;
    client.on("ui-request", (r: UiReq) => {
      if (r.method !== "input") return;
      try {
        if (JSON.parse(r.title ?? "").kind !== "hv.ask-user") return;
      } catch {
        return;
      }
      askReq = r;
      // Answer exactly like the renderer: {value: JSON.stringify(AskAnswer[])}.
      client.respondUi(r.id, {
        value: JSON.stringify([
          { question: "Which greeting should I use?", header: "Greeting", answers: ["Hello (Recommended)"], note: "keep it simple" },
        ]),
      });
    });

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
          "Call the ask_user tool right now with intent 'Choosing a greeting style' and exactly one question: " +
          "question 'Which greeting should I use?', header 'Greeting', multiSelect false, options " +
          "[{label 'Hello (Recommended)', description 'Plain and friendly'}, {label 'Hi', description 'Casual'}]. " +
          "After the tool returns, reply with one short sentence and do nothing else.",
      });
      await done;

      // 1) The wire request arrived with the documented shape (d1.md §hv.ask-user).
      expect(askReq, "expected an hv.ask-user input ui-request").toBeDefined();
      const payload = JSON.parse(askReq!.title!) as {
        kind: string;
        intent: string;
        questions: Array<{ question: string; header: string; multiSelect: boolean; options: Array<{ label: string }> }>;
      };
      expect(payload.kind).toBe("hv.ask-user");
      expect(payload.intent.length).toBeGreaterThan(0);
      expect(payload.questions).toHaveLength(1);
      expect(payload.questions[0].header.length).toBeLessThanOrEqual(12);
      expect(payload.questions[0].options.length).toBeGreaterThanOrEqual(2);

      // 2) The response round-trip completed: the tool finished without error
      //    and the model-visible result carries the chosen label.
      const end = events.find((e) => e.type === "tool_execution_end" && e.toolName === "ask_user");
      expect(end, "expected an ask_user tool_execution_end").toBeDefined();
      expect(end!.isError).toBeFalsy();
      expect(JSON.stringify(end!.result)).toContain("Hello (Recommended)");
    } finally {
      client.stop();
    }
  },
  240_000,
);
