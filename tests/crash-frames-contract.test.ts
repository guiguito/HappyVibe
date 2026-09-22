import { describe, expect, it } from "vitest";
import path from "node:path";
import { CrashClient, MemoryStore } from "inlet-sdk/crash";
import type { CrashEnvelope } from "inlet-sdk/crash";
import { scrubEnvelope } from "../src/main/crash/policy";

/**
 * §37 — the frames contract, and the ONE thing that makes frames worth having.
 *
 * A crash report's whole value is "where did this happen". That rests on
 * `appRoots`, which the Electron adapter defaults to `app.getAppPath()` and
 * which `crash-wiring.test.ts` forbids us to override — but nothing pinned what
 * the default BUYS. An SDK bump whose stack parser stopped attributing, or an
 * `appRoots` that no longer matches where the code lives, would degrade every
 * frame to `<external>` and nothing would fail: reports would keep arriving,
 * keep grouping, and be useless.
 *
 * Key-free, network-free and Electron-free on purpose, so it runs in CI where
 * the live test cannot. A full end-to-end through a real Electron launch was
 * weighed and refused: CI has no key, the SDK dedupes 24 h per fingerprint so a
 * second run in a day sends nothing, and every run writes rows a publishable
 * key cannot delete. `scripts/crash-probe.mjs` covers that ground manually.
 */

/** A real Error from real named functions in a real file under the repo root. */
function innerWork(): never {
  throw new Error("frames contract probe");
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
    publishableKey: "ipk_frames_contract_test",
    crashDatabaseId: "cdb_frames_contract_test",
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

describe("§37 frames are attributed to our own code", () => {
  it("names the function, the file, the line and the column, in app", async () => {
    const e = await capture([process.cwd()]);
    const frames = e.exception?.frames ?? [];
    const app = frames.filter((f) => f.inApp);
    expect(app.length, "at least the three named frames").toBeGreaterThanOrEqual(3);

    // The stack is innermost-first, and the names are what let a group be read
    // as "innerWork threw" rather than as an anonymous address.
    expect(app.slice(0, 3).map((f) => f.function)).toEqual(["innerWork", "middleWork", "outerWork"]);
    for (const f of app.slice(0, 3)) {
      expect(f.file).toBe(path.relative(process.cwd(), __filename));
      expect(f.line, "a line number, not zero").toBeGreaterThan(0);
      expect(typeof f.col).toBe("number");
    }
  });

  it("the reported path is RELATIVE — an absolute one is the developer's machine", async () => {
    const e = await capture([process.cwd()]);
    const blob = JSON.stringify(e);
    // This is the promise §37 makes about frames, asserted on the whole
    // envelope rather than on one field, so a future field cannot leak it.
    expect(blob).not.toContain(process.cwd());
    expect(blob).not.toContain("/Users/");
    expect(blob).not.toContain("/home/");
  });

  it("appRoots is what does it — with the wrong root, everything is <external>", async () => {
    // The non-vacuity guard: without this, the assertions above would still
    // pass on an SDK that marked every frame in-app regardless, and the test
    // would be proving nothing about the option we deliberately never override.
    const e = await capture([path.join(path.sep, "nowhere", "that", "exists")]);
    const frames = e.exception?.frames ?? [];
    expect(frames.length, "frames are still produced").toBeGreaterThan(0);
    expect(frames.some((f) => f.inApp), "but none should be in-app").toBe(false);
    expect(frames.every((f) => f.file === "<external>" || f.file === undefined)).toBe(true);
  });

  it("a frame count stays bounded, so one runaway recursion cannot fill a report", async () => {
    const e = await capture([process.cwd()]);
    expect((e.exception?.frames ?? []).length).toBeLessThanOrEqual(50);
  });
});
