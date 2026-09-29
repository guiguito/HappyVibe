/**
 * docs-round #10 — the last crash report that LEFT the machine is kept beside the SDK's
 * store, so the Privacy page can still show it after a restart. The helpers live in the
 * electron-free seam (client.ts) so this runs under vitest; the wiring is a source scan.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAST_REPORT_FILE, clearLastReport, readLastReport, writeLastReport } from "../src/main/crash/client";

const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");
const usage = fs.readFileSync("src/main/usage/index.ts", "utf8");
const privacyGuide = fs.readFileSync("docs/guide/src/content/docs/privacy.md", "utf8");
const howItWorks = fs.readFileSync("src/renderer/src/components/HowItWorks.tsx", "utf8");

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lastreport-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("the last crash report survives a restart", () => {
  it("round-trips the envelope exactly as it was sent", () => {
    const dir = tmp();
    const env = { kind: "exception", sessionId: "s-1", exception: { type: "Error", message: "<redacted>", handled: false, frames: [] }, tags: { channel: "dev" } };
    writeLastReport(dir, env as never);
    expect(readLastReport(dir)).toEqual(env);
  });

  it("a missing or unreadable file reads as nothing sent", () => {
    const dir = tmp();
    expect(readLastReport(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, LAST_REPORT_FILE), "{not json");
    expect(readLastReport(dir)).toBeNull();
  });

  it("never collides with the SDK's own store files", () => {
    expect(["queue.json", "dedupe.json", "running.json"]).not.toContain(LAST_REPORT_FILE);
  });

  it("onSent writes it, and crashInfo falls back to it", () => {
    const sent = crash.slice(crash.indexOf("const onSent ="), crash.indexOf("const onDrop ="));
    expect(sent).toMatch(/writeLastReport\(queueDir, envelope\);/);
    expect(crash).toMatch(/lastReport: recent\.at\(-1\) \?\? \(queueDir \? readLastReport\(queueDir\) : null\),/);
  });

  it("valid JSON of the wrong shape reads as nothing sent", () => {
    const dir = tmp();
    for (const bad of ["[]", '"x"', "{}", '{"kind":1}', "null", "7"]) {
      fs.writeFileSync(path.join(dir, LAST_REPORT_FILE), bad);
      expect(readLastReport(dir), bad).toBeNull();
    }
  });

  it("a write is atomic: no temp file is left behind, and the second write replaces the first", () => {
    const dir = tmp();
    writeLastReport(dir, { kind: "exception", eventId: "one" } as never);
    writeLastReport(dir, { kind: "message", eventId: "two" } as never);
    expect(readLastReport(dir)).toEqual({ kind: "message", eventId: "two" });
    expect(fs.readdirSync(dir)).toEqual([LAST_REPORT_FILE]);
  });

  it("a failed write leaves the previous good copy in place", () => {
    const dir = tmp();
    writeLastReport(dir, { kind: "exception", eventId: "good" } as never);
    // BigInt cannot be stringified: the write throws before it touches the target.
    writeLastReport(dir, { kind: "message", big: 1n } as never);
    expect(readLastReport(dir)).toEqual({ kind: "exception", eventId: "good" });
    expect(fs.readdirSync(dir)).toEqual([LAST_REPORT_FILE]);
  });

  it("clearLastReport removes the copy, and is a no-op when there is none", () => {
    const dir = tmp();
    writeLastReport(dir, { kind: "exception" } as never);
    fs.writeFileSync(path.join(dir, `${LAST_REPORT_FILE}.tmp`), "{");
    fs.writeFileSync(path.join(dir, "queue.json"), "[]");
    clearLastReport(dir);
    expect(readLastReport(dir)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual(["queue.json"]); // the SDK's own files are not ours to touch
    expect(() => clearLastReport(dir)).not.toThrow();
    expect(() => clearLastReport(path.join(dir, "missing"))).not.toThrow();
  });

  it("crash reports OFF forgets the copy, memory and file, before the SDK is told", () => {
    const fn = crash.slice(crash.indexOf("export function forgetLastCrashReport"), crash.indexOf("export async function setCrashEnabled"));
    expect(fn).toMatch(/recent\.length = 0;/);
    expect(fn).toMatch(/if \(queueDir\) clearLastReport\(queueDir\);/);
    const off = crash.slice(crash.indexOf("export async function setCrashEnabled"));
    const at = off.indexOf("if (!on) forgetLastCrashReport();");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(off.indexOf("setEnabled(on, { dropQueue: !on })"));
  });

  it("usage statistics OFF forgets the copy too, through crash/index (not ipc.ts)", () => {
    expect(usage).toMatch(/import \{ forgetLastCrashReport \} from "\.\.\/crash";/);
    const handler = usage.slice(usage.indexOf('"hv:set-usage-stats"'));
    const forget = handler.indexOf("if (!on) forgetLastCrashReport();");
    expect(forget).toBeGreaterThan(-1);
    expect(forget).toBeLessThan(handler.indexOf("setEnabled?.("));
    expect(fs.readFileSync("src/main/ipc.ts", "utf8")).not.toMatch(/forgetLastCrashReport|from ["']\.\/crash["']/);
  });

  it("the copy no longer claims the random ID is kept only in memory", () => {
    for (const [name, text] of [["privacy.md", privacyGuide], ["HowItWorks.tsx", howItWorks]] as const) {
      expect(text, name).not.toContain("kept only in memory");
      expect(text, name).toContain("ID included, is also kept on this computer");
      expect(text, name).toMatch(/usage statistics deletes that copy|Send anonymous usage statistics\*\* deletes that copy/);
    }
  });

  it("lastSent stays in memory — App's launch notice keys on it", () => {
    expect(crash).toMatch(/^\s+lastSent,$/m);
    expect(crash).not.toMatch(/lastSent\s*[:=][^\n]*readLastReport/);
  });
});
