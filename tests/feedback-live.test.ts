import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedbackClient, FileStore } from "inlet-sdk/feedback/node";
import { sendFeedback } from "../src/main/feedback/client";
import { FEEDBACK_CHANNELS } from "../src/main/feedback/config";

/**
 * §34 — the Inlet contract, against the real server.
 *
 * The `tests/git-remote.test.ts` precedent: a real remote, a dedicated place to
 * write, cleanup in `afterAll`, and it skips itself when the key is absent so CI
 * never sees it. It is the pin-bump gate for Inlet — if the API changes shape,
 * this is what turns red rather than a user's first report going nowhere.
 *
 * `.env` is gitignored and does NOT travel with a worktree, so symlink it first:
 *   ln -s ~/Documents/Github/HappyVibe/.env .env
 * Same silent-skip class as the live-Pi batch: READ THE DURATION before
 * believing a green run — a real one makes three network round trips.
 *
 * It writes to its OWN database, "Smoke tests", so even a failed cleanup can
 * never touch real feedback.
 */
for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SMOKE_DB = "fdb_d27rwrartady";
const PUB = FEEDBACK_CHANNELS.dev.publishableKey as string;
const BASE = FEEDBACK_CHANNELS.dev.baseUrl;
/** The isk_ SERVER key, for cleanup ONLY. Never imported by anything under src/. */
const SERVER = process.env.FEEDBACK_API_KEY;

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const created: string[] = [];

/**
 * Reachability, the `git-remote.test.ts` shape: a developer with the key but no
 * network gets a SKIP, not a red suite. Without this, `npm test` on a plane
 * fails for a reason that has nothing to do with the change under test.
 */
async function reachable(): Promise<boolean> {
  if (!SERVER) return false;
  try {
    const res = await fetch(`${BASE}/v1/feedback-databases/${SMOKE_DB}/form`, {
      headers: { authorization: `Bearer ${PUB}` },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const LIVE = await reachable();

describe.skipIf(!LIVE)("§34 live: the Inlet contract, on the Smoke tests database", () => {
  it("read form → session → upload a 1×1 PNG → submit → accepted, through the SDK client", async () => {
    const client = new FeedbackClient({
      baseUrl: BASE,
      publishableKey: PUB,
      feedbackDatabaseId: SMOKE_DB,
      store: new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), "hv-inlet-smoke-"))),
    });
    const form = await client.refreshForm();
    if (!form.ok) throw new Error(form.error.message);
    // Read the ids off the definition rather than hard-coding them: the app does
    // the same, and a test that hard-codes them would not notice if it stopped.
    const els = form.value.pages.flatMap((p) => p.elements);
    const text = els.find((e) => e.type === "text")!;
    const shot = els.find((e) => e.type === "screenshot")!;
    expect(text && shot).toBeTruthy();

    const r = await sendFeedback(client, {
      formVersion: form.value.formVersion,
      answers: { [text.id]: { value: `smoke ${new Date().toISOString()}` } },
      uploads: [{ questionId: shot.id, name: "px.png", type: "image/png", bytes: new Uint8Array(PNG_1x1) }],
      clientContext: { appVersion: "test", channel: "dev" },
    });
    if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
    if (r.submissionId) created.push(r.submissionId);

    expect(r.status).toBe("accepted");
    expect(r.attachments).toBe(1);
    expect(r.submissionId).toMatch(/^sub_/);
    expect(r.formVersion).toBe(form.value.formVersion);
  }, 60_000);

  it("a publishable key cannot read a single response — the whole reason it may be committed", async () => {
    const res = await fetch(`${BASE}/v1/feedback-databases/${SMOKE_DB}/submissions`, {
      headers: { authorization: `Bearer ${PUB}` },
    });
    expect(res.ok).toBe(false);
    expect([401, 403]).toContain(res.status);
  }, 30_000);

  afterAll(async () => {
    for (const id of created) {
      const res = await fetch(`${BASE}/v1/feedback-databases/${SMOKE_DB}/submissions/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${SERVER}` },
      });
      // Loud on failure: a smoke row left behind is a row someone will later
      // read as real feedback.
      expect([200, 204]).toContain(res.status);
    }
  });
});
