import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CrashClient, MemoryStore, defaultRedaction } from "inlet-sdk/crash";
import type { CrashEnvelope } from "inlet-sdk/crash";
import { scrubEnvelope } from "../src/main/crash/policy";

/**
 * §37 — UPSTREAM's behaviour, pinned. This file tests `inlet-sdk`, not HappyVibe.
 *
 * It is separated and named for that reason. Everything in `crash-policy`,
 * `crash-stderr-frames`, `crash-sentinel`, `crash-root`, `crash-safe-messages`,
 * `crash-audit`, `crash-optout` and `crash-wiring` asserts code we wrote; these
 * cases assert code we merely depend on, which makes them a **pin-bump gate**
 * rather than coverage — the `pi-subagents-contract.test.ts` role, one
 * dependency over. A failure here is a DECISION to take, never a test to patch.
 *
 * Two halves, and the second is the more valuable one:
 *
 *   1. Behaviour we RELY ON. If it changes, our reports quietly get worse.
 *   2. Gaps we WORK AROUND, asserted as still-present. When upstream closes
 *      one, the assertion INVERTS and tells us to delete our workaround — the
 *      alternative being that we carry it forever because nothing ever said
 *      otherwise. CLAUDE.md records that pattern removing a workaround once
 *      already (the pi-server import).
 *
 * Verified against inlet-sdk 0.1.2.
 */

const dist = (f: string): string =>
  fs.readFileSync(path.join("node_modules", "inlet-sdk", "dist", "crash", f), "utf8");

describe("§37 upstream behaviour we rely on — redaction", () => {
  // We pass `redaction: redactMessage`, which falls through to this for
  // anything not in our generated set. So this IS our policy for every message
  // we did not author, and 0.1.0 shipped an address and a path verbatim.
  it("keeps a known-safe engine shape", () => {
    expect(defaultRedaction("x.foo is not a function")).toBe("x.foo is not a function");
  });

  it("keeps an errno-shaped leading token and redacts the rest", () => {
    expect(defaultRedaction("ENOENT: no such file, open '/Users/alice/secret'")).toBe("ENOENT: <redacted>");
    expect(defaultRedaction("ERR_MODULE_NOT_FOUND cannot find /Users/me/x.js")).toBe("ERR_MODULE_NOT_FOUND <redacted>");
  });

  it("redacts an address or a path with NO leading token — the 0.1.0 leak", () => {
    expect(defaultRedaction("alice@corp.com is not a valid address")).toBe("<redacted>");
    expect(defaultRedaction("/Users/alice/secret.docx could not be opened")).toBe("<redacted>");
    expect(defaultRedaction("Request failed with token sk-abc123 for /Users/me")).toBe("<redacted>");
  });
});

/** A real Error from real named functions in a real file under the repo root. */
function innerWork(): never {
  throw new Error("sdk contract probe");
}
function middleWork(): never {
  return innerWork();
}
function outerWork(): never {
  return middleWork();
}
function thrown(): Error {
  try {
    outerWork();
  } catch (e) {
    return e as Error;
  }
  throw new Error("unreachable");
}

/** Captures through the REAL client, then drops the report instead of sending. */
async function capture(appRoots: string[]): Promise<CrashEnvelope> {
  let seen: CrashEnvelope | null = null;
  const client = new CrashClient({
    baseUrl: "http://127.0.0.1:1", // never reached — beforeSendSync drops it first
    publishableKey: "ipk_sdk_contract_test",
    crashDatabaseId: "cdb_sdk_contract_test",
    release: "0.0.0-test",
    store: new MemoryStore(),
    appRoots,
    dedupe: false,
    beforeSendSync: (e) => { seen = scrubEnvelope(e); return null; },
  });
  await client.captureException(thrown());
  expect(seen, "beforeSendSync must have run").not.toBeNull();
  return seen!;
}

describe("§37 upstream behaviour we rely on — frame attribution", () => {
  // The whole value of a crash report is "where did this happen", and every bit
  // of that is upstream's stack parser plus `appRoots`. We contribute nothing —
  // we do not even pass `appRoots`, we rely on the adapter's default. An SDK
  // bump that stopped attributing would degrade every frame to `<external>`
  // while reports kept arriving and kept grouping: useless, and silent.
  it("names the function, the file, the line and the column, in app", async () => {
    const e = await capture([process.cwd()]);
    const app = (e.exception?.frames ?? []).filter((f) => f.inApp);
    expect(app.length).toBeGreaterThanOrEqual(3);
    expect(app.slice(0, 3).map((f) => f.function)).toEqual(["innerWork", "middleWork", "outerWork"]);
    for (const f of app.slice(0, 3)) {
      expect(f.file).toBe(path.relative(process.cwd(), __filename));
      expect(f.line).toBeGreaterThan(0);
      expect(typeof f.col).toBe("number");
    }
  });

  it("the reported path is RELATIVE — an absolute one is the developer's machine", async () => {
    const blob = JSON.stringify(await capture([process.cwd()]));
    expect(blob).not.toContain(process.cwd());
    expect(blob).not.toContain("/Users/");
    expect(blob).not.toContain("/home/");
  });

  it("appRoots is what does it — with the wrong root, everything is <external>", async () => {
    // The non-vacuity guard: without it the two cases above would pass on an
    // SDK that marked every frame in-app regardless, proving nothing.
    const frames = (await capture([path.join(path.sep, "nowhere", "that", "exists")])).exception?.frames ?? [];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.inApp)).toBe(false);
  });

  it("the frame list stays bounded, so a runaway recursion cannot fill a report", async () => {
    expect(((await capture([process.cwd()])).exception?.frames ?? []).length).toBeLessThanOrEqual(50);
  });
});

describe("§37 gaps we work around — each INVERTS when upstream closes it", () => {
  it("still reports EVERY renderer exit, including a normal window close", () => {
    // `installElectronMain` hooks `render-process-gone` on `app` and captures
    // unconditionally — no `reason` check anywhere in the handler. That is why
    // `scrubEnvelope` drops `clean-exit`; without it every user files a crash
    // report every time they close a window.
    // WHEN THIS FAILS: upstream filters it. Drop the `clean-exit` arm.
    const src = dist("electron.js");
    const at = src.indexOf("const onRendererGone");
    const handler = src.slice(at, src.indexOf("const onChildGone", at));
    expect(handler, "non-vacuity: the handler must exist").toContain("renderer-gone");
    expect(handler).not.toContain("clean-exit");
  });

  it("still defaults the Electron renderer's appRoots to location.origin", () => {
    // Which under `file://` — every packaged Electron app — is the useless
    // string "file://", so every packaged renderer frame would be `<external>`.
    // That is the whole of `src/renderer/src/crashRoot.ts`.
    // WHEN THIS FAILS: upstream derives it. Delete crashRoot.ts and its test.
    const src = dist("electron-renderer.js");
    expect(src).toContain("location.origin");
    expect(src, "no pathname-derived default yet").not.toContain("location.pathname");
  });

  it("still declares `unclean-exit` as a kind with nothing producing it", () => {
    // The kind exists in the union and the label map; no adapter emits one, so
    // every integrator wanting it writes the same sentinel. That is
    // `src/main/crash/sentinel.ts`.
    // WHEN THIS FAILS: upstream ships a producer. Delete sentinel.ts.
    const src = dist("electron.js");
    expect(src, "the kind is declared").toContain('"unclean-exit"');
    expect(src, "but nothing captures one").not.toMatch(/kind:\s*["']unclean-exit["']/);
  });
});
