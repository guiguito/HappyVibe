import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init, captureMessage, flush } from "inlet-sdk/crash";
import { FileStore } from "inlet-sdk/crash/node";
import type { CrashEnvelope, SentReport } from "inlet-sdk/crash";
import { FEEDBACK_CHANNELS } from "../src/main/feedback/config";
import { TAG_ALLOW, scrubEnvelope } from "../src/main/crash/policy";

/**
 * §37 — the Inlet crash contract, against the real server.
 *
 * The `tests/feedback-live.test.ts` shape: `.env`, a reachability probe, and it
 * skips itself when the key is absent so CI never sees it. It is the pin-bump
 * gate for the crash half of Inlet — if the envelope or the response changes
 * shape, this turns red rather than a user's first crash going nowhere.
 *
 * `.env` is gitignored and does NOT travel with a worktree, so symlink it:
 *   ln -s ~/Documents/Github/HappyVibe/.env .env
 * READ THE DURATION before believing a green run — a real one makes two
 * network round trips.
 *
 * Unlike the feedback smoke test there is NO cleanup: a publishable key cannot
 * delete a report, by design. The DEV database is the sink, which is exactly
 * what a dev database is for.
 */
for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PUB = FEEDBACK_CHANNELS.dev.publishableKey as string;
const BASE = FEEDBACK_CHANNELS.dev.baseUrl;
const DB = FEEDBACK_CHANNELS.dev.crashDatabase;

/** A developer with the key but no network gets a SKIP, not a red suite. */
async function reachable(): Promise<boolean> {
  if (!process.env.FEEDBACK_API_KEY) return false;
  try {
    const res = await fetch(`${BASE}/v1/health`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { capabilities?: string[] };
    // The deployment must actually carry the crash resource. Without this the
    // test would fail as "the server refused" on a server that simply predates
    // the feature, which is a different problem with a different fix.
    return Array.isArray(body.capabilities) ? body.capabilities.includes("crash") : true;
  } catch {
    return false;
  }
}

const LIVE = await reachable();

describe.skipIf(!LIVE)("§37 live: the Inlet crash contract, on the dev database", () => {
  it("captureMessage → flush → the server accepts it and names the group", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-crash-live-"));
    const sent: Array<{ sent: SentReport; envelope: CrashEnvelope }> = [];
    try {
      init({
        baseUrl: BASE,
        publishableKey: PUB,
        crashDatabaseId: DB,
        release: "0.0.0-crash-live",
        channel: "dev",
        environment: "development",
        // A tmp queue, so a failed send never leaves anything in the
        // developer's real userData directory.
        store: new FileStore(dir),
        // The app's own hook, so this asserts what a user would actually send
        // rather than what the SDK would send unfiltered.
        beforeSendSync: scrubEnvelope,
        tags: { runtime: "crash-live", channel: "dev" },
        tagAllowlist: [...TAG_ALLOW],
        // Dedupe off: the same fingerprint every run would make this pass once
        // a day and silently skip after that, which reads exactly like a pass.
        dedupe: false,
        timeoutMs: 20_000,
        onSent: (s, e) => sent.push({ sent: s, envelope: e }),
      });

      await captureMessage(`crash-live smoke ${new Date().toISOString()}`);
      await flush(20_000);

      expect(sent).toHaveLength(1);
      expect(sent[0].sent.reportId).toMatch(/^\w/);
      expect(sent[0].sent.groupId).toMatch(/^\w/);
      expect(typeof sent[0].sent.isNewGroup).toBe("boolean");

      // What actually went over the wire, asserted once against the real
      // server rather than only against the pure function.
      const e = sent[0].envelope;
      expect(Object.keys(e.tags ?? {}).sort()).toEqual([...TAG_ALLOW].sort());
      expect(e).not.toHaveProperty("context");
      expect(JSON.stringify(e)).not.toContain("/Users/");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
