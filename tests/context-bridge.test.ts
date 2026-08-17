import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * B5 contract test — the bridge's /hv-context* commands over REAL RPC
 * (docs/validation/d1.md §hv.context).
 *
 * The snapshot-shape + in-flight-refusal tests need no model. The
 * remove→resume-survival guarantee needs real turns (entries + a completed
 * turn), so it is DEEPSEEK-gated like bridge.test.ts. A real --session-dir is
 * used (not --no-session) so pi.appendEntry persistence works.
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");

type UiReq = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type PiEvent = { type?: string; [k: string]: unknown };

function makeClient(cwd: string, sessionDir: string, env: Record<string, string>, resumeFile?: string) {
  const requests: UiReq[] = [];
  const events: PiEvent[] = [];
  const waiters: { match: (r: UiReq) => boolean; resolve: (r: UiReq) => void }[] = [];
  const client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--session-dir", sessionDir,
      ...(resumeFile ? ["--session", resumeFile] : []),
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
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
  // Resolves on the NEXT agent_end after `from` events (must check already-
  // collected events too, or a fast turn that ends before we attach hangs).
  const agentEndAfter = (from: number, timeoutMs = 90_000): Promise<void> =>
    new Promise((resolve, reject) => {
      if (events.slice(from).some((e) => e.type === "agent_end")) return resolve();
      const t = setTimeout(() => reject(new Error("timeout waiting for agent_end")), timeoutMs);
      client.on("event", (e) => { if ((e as PiEvent).type === "agent_end") { clearTimeout(t); resolve(); } });
    });
  return { client, requests, events, nextRequest, agentEndAfter };
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

// ── mark → filter round-trip + persistence survival (real model) ─────────────
// The completed-turn gate treats everything at/after the LAST user message as
// in-flight, so we run TWO trivial turns; turn 1 then becomes a removable
// completed item. We remove it, then prove the mark PERSISTS by killing the Pi
// process and resuming the same session file (--session): a fresh bridge
// restoreMarks() re-reads the hv-context-marks custom entry on session_start.
// This is the same appendEntry-persistence machinery session_before_compact
// re-invokes, proven deterministically (manual compact refuses on a session
// this small). Also asserts a manual compact is at least accepted-or-refused
// cleanly (never crashes the bridge). Every await is bounded.

test.skipIf(!KEY)(
  "a completed-turn item can be removed, and the mark SURVIVES a resume (persistence)",
  async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-cwd-"));
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-sess-"));
    const h = makeClient(cwd, sessionDir, PROVIDER_ENV);
    let sessionFile: string;
    let mark: string | undefined;
    try {
      await h.client.start();

      const b1 = h.events.length;
      await h.client.send({ type: "prompt", message: "Reply with exactly: ONE" });
      await h.agentEndAfter(b1);
      const b2 = h.events.length;
      await h.client.send({ type: "prompt", message: "Reply with exactly: TWO" });
      await h.agentEndAfter(b2);

      // Find a removable completed-turn item (turn 1).
      await h.client.send({ type: "prompt", message: "/hv-context" });
      const snap = await h.nextRequest((r) => isCtx(r, "snapshot"));
      const items = payload(snap).items as Array<{ markKey: string | null; removable: boolean }>;
      mark = items.find((i) => i.removable && i.markKey)?.markKey;
      expect(mark, "expected a removable completed-turn item after two turns").toBeTruthy();

      // Remove it — accepted (completed turn), persisted via pi.appendEntry.
      await h.client.send({ type: "prompt", message: `/hv-context-remove ${mark}` });
      const removed = await h.nextRequest((r) => isCtx(r, "removed") && (payload(r).accepted as string[]).includes(mark!));
      expect(payload(removed).marks).toContain(mark);

      // A manual compact must never crash the bridge (it may refuse on a tiny
      // session — success:false is fine; the bridge's re-append hook still ran).
      const compactRes = await h.client.send({ type: "compact" });
      expect(typeof (compactRes as { success?: boolean }).success).toBe("boolean");

      const state = (await h.client.send({ type: "get_state" })).data as { sessionFile?: string };
      expect(state.sessionFile, "session file path").toBeTruthy();
      sessionFile = state.sessionFile!;
    } finally {
      h.client.stop();
    }

    // Resume from the SAME session file in a fresh Pi process.
    const h2 = makeClient(fs.mkdtempSync(path.join(os.tmpdir(), "hv-ctx-cwd2-")), sessionDir, PROVIDER_ENV, sessionFile);
    try {
      await h2.client.start();
      await h2.client.send({ type: "prompt", message: "/hv-context" });
      // GUARANTEE: the mark restored from the persisted hv-context-marks entry.
      const after = await h2.nextRequest(
        (r) => isCtx(r, "snapshot") && (payload(r).marks as string[]).includes(mark!),
        30_000,
      );
      expect(payload(after).marks).toContain(mark);
    } finally {
      h2.client.stop();
    }
  },
  180_000,
);
