/**
 * docs-round #10 — the last crash report that LEFT the machine is kept beside the SDK's
 * store, so the Privacy page can still show it after a restart. The helpers live in the
 * electron-free seam (client.ts) so this runs under vitest; the wiring is a source scan.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAST_REPORT_FILE, readLastReport, writeLastReport } from "../src/main/crash/client";

const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");

describe("the last crash report survives a restart", () => {
  it("round-trips the envelope exactly as it was sent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lastreport-"));
    const env = { kind: "exception", exception: { type: "Error", message: "<redacted>", handled: false, frames: [] }, tags: { channel: "dev" } };
    writeLastReport(dir, env as never);
    expect(readLastReport(dir)).toEqual(env);
  });

  it("a missing or unreadable file reads as nothing sent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lastreport-none-"));
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

  it("lastSent stays in memory — App's launch notice keys on it", () => {
    expect(crash).toMatch(/^\s+lastSent,$/m);
    expect(crash).not.toMatch(/lastSent\s*[:=][^\n]*readLastReport/);
  });
});
