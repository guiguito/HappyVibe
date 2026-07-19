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

/** §23: enter plan mode → a write attempt is blocked → plan_complete round-trips. */
test.skipIf(!KEY)("plan mode blocks writes and completes via the blocking plan-write envelope", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plan-"));
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

  // Collect all bridge notifies; auto-answer blocking requests so the run never hangs.
  const notifies: Record<string, unknown>[] = [];
  let planWriteAnswered = false;
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try { notifies.push(JSON.parse(r.message ?? "")); } catch { /* not JSON */ }
      return; // notifies are fire-and-forget
    }
    if (r.method === "input") {
      // The blocking plan-write envelope — answer with a fake workspace path
      // (main writes the real file; the bridge only needs the path back).
      try {
        const t = JSON.parse(r.title ?? "");
        if (t?.kind === "hv.plan-write") {
          planWriteAnswered = true;
          client.respondUi(r.id, { value: ".agents/plans/001-test.md" });
          return;
        }
      } catch { /* fall through */ }
      client.respondUi(r.id, { cancelled: true });
      return;
    }
    if (r.method === "select") client.respondUi(r.id, { value: "Deny" }); // no permission prompt expected in plan mode
  });

  const nextAgentEnd = (): Promise<void> =>
    new Promise((resolve) => {
      const h = (e: Record<string, unknown>): void => {
        if (e.type === "agent_end") { client.off?.("event", h); resolve(); }
      };
      client.on("event", h);
    });

  await client.start();

  // 1) Enter plan mode (slash command — no model turn) and confirm the notify.
  await client.send({ type: "prompt", message: "/hv-plan on" });
  await new Promise((r) => setTimeout(r, 500));
  expect(notifies.some((n) => n.kind === "hv.plan" && n.enabled === true)).toBe(true);

  // 2) The model tries to modify a file — plan mode must block it.
  let end = nextAgentEnd();
  await client.send({
    type: "prompt",
    message: "Run exactly this shell command with the bash tool right now: touch forbidden.txt. Just call the tool, do not explain.",
  });
  await end;
  expect(fs.existsSync(path.join(tmp, "forbidden.txt"))).toBe(false);
  expect(notifies.some((n) => n.kind === "hv.plan.blocked")).toBe(true);

  // 3) The model finalizes the plan → plan_complete → blocking plan-write round-trip.
  end = nextAgentEnd();
  await client.send({
    type: "prompt",
    message:
      "Stop exploring. Call the plan_complete tool now with a short markdown plan that has a '# Title', " +
      "a '## Tasks' section with one '- [ ] do the thing' item, and a '## Verification' section. Call it alone.",
  });
  await end;
  expect(planWriteAnswered).toBe(true);
}, 180_000);
