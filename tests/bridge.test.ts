import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";

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

  // Collect every ui-request and answer the permission prompt as it arrives —
  // the request must be denied for the turn to continue, so it cannot wait for
  // the assertions below.
  const reqs: Record<string, unknown>[] = [];
  client.on("ui-request", (m) => {
    // Log the full raw extension_ui_request for empirical shape verification (Task 6 requirement)
    console.log("[bridge.test] RAW ui-request:", JSON.stringify(m, null, 2));
    const r = m as { id: string; method?: string };
    reqs.push(m as Record<string, unknown>);
    if (r.method === "select") {
      // Per rpc-types.d.ts: RpcExtensionUIResponse for select uses { value: string }
      client.respondUi(r.id, { value: "Deny" });
    }
  });
  const done = new Promise<void>((resolve) =>
    client.on("event", (e) => { if (e.type === "agent_end") resolve(); }));

  // The prompt is strongly worded, and a small model still sometimes answers in
  // prose instead of calling bash — so re-ask rather than fail on the model.
  //
  // It names `bash` and rules out terminal_run explicitly, and that is measured
  // rather than defensive. §26 part 2 added three terminal tools, and a bigger
  // tool list dilutes a small model's tool choice: over 5 trials of the older,
  // shorter prompt, bash was called 3/5 times before those tools existed, 1/5
  // with them registered and 0/5 with the system-prompt steer line as well. The
  // model was not picking terminal_run instead — it stopped calling tools at
  // all. With the wording below it is 5/5 with the whole feature enabled.
  // The assertions are untouched; this only insists on getting the call the
  // test is about.
  const asked = await askUntil(
    () => client.send({
      type: "prompt",
      message: "Call the `bash` tool right now with command exactly: touch forbidden.txt\n\nUse the "
      + "`bash` tool specifically — this is a one-off command that finishes immediately, so it is NOT a "
      + "terminal_run. Do not explain, do not ask questions, do not reply in prose: make the tool call.",
    }),
    () => reqs.some((r) => r.method === "select"),
  );
  expect(asked, "model never triggered a permission prompt across 3 attempts").toBe(true);
  const req = reqs.find((r) => r.method === "select")!;

  // Empirically verify the ui-request shape (method should be "select")
  expect(req.method).toBe("select");
  expect(typeof req.id).toBe("string");
  expect(typeof req.title).toBe("string");

  // Parse the structured JSON title emitted by the bridge
  const titleObj = JSON.parse(req.title as string);
  expect(titleObj.kind).toBe("hv.permission");
  console.log("[bridge.test] Parsed title:", titleObj);

  // Wait for agent_end — proves agent continued gracefully after denial
  await done;
  console.log("[bridge.test] agent_end received — agent continued gracefully");

  // CRITICAL: forbidden.txt must NOT have been created (deny blocked the bash tool)
  const forbidden = path.join(tmp, "forbidden.txt");
  expect(fs.existsSync(forbidden)).toBe(false);
  console.log("[bridge.test] PASS: forbidden.txt does NOT exist — deny successfully blocked tool call");
}, 240_000); // up to 3 × 45 s of re-asking, plus spawn
