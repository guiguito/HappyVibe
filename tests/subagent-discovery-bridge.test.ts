import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * Subagent discoverability contract test (docs/validation/d1.md §hv.subagent).
 *
 * The bridge injects an "## Available subagents" roster into the system prompt
 * each turn (renderSubagentSection, same per-turn mechanism as nested
 * AGENTS.md) and mirrors it in the /hv-context snapshot's system block. The
 * enumeration (/hv-agents) needs no model; the injection needs a real turn
 * (before_agent_start only fires on a turn), so it is DEEPSEEK-gated like
 * agents-md-bridge.test.ts.
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

/** cwd with a project agent at .pi/agents/scout.md the bridge should enumerate. */
function cwdWithAgent(): string {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-disc-cwd-")));
  fs.mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "agents", "scout.md"),
    "---\nname: scout\ndescription: SCOUT-MARKER-Q3 reconnaissance agent\ntools: read, grep\n---\nYou are Scout.\n",
  );
  return cwd;
}

// ── /hv-agents enumerates the project agent (no model) ───────────────────────

test("/hv-agents lists the project agent", async () => {
  const cwd = cwdWithAgent();
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-disc-sess-"));
  const h = makeClient(cwd, sessionDir, {});
  try {
    await h.client.start();
    await h.client.send({ type: "prompt", message: "/hv-agents" });
    const r = await h.nextRequest((rq) => payload(rq).kind === "hv.agents");
    const agents = payload(r).agents as Array<{ name: string }>;
    expect(agents.some((a) => a.name === "scout")).toBe(true);
  } finally {
    h.client.stop();
  }
}, 60_000);

// ── injection round-trip (real model: before_agent_start needs a turn) ───────

test.skipIf(!KEY)(
  "the subagent roster is injected into the system prompt and appears in the context snapshot",
  async () => {
    const cwd = cwdWithAgent();
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-disc-sess-"));
    const h = makeClient(cwd, sessionDir, PROVIDER_ENV);
    try {
      await h.client.start();
      const b1 = h.events.length;
      await h.client.send({ type: "prompt", message: "Reply with exactly: OK" });
      await h.agentEndAfter(b1);

      await h.client.send({ type: "prompt", message: "/hv-sysprompt" });
      const sys = await h.nextRequest((r) => payload(r).kind === "hv.sysprompt");
      const text = payload(sys).text as string;
      expect(text).toContain("## Available subagents");
      expect(text).toContain("scout");
      expect(text).toContain("SCOUT-MARKER-Q3");

      await h.client.send({ type: "prompt", message: "/hv-context" });
      const snap = await h.nextRequest((r) => payload(r).kind === "hv.context" && payload(r).stage === "snapshot");
      const system = payload(snap).system as { agents?: Array<{ name: string }> };
      expect(system.agents?.map((a) => a.name)).toContain("scout");
    } finally {
      h.client.stop();
    }
  },
  180_000,
);
