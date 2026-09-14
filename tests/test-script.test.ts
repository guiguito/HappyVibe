import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `npm test` IS the non-live suite (CLAUDE.md §Tests): both provider keys are
 * neutralised to `sk-REPLACE`, which tests/liveModel.ts treats as ABSENT, and whose
 * .env loader only fills UNSET vars — so the shell value wins and every live file
 * skips itself.
 *
 * That guarantee used to live in an inline `VAR=… vitest run` in package.json, which
 * no Windows shell can run. Measured on this machine before the fix:
 *
 *   'DEEPSEEK_API_KEY' is not recognized as an internal or external command
 *
 * So it moved into scripts/test.mjs. What this test pins is the part that would
 * fail SILENTLY rather than loudly: that BOTH vars are still set there. Setting only
 * one means the day a key for the other provider lands in .env, `npm test` quietly
 * stops being the non-live suite — 25-40 s becomes ~6 min and starts spending money,
 * with nothing in the output saying so.
 */
const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const script = fs.readFileSync(path.join(ROOT, "scripts", "test.mjs"), "utf8");

describe("npm test is portable", () => {
  it("routes through scripts/test.mjs, with no inline env assignment", () => {
    expect(pkg.scripts.test).toBe("node scripts/test.mjs");
    expect(pkg.scripts.test).not.toContain("=");
  });

  it("gate still runs build then the suite", () => {
    expect(pkg.scripts.gate).toBe("npm run build && npm test");
  });
});

describe("npm test is still key-free", () => {
  it("neutralises BOTH provider keys", () => {
    expect(script).toMatch(/DEEPSEEK_API_KEY:\s*"sk-REPLACE"/);
    expect(script).toMatch(/OPENROUTER_API_KEY:\s*"sk-REPLACE"/);
  });

  it("forwards extra arguments, so `npm test -- <file>` still narrows the run", () => {
    expect(script).toContain("process.argv.slice(2)");
  });

  it("propagates vitest's exit code, rather than always succeeding", () => {
    expect(script).toMatch(/process\.exit\(/);
  });
});
