import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * B4 contract test — the bridge, handed a rules file via HV_RULES_FILE,
 * loads/reloads it and emits hv.rules / hv.dangerous / hv.audit shaped
 * notifies over real RPC (docs/validation/d1.md §B4).
 *
 * Reload + dangerous-mode contracts need no model. The rule-deny audit
 * contract needs a real tool_call, so it is DEEPSEEK-gated like bridge.test.ts.
 */

// Tiny .env loader — keeps tests dependency-free (same as bridge.test.ts).
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;

const runtime = path.join(process.cwd(), "pi-runtime");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-rules-cwd-"));
const rulesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-rules-")), "permission-rules.json");

type UiReq = { id: string; method?: string; title?: string; message?: string; options?: string[] };
const requests: UiReq[] = [];
const waiters: { match: (r: UiReq) => boolean; resolve: (r: UiReq) => void }[] = [];

function nextRequest(match: (r: UiReq) => boolean, timeoutMs = 30_000): Promise<UiReq> {
  return new Promise((resolve, reject) => {
    const hit = requests.find(match);
    if (hit) return resolve(hit);
    const t = setTimeout(
      () => reject(new Error(`timed out waiting for ui-request; saw: ${JSON.stringify(requests)}`)),
      timeoutMs,
    );
    waiters.push({ match, resolve: (r) => { clearTimeout(t); resolve(r); } });
  });
}

function payloadOf(r: UiReq): Record<string, unknown> {
  try {
    return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
const isKind = (r: UiReq, kind: string) => payloadOf(r).kind === kind;

function makeClient(env: Record<string, string>): PiClient {
  const client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HV_RULES_FILE: rulesPath, ...env } as Record<string, string>,
    cwd: workDir,
  });
  client.on("ui-request", (m) => {
    const r = m as UiReq;
    requests.push(r);
    const i = waiters.findIndex((w) => w.match(r));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(r);
  });
  return client;
}

let client: PiClient;

beforeAll(async () => {
  fs.writeFileSync(
    rulesPath,
    JSON.stringify({
      global: [{ layer: "command", pattern: "touch *", action: "deny" }],
      workspaces: { [workDir]: [{ layer: "path", pattern: ".env", action: "deny" }] },
    }),
  );
  client = makeClient({});
  await client.start();
}, 60_000);

afterAll(() => client?.stop());

test("/hv-rules-reload emits an hv.rules notify with rule counts from HV_RULES_FILE", async () => {
  await client.send({ type: "prompt", message: "/hv-rules-reload" });
  const req = await nextRequest((r) => isKind(r, "hv.rules"));
  expect(req.method).toBe("notify");
  expect(payloadOf(req)).toMatchObject({ kind: "hv.rules", stage: "loaded", global: 1, workspaces: 1 });
});

test("/hv-rules-reload picks up a rewritten rules file (main's edit-then-broadcast path)", async () => {
  fs.writeFileSync(
    rulesPath,
    JSON.stringify({
      global: [
        { layer: "command", pattern: "touch *", action: "deny" },
        { layer: "tool", pattern: "write", action: "ask" },
      ],
      workspaces: {},
    }),
  );
  await client.send({ type: "prompt", message: "/hv-rules-reload" });
  const req = await nextRequest((r) => isKind(r, "hv.rules") && payloadOf(r).global === 2);
  expect(payloadOf(req)).toMatchObject({ stage: "loaded", global: 2, workspaces: 0 });
});

test("/hv-dangerous toggles per-session and emits hv.dangerous notifies", async () => {
  await client.send({ type: "prompt", message: "/hv-dangerous on" });
  const on = await nextRequest((r) => isKind(r, "hv.dangerous"));
  expect(payloadOf(on)).toMatchObject({ kind: "hv.dangerous", on: true });

  await client.send({ type: "prompt", message: "/hv-dangerous off" });
  const off = await nextRequest((r) => isKind(r, "hv.dangerous") && payloadOf(r).on === false);
  expect(payloadOf(off)).toMatchObject({ on: false });

  await client.send({ type: "prompt", message: "/hv-dangerous sideways" });
  const err = await nextRequest((r) => isKind(r, "hv.dangerous") && payloadOf(r).stage === "error");
  expect(String(payloadOf(err).message)).toContain("Usage");
});

test.skipIf(!KEY)(
  "rule-deny blocks the tool with NO permission prompt and emits an hv.audit deny notify",
  async () => {
    // Fresh client with a real key; rules file back to the deny rule.
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({ global: [{ layer: "command", pattern: "touch *", action: "deny" }], workspaces: {} }),
    );
    const c = makeClient({ DEEPSEEK_API_KEY: KEY! });
    try {
      await c.start();
      const seen = requests.length; // only inspect requests from this point on
      const done = new Promise<void>((resolve) => c.on("event", (e) => { if (e.type === "agent_end") resolve(); }));
      await c.send({
        type: "prompt",
        message:
          "You MUST immediately run exactly this shell command using the bash tool: touch forbidden.txt. Do not explain, do not ask questions — just call the bash tool with that command right now.",
      });

      const auditReq = await nextRequest((r) => isKind(r, "hv.audit"), 90_000);
      const audit = payloadOf(auditReq);
      expect(auditReq.method).toBe("notify");
      expect(audit).toMatchObject({
        kind: "hv.audit",
        tool: "bash",
        decision: "deny",
        source: "rule",
        rule: { layer: "command", pattern: "touch *", action: "deny", scope: "global" },
      });
      expect(typeof audit.ts).toBe("string");
      expect(String(audit.summary)).toContain("touch");

      await done; // agent continued gracefully after the block
      // No user prompt may have appeared — the rule decided, not the modal.
      expect(requests.slice(seen).some((r) => isKind(r, "hv.permission"))).toBe(false);
      expect(fs.existsSync(path.join(workDir, "forbidden.txt"))).toBe(false);
    } finally {
      c.stop();
    }
  },
  180_000,
);
