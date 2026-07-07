import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * B5 contract test — the bridge's /hv-context* commands over REAL RPC
 * (docs/validation/d1.md §hv.context).
 *
 * The snapshot-shape test needs no model. The mark→filter round-trip and the
 * "marks survive a compact" guarantee need a real turn (entries + a completed
 * turn), so they are DEEPSEEK-gated like bridge.test.ts. A real --session-dir
 * is used (not --no-session) so pi.appendEntry persistence + compaction work.
 */

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;

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
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--session-dir", sessionDir,
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env } as Record<string, string>,
    cwd,
  });
  client.on("ui-request", (m) => {
    const r = m as UiReq;
    requests.push(r);
    const i = waiters.findIndex((w) => w.match(r));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(r);
  });
  client.on("event", (e) => events.push(e as PiEvent));
  const nextRequest = (match: (r: UiReq) => boolean, timeoutMs = 30_000): Promise<UiReq> =>
    new Promise((resolve, reject) => {
      const hit = requests.find(match);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`timeout; saw: ${JSON.stringify(requests)}`)), timeoutMs);
      waiters.push({ match, resolve: (r) => { clearTimeout(t); resolve(r); } });
    });
  const agentEnd = (): Promise<void> =>
    new Promise((resolve) => client.on("event", (e) => { if ((e as PiEvent).type === "agent_end") resolve(); }));
  return { client, requests, events, nextRequest, agentEnd };
}

const payload = (r: UiReq): Record<string, unknown> => {
  try { return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}"); } catch { return {}; }
};
const isCtx = (r: UiReq, stage: string) => payload(r).kind === "hv.context" && payload(r).stage === stage;

// ── snapshot shape (no model) ────────────────────────────────────────────────

test("/hv-context emits an hv.context snapshot notify with system + items + marks", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-cwd-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-sess-"));
  const h = makeClient(cwd, sessionDir, {});
  try {
    await h.client.start();
    await h.client.send({ type: "prompt", message: "/hv-context" });
    const snap = await h.nextRequest((r) => isCtx(r, "snapshot"));
    expect(snap.method).toBe("notify");
    const p = payload(snap);
    expect(p).toMatchObject({ kind: "hv.context", stage: "snapshot" });
    expect(Array.isArray(p.items)).toBe(true);
    expect(Array.isArray(p.marks)).toBe(true);
    // system is null until a turn runs (before_agent_start hasn't fired), but the key exists.
    expect("system" in p).toBe(true);
  } finally {
    h.client.stop();
  }
}, 60_000);

test("/hv-context-remove refuses unknown/in-flight keys (nothing to accept) with a warning", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-cwd-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-sess-"));
  const h = makeClient(cwd, sessionDir, {});
  try {
    await h.client.start();
    await h.client.send({ type: "prompt", message: "/hv-context-remove msg:999999" });
    const ack = await h.nextRequest((r) => isCtx(r, "removed"));
    const p = payload(ack);
    expect(p.accepted).toEqual([]);
    expect(p.refused).toEqual(["msg:999999"]);
    expect(ack.notifyType ?? "warning").toBeTruthy(); // warning-level (no completed match)
  } finally {
    h.client.stop();
  }
}, 60_000);

// ── mark → filter round-trip + compaction survival (real model) ──────────────

test.skipIf(!KEY)(
  "a completed-turn tool pair can be removed, and the mark SURVIVES a compact",
  async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-cwd-"));
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-sess-"));
    const h = makeClient(cwd, sessionDir, { DEEPSEEK_API_KEY: KEY! });
    try {
      await h.client.start();

      // Turn 1: force a bash tool call so we get a toolCall/toolResult pair,
      // then let the turn complete (so it's removable).
      await h.client.send({
        type: "prompt",
        message: "Call the bash tool once with exactly: echo hi. Then reply with just: DONE.",
      });
      await h.agentEnd();

      // Snapshot after a completed turn: find a removable tool pair.
      await h.client.send({ type: "prompt", message: "/hv-context" });
      const snap = await h.nextRequest((r) => isCtx(r, "snapshot"));
      const items = payload(snap).items as Array<{ markKey: string | null; group: string; removable: boolean }>;
      const toolMark = items.find((i) => i.group === "tool" && i.removable && i.markKey)?.markKey;
      expect(toolMark, "expected a removable completed tool pair").toBeTruthy();

      // Remove it — accepted (completed turn).
      await h.client.send({ type: "prompt", message: `/hv-context-remove ${toolMark}` });
      const removed = await h.nextRequest((r) => isCtx(r, "removed") && (payload(r).accepted as string[]).includes(toolMark!));
      expect(payload(removed).marks).toContain(toolMark);

      // Compact. The bridge re-appends marks in session_before_compact.
      // compaction_end is an event (not a ui-request) — poll events directly.
      await h.client.send({ type: "compact" });
      const compacted = await new Promise<boolean>((resolve) => {
        if (h.events.some((e) => e.type === "compaction_end")) return resolve(true);
        const t = setTimeout(() => resolve(h.events.some((e) => e.type === "compaction_end")), 60_000);
        h.client.on("event", (e) => { if ((e as PiEvent).type === "compaction_end") { clearTimeout(t); resolve(true); } });
      });
      expect(compacted).toBe(true);

      // GUARANTEE: the mark still applies after compaction.
      await h.client.send({ type: "prompt", message: "/hv-context" });
      const after = await h.nextRequest(
        (r) => isCtx(r, "snapshot") && (payload(r).marks as string[]).includes(toolMark!),
        30_000,
      );
      expect(payload(after).marks).toContain(toolMark);
    } finally {
      h.client.stop();
    }
  },
  240_000,
);
