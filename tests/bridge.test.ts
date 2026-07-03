import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

// Tiny .env loader — keeps tests dependency-free
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

test.skipIf(!KEY)("bridge intercepts bash; deny blocks and agent continues", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-bridge-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: { ...process.env, DEEPSEEK_API_KEY: KEY! } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();

  const gotPrompt = new Promise<Record<string, unknown>>((resolve) =>
    client.on("ui-request", (m) => {
      // Log the full raw extension_ui_request for empirical shape verification (Task 6 requirement)
      console.log("[bridge.test] RAW ui-request:", JSON.stringify(m, null, 2));
      resolve(m as Record<string, unknown>);
    }));
  const done = new Promise<void>((resolve) =>
    client.on("event", (e) => { if (e.type === "agent_end") resolve(); }));

  await client.send({
    type: "prompt",
    // Strongly-worded prompt to force a bash tool call. DeepSeek may reason first,
    // but the explicit instruction should compel the bash tool.
    message: "You MUST immediately run exactly this shell command using the bash tool: touch forbidden.txt. Do not explain, do not ask questions — just call the bash tool with that command right now.",
  });

  const req = await gotPrompt;

  // Empirically verify the ui-request shape (method should be "select")
  expect(req.method).toBe("select");
  expect(typeof req.id).toBe("string");
  expect(typeof req.title).toBe("string");

  // Parse the structured JSON title emitted by the bridge
  const titleObj = JSON.parse(req.title as string);
  expect(titleObj.kind).toBe("hv.permission");
  console.log("[bridge.test] Parsed title:", titleObj);

  // Per rpc-types.d.ts: RpcExtensionUIResponse for select uses { value: string }
  // This is the proven shape from type inspection — empirically confirmed by this test run.
  const responsePayload = { value: "Deny" };
  console.log("[bridge.test] Sending response:", JSON.stringify(responsePayload));
  client.respondUi(req.id as string, responsePayload);

  // Wait for agent_end — proves agent continued gracefully after denial
  await done;
  console.log("[bridge.test] agent_end received — agent continued gracefully");

  // CRITICAL: forbidden.txt must NOT have been created (deny blocked the bash tool)
  const forbidden = path.join(tmp, "forbidden.txt");
  expect(fs.existsSync(forbidden)).toBe(false);
  console.log("[bridge.test] PASS: forbidden.txt does NOT exist — deny successfully blocked tool call");
}, 120_000);
