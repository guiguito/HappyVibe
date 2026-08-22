import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { childSessionFiles } from "../src/main/store";

/** Upstream's layout: <sessionsDir>/<parentBasename>/<runId>/run-<idx>/session.jsonl */
function fixture(): { dir: string; parent: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
  const parent = path.join(dir, "abc123.jsonl");
  fs.writeFileSync(parent, "");
  for (const [run, idx] of [
    ["run-a", 0],
    ["run-a", 1],
    ["run-b", 0],
  ] as const) {
    const d = path.join(dir, "abc123", run, `run-${idx}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "session.jsonl"), "");
  }
  return { dir, parent };
}

describe("childSessionFiles", () => {
  test("finds every child of every run, tagged with its run id", () => {
    const { dir, parent } = fixture();
    const found = childSessionFiles(dir, parent);
    expect(found).toHaveLength(3);
    expect(found.filter((f) => f.runId === "run-a")).toHaveLength(2);
    expect(found.every((f) => f.file.endsWith("session.jsonl"))).toBe(true);
  });

  test("narrows to one run when asked", () => {
    const { dir, parent } = fixture();
    const found = childSessionFiles(dir, parent, "run-b");
    expect(found).toHaveLength(1);
    expect(found[0].runId).toBe("run-b");
  });

  test("empty for a session that never delegated", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
    const parent = path.join(dir, "solo.jsonl");
    fs.writeFileSync(parent, "");
    expect(childSessionFiles(dir, parent)).toEqual([]);
  });

  test("empty for a run id that does not exist", () => {
    const { dir, parent } = fixture();
    expect(childSessionFiles(dir, parent, "run-nope")).toEqual([]);
  });

  // Same confinement as readSessionFile: piSessionFile is Pi-reported and so is
  // untrusted input — a read must never escape the session dir.
  test("refuses a parent outside the session dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));
    expect(childSessionFiles(dir, "/etc/passwd")).toEqual([]);
    expect(childSessionFiles(dir, undefined)).toEqual([]);
  });

  // A step directory with no session.jsonl yet is a child that has not had its
  // first turn — not an error, and not a row.
  test("skips a step directory with no session file yet", () => {
    const { dir, parent } = fixture();
    fs.mkdirSync(path.join(dir, "abc123", "run-c", "run-0"), { recursive: true });
    expect(childSessionFiles(dir, parent)).toHaveLength(3);
  });
});
