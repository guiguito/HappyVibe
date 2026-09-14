import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §4 (Windows round): the Windows CI job must be able to FAIL the run.
 *
 * It shipped as `continue-on-error: true` — advisory, so the first red list came from a
 * real runner instead of a grep. That flag then did exactly what it says: the Windows
 * job failed on an 8.3 short-name path bug, and the run still reported success, so the
 * PR showed a green tick over a red `npm test`. Neither developer machine could
 * reproduce the bug (both user names are short enough that Windows generates no 8.3
 * name), which is precisely the case a required job exists to cover.
 *
 * This repository's plan has no branch protection, so the flag IS the gate — there is
 * no required-checks list to configure alongside it, and equally nothing else to stop
 * it being re-added.
 */
const CI = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");

/**
 * The block of `ci.yml` belonging to one job, up to the next top-level job key.
 *
 * Comments are stripped first, and that is not tidiness: the comment explaining why
 * the flag is gone NAMES it, and a comment between two jobs belongs to neither — it
 * would otherwise read as the previous job still carrying the flag.
 */
function jobBlock(name: string): string {
  const yaml = CI.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const start = yaml.indexOf(`\n  ${name}:`);
  expect(start, `job ${name} not found in ci.yml`).toBeGreaterThan(-1);
  const rest = yaml.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the Windows CI job gates", () => {
  it("exists and runs on windows", () => {
    expect(jobBlock("test-windows")).toMatch(/runs-on:\s*windows-latest/);
  });

  it("does NOT continue on error — that flag hid a red job once already", () => {
    expect(jobBlock("test-windows")).not.toMatch(/continue-on-error/);
  });

  it("runs both halves of the gate, not just the suite", () => {
    const block = jobBlock("test-windows");
    expect(block).toMatch(/run:\s*npm test/);
    expect(block).toMatch(/run:\s*npm run build/);
    // Both trees install, or pi-runtime is missing and every Pi-spawning test skips.
    expect(block).toMatch(/npm ci/);
    expect(block).toMatch(/cd pi-runtime && npm ci/);
  });

  it("and the macOS job still gates too", () => {
    const block = jobBlock("test");
    expect(block).toMatch(/runs-on:\s*macos-latest/);
    expect(block).not.toMatch(/continue-on-error/);
  });
});
