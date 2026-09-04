import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * W2.3 contract test — nested AGENTS.md injection over REAL RPC
 * (docs/validation/d1.md §hv.context-files).
 *
 * The bridge-load + empty-state test needs no model. The injection round-trip
 * NEEDS a real model: tool_call only fires when the agent actually calls a
 * tool, and before_agent_start only fires on a real turn — there is no
 * scripted way to synthesize either, so it is DEEPSEEK-gated like
 * bridge.test.ts. Verification is via the bridge's own capture: /hv-sysprompt
 * returns the injected prompt (systemText is set to the injected value).
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

type UiReq = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type PiEvent = { type?: string; [k: string]: unknown };

function makeClient(cwd: string, sessionDir: string, env: Record<string, string>) {
  const requests: UiReq[] = [];
  const events: PiEvent[] = [];
  const waiters: { match: (r: UiReq) => boolean; resolve: (r: UiReq) => void }[] = [];
  const client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--session-dir", sessionDir,
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env } as Record<string, string>,
  });
  client.on("ui-request", (raw) => {
    const r = raw as UiReq;
    requests.push(r);
    const i = waiters.findIndex((w) => w.match(r));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(r);
  });
  client.on("event", (e) => events.push(e as PiEvent));
  const nextRequest = (match: (r: UiReq) => boolean, timeoutMs = 30_000): Promise<UiReq> =>
    new Promise((resolve, reject) => {
      const hit = requests.find(match);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`timeout; saw ${JSON.stringify(requests)}`)), timeoutMs);
      waiters.push({ match, resolve: (r) => { clearTimeout(t); resolve(r); } });
    });
  const agentEndAfter = (from: number, timeoutMs = 90_000): Promise<void> =>
    new Promise((resolve, reject) => {
      if (events.slice(from).some((e) => e.type === "agent_end")) return resolve();
      const t = setTimeout(() => reject(new Error("timeout waiting for agent_end")), timeoutMs);
      client.on("event", (e) => {
        if ((e as PiEvent).type === "agent_end") { clearTimeout(t); resolve(); }
      });
    });
  return { client, requests, events, nextRequest, agentEndAfter };
}

const payload = (r: UiReq): Record<string, unknown> => {
  try { return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}") as Record<string, unknown>; } catch { return {}; }
};

// ── bridge loads with hv-agents-md wired; empty state stays clean (no model) ─

test("/hv-context works with the nested-AGENTS.md module loaded (no discoveries → no nested)", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-amd-cwd-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-amd-sess-"));
  const h = makeClient(cwd, sessionDir, {});
  try {
    await h.client.start();
    await h.client.send({ type: "prompt", message: "/hv-context" });
    const snap = await h.nextRequest((r) => payload(r).kind === "hv.context" && payload(r).stage === "snapshot");
    // No turn ran → system is null; and no hv.context-files notify ever fired.
    expect(payload(snap).system).toBeNull();
    expect(h.requests.some((r) => payload(r).kind === "hv.context-files")).toBe(false);
  } finally {
    h.client.stop();
  }
}, 60_000);

// ── injection round-trip (real model: tool_call + a second turn required) ────

test.skipIf(!KEY)(
  "touching a file in a subdir with its own AGENTS.md injects it into the NEXT turn's system prompt",
  async () => {
    // realpath: Pi's process.cwd() resolves the macOS /var → /private/var symlink.
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-amd-cwd-")));
    fs.mkdirSync(path.join(cwd, "sub"));
    // Root file too — proves the root is NOT duplicated into the nested section.
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "ROOT-MARKER-A7Q");
    fs.writeFileSync(path.join(cwd, "sub", "AGENTS.md"), "NESTED-MARKER-X9Z: always use tabs in sub/");
    fs.writeFileSync(path.join(cwd, "sub", "notes.txt"), "hello from sub");
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-amd-sess-"));
    const h = makeClient(cwd, sessionDir, PROVIDER_ENV);
    try {
      await h.client.start();

      // Turn 1: make the agent touch sub/ with a file tool (read is safe-default allowed).
      const b1 = h.events.length;
      await h.client.send({ type: "prompt", message: "Use the read tool to read the file sub/notes.txt, then reply with exactly: DONE" });
      // Discovery notify fires on the tool_call, before the turn even ends.
      const nf = await h.nextRequest((r) => payload(r).kind === "hv.context-files", 90_000);
      const nested = payload(nf).nested as Array<{ dir: string; path: string; chars: number }>;
      expect(nested).toHaveLength(1);
      expect(nested[0].dir).toBe("sub");
      expect(nested[0].path).toBe(path.join(cwd, "sub", "AGENTS.md"));
      await h.agentEndAfter(b1);

      // Turn 2: the nested section must be in THIS turn's system prompt.
      const b2 = h.events.length;
      await h.client.send({ type: "prompt", message: "Reply with exactly: OK" });
      await h.agentEndAfter(b2);
      await h.client.send({ type: "prompt", message: "/hv-sysprompt" });
      const sys = await h.nextRequest((r) => payload(r).kind === "hv.sysprompt");
      const text = payload(sys).text as string;
      expect(text).toContain("## Nested AGENTS.md (scoped instructions)");
      expect(text).toContain("NESTED-MARKER-X9Z");
      // Root file appears once via Pi's own context files, NOT in our nested section.
      expect(text.slice(text.indexOf("## Nested AGENTS.md")).includes("ROOT-MARKER-A7Q")).toBe(false);

      // Snapshot's system block carries the nested list for the context panel.
      await h.client.send({ type: "prompt", message: "/hv-context" });
      const snap = await h.nextRequest((r) => payload(r).kind === "hv.context" && payload(r).stage === "snapshot");
      const system = payload(snap).system as { nested?: Array<{ dir: string }> };
      expect(system.nested?.map((f) => f.dir)).toEqual(["sub"]);
    } finally {
      h.client.stop();
    }
  },
  180_000,
);
