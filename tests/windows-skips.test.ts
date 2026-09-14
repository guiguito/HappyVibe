import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §4 (Windows round): a skip is a DECISION, and this file is where the decision
 * is written down. Key-free.
 *
 * The rule the sweep followed: make the test portable when the CODE under test is
 * portable, and skip only where the platform genuinely cannot host the case. Applying
 * it took the Windows suite from 59 failures to 0 while adding eleven skips, not
 * fifty — most reds were real bugs or POSIX-shaped fixtures, and each one that turned
 * out to be neither is listed below with the reason it is neither.
 *
 * Two kinds, and the difference matters:
 *
 *   CAPABILITY skips (`!CAN_SYMLINK`, `!CAN_DENY_READ`) — the behaviour is identical
 *   on every platform and only the FIXTURE cannot be built. A Windows box with
 *   Developer Mode on still runs the symlink ones, which a platform skip would have
 *   given up for free.
 *
 *   PLATFORM skips (`process.platform === "win32"`) — the behaviour itself does not
 *   exist there: a POSIX exec bit, a login shell's `-ilc` PATH, a `sh -c` command.
 *
 * Deliberately NOT a skip, and the distinction is the point: the foreground-process
 * tests assert BOTH arms instead. Windows cannot name a pty's foreground command, and
 * the thing that must never happen there is a non-null answer — so that contract is
 * asserted rather than left uncovered.
 *
 * Same shape as `live:why`: the list is derived from the files, so a new skip has to
 * be added here, with a reason, or this goes red.
 */
const DIR = __dirname;
// Matches a skipIf gate OR an inline capability guard — model-exclusions branches
// with `if (CAN_DENY_READ)` around one arm rather than skipping the whole case.
const SKIP_RE = /\.skipIf\(\s*(?:!?CAN_SYMLINK|process\.platform === "win32")|CAN_DENY_READ|!CAN_SYMLINK/;

/** file → why it cannot run on Windows (capability or platform). */
const EXPECTED: Record<string, string> = {
  "child-write-confine.test.ts": "planting a symlink needs elevation",
  "skills-delete.test.ts": "planting a symlink needs elevation",
  "prompt-templates-delete.test.ts": "planting a symlink needs elevation",
  "snapshots.test.ts": "planting a symlink needs elevation",
  "model-exclusions.test.ts": "chmod cannot deny an owner a read on NTFS",
  "terminals.test.ts": "the POSIX exec bit; conpty ships no spawn-helper",
  "shell-path.test.ts": "the login-shell PATH trick is `$SHELL -ilc`",
  "mcp-adapter-interpolation.test.ts": "the '!' secret form runs a POSIX shell command",
};

function filesWithSkips(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".test.ts"))
    // This file NAMES every gate, so it always matches its own detector.
    .filter((f) => f !== "windows-skips.test.ts")
    .filter((f) => SKIP_RE.test(fs.readFileSync(path.join(DIR, f), "utf8")))
    .sort();
}

describe("the Windows skip list is pinned", () => {
  it("every file that skips for the platform is listed, with a reason", () => {
    // Note model-exclusions guards with `if (CAN_DENY_READ)` inline rather than
    // skipIf, so it is matched by the same constant appearing in the file.
    const found = filesWithSkips();
    const listed = Object.keys(EXPECTED).sort();
    expect(found.filter((f) => !listed.includes(f)), "new skip — add it to EXPECTED with a reason").toEqual([]);
  });

  it("and nothing is listed that no longer skips", () => {
    const found = filesWithSkips();
    const stale = Object.keys(EXPECTED).filter((f) => !found.includes(f));
    expect(stale, "listed but no longer skipping — delete the entry").toEqual([]);
  });

  it("stays small — a growing list means the sweep stopped fixing and started skipping", () => {
    expect(Object.keys(EXPECTED).length).toBeLessThanOrEqual(12);
  });
});

describe("the foreground contract is asserted, not skipped", () => {
  it("agent-terminals covers BOTH arms of the platform's ability to name a foreground", () => {
    const src = fs.readFileSync(path.join(DIR, "agent-terminals.test.ts"), "utf8");
    // One arm per platform: refusal where a foreground can be named, and an explicit
    // "reads as idle, reuse ALLOWED" where it cannot. Neither is a skipIf(win32).
    expect(src).toMatch(/skipIf\(!FOREGROUND\)/);
    expect(src).toMatch(/skipIf\(FOREGROUND\)/);
  });
});
