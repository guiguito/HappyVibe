import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CrashClient, MemoryStore, defaultRedaction } from "inlet-sdk/crash";
import { installElectronMain } from "inlet-sdk/crash/electron";
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
 * Verified against inlet-sdk 0.1.3.
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

describe("§37 exit reasons — upstream's defaults ARE our rule (0.1.3)", () => {
  // These three cases replace source scans that asserted the gap was still
  // open. One of them gave a FALSE PASS on the 0.1.3 bump: the fix landed as
  // `ignoredRenderer.includes(details.reason)` with the literal `"clean-exit"`
  // moved out to a module const, so `not.toContain("clean-exit")` on the
  // handler body still passed while the behaviour had changed underneath.
  // Hence behaviour, not text — upstream accepts a fake `electron` for exactly
  // this (`deps: { electron }`, which is how its own tests drive it).
  //
  // What they protect: we deleted our own filter because 0.1.3's defaults are
  // `['clean-exit']` for a renderer and `['clean-exit', 'killed']` for a child
  // — the split §14.1 cost a GUI round to get right. If a bump changes either,
  // we either file a report on every window close or silently drop every OOM
  // kill, and nothing else in the suite would notice.
  let teardown: (() => void) | null = null;
  afterEach(() => { teardown?.(); teardown = null; });

  async function emitted(event: string, details: Record<string, unknown>): Promise<CrashEnvelope[]> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sdk-contract-"));
    const handlers = new Map<string, Array<(...a: never[]) => void>>();
    const seen: CrashEnvelope[] = [];
    const electron = {
      app: {
        getPath: () => dir,
        getVersion: () => "0.0.0-test",
        getAppPath: () => process.cwd(),
        isPackaged: false, // keeps the sentinel disarmed; we are not testing it here
        on: (ev: string, fn: (...a: never[]) => void) => {
          handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
        },
        off: () => {},
      },
      ipcMain: { on: () => {}, off: () => {} },
    } as never;

    const installed = await installElectronMain(
      {
        baseUrl: "http://127.0.0.1:1",
        publishableKey: "ipk_sdk_contract_test",
        crashDatabaseId: "cdb_sdk_contract_test",
        store: new MemoryStore(),
        queueDir: dir,
        dedupe: false,
        beforeSendSync: (e) => { seen.push(e); return null; },
      },
      { exitCode: false },
      { electron },
    );
    teardown = () => {
      installed.uninstall();
      fs.rmSync(dir, { recursive: true, force: true });
    };
    // Electron's own arities differ and getting this wrong is silent:
    // `render-process-gone` is (event, webContents, details) while
    // `child-process-gone` is (event, details). Passed three args for the
    // latter, `details` arrives as `{}`, the reason is undefined, nothing
    // matches the ignore list and the report goes out — which reads exactly
    // like "upstream stopped filtering".
    const args = event === "render-process-gone" ? [{}, {}, details] : [{}, details];
    for (const fn of handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
    // `captureReport` is fired with `void`, so let its microtasks settle.
    await new Promise((r) => setTimeout(r, 50));
    return seen;
  }

  it("a normal window close is NOT reported", async () => {
    // The single highest-volume noise source there is: without this default,
    // every user files a crash report every time they close a window.
    expect(await emitted("render-process-gone", { reason: "clean-exit", exitCode: 0 })).toHaveLength(0);
  });

  it("a KILLED renderer IS reported — that is an OOM kill", async () => {
    // The §14.1 bug, now upstream's invariant. A renderer is never killed on
    // purpose by this app, so `killed` there is the OS reclaiming memory.
    const seen = await emitted("render-process-gone", { reason: "killed", exitCode: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe("renderer-gone");
    expect(seen[0].exit?.reason).toBe("killed");
  });

  it("a killed CHILD is NOT reported — that one we asked for", async () => {
    // The voice host calls `kill()` itself; `clean-exit` likewise.
    expect(await emitted("child-process-gone", { reason: "killed", exitCode: 0 })).toHaveLength(0);
    expect(await emitted("child-process-gone", { reason: "clean-exit", exitCode: 0 })).toHaveLength(0);
  });

  it("a crashed child IS reported", async () => {
    // Non-vacuity: without this the three above would pass on an adapter that
    // reported nothing at all.
    const seen = await emitted("child-process-gone", { reason: "crashed", exitCode: 1, name: "utility" });
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe("child-exit");
  });
});

describe("§37 unclean-exit has a producer now (0.1.3)", () => {
  it("the kind is reachable from a capture, not just declared", () => {
    // Inverse of the pin this replaces. Until 0.1.3 `unclean-exit` was in the
    // kind union and the label map with nothing emitting it, which is why we
    // carried `sentinel.ts`. That file is deleted; `uncleanExit: true` replaces
    // it, and upstream arms it only in a packaged build exactly as ours did.
    const src = dist("electron.js");
    expect(src).toMatch(/kind:\s*["']unclean-exit["']/);
    expect(src, "and it stays packaged-only").toContain("isPackaged");
  });
});

describe("§37 the gap 0.1.3 did NOT close — INVERTS when it does", () => {
  it("createErrorBoundary still needs appRoots the SDK will not hand us", () => {
    // 16.2 is only half closed. `installElectronRenderer` derives its roots per
    // protocol now, so it is given none — but `createErrorBoundary` takes its
    // OWN `appRoots`, defaulting to `[]`, and with no roots `markFrames` sends
    // every frame carrying a file to `<external>`. The derivation is
    // module-private (`defaultAppRoots`) and `RendererCapture.appRoots` is
    // private, so there is nothing to reuse.
    //
    // WHEN THIS FAILS: upstream exported it or defaulted the boundary. Delete
    // `src/renderer/src/crashRoot.ts`, its test, and the `appRoots` argument in
    // `src/renderer/src/main.tsx`.
    const renderer = dist("electron-renderer.js");
    expect(renderer, "non-vacuity: the derivation exists").toContain("defaultAppRoots");
    expect(renderer, "but is not exported").not.toMatch(/export\s*\{[^}]*defaultAppRoots/);
    expect(dist("react.js"), "and the boundary still defaults to no roots").toContain("appRoots = []");
  });
});
