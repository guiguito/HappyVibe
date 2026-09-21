import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SENTINEL_NAME, readSentinel, removeSentinel, touchSentinel, writeSentinel } from "../src/main/crash/sentinel";

let dir = "";
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sentinel-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("§37 the unclean-exit sentinel", () => {
  it("a clean quit leaves nothing to find — the common case, and the cheap one", () => {
    writeSentinel(dir);
    removeSentinel(dir);
    expect(readSentinel(dir)).toBeNull();
  });

  it("a session that never came back is found, with its uptime", () => {
    const start = Date.now() - 125_000;
    writeSentinel(dir, start);
    touchSentinel(dir, start + 120_000);
    const found = readSentinel(dir);
    expect(found).not.toBeNull();
    expect(found!.lastUptimeMs).toBe(120_000);
  });

  it("touch moves the mtime but NEVER the start — or the uptime is zero every minute", () => {
    const start = Date.now() - 300_000;
    writeSentinel(dir, start);
    touchSentinel(dir, start + 60_000);
    touchSentinel(dir, start + 180_000);
    expect(readSentinel(dir)!.lastUptimeMs).toBe(180_000);
    expect(fs.readFileSync(path.join(dir, SENTINEL_NAME), "utf8")).toBe(String(start));
  });

  it("touching a sentinel that is not there is a no-op, not a crash", () => {
    expect(() => touchSentinel(dir)).not.toThrow();
    expect(readSentinel(dir)).toBeNull();
  });

  it("a corrupt file still reports the crash, just without the uptime", () => {
    // Dropping the report over a bad number would lose the FACT in order to
    // protect the detail. The crash happened either way.
    fs.writeFileSync(path.join(dir, SENTINEL_NAME), "not a number", "utf8");
    expect(readSentinel(dir)).toEqual({});
  });

  it("removing one that is not there does not throw", () => {
    expect(() => removeSentinel(dir)).not.toThrow();
  });
});
