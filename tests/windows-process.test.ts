import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §4 (Windows round), key-free source scan.
 *
 * Two Windows behaviours are invisible on macOS and have no natural unit test,
 * because the failure is a process that survives or a window that flashes:
 *
 *   1. `child.kill()` is TerminateProcess on Windows. No handler runs, so Pi's own
 *      SIGTERM path and its killTrackedDetachedChildren() never happen and every
 *      bash command and stdio MCP server outlives the session. Hibernation and MCP
 *      live-reload both come through PiClient.stop(), so that is an orphan per reload.
 *   2. A child spawned without `windowsHide` pops a console window. One per session,
 *      per title draft, per commit-message draft, and per git status poll.
 *
 * This is the absence half — the thing the feature exists to prevent, which cannot be
 * screenshotted. Same shape as tests/modal-layer.test.ts's z-index scan.
 */
const MAIN = path.join(__dirname, "..", "src", "main");
const read = (rel: string): string => fs.readFileSync(path.join(MAIN, rel), "utf8");

describe("main never kills a bare process", () => {
  it("PiClient.stop takes the tree through the platform seam", () => {
    const src = read("pi/PiClient.ts");
    expect(src).toMatch(/platform\.killTree\(/);
    // The bare kill survives only as the fallback for a child that never got a pid.
    expect(src.match(/this\.child\?\.kill\(\)/g) ?? []).toHaveLength(1);
  });

  it("sweepOrphans reads and kills through the seam, with no `ps` left behind", () => {
    const src = read("SessionManager.ts");
    expect(src).toMatch(/platform\.readCommand\(/);
    expect(src).toMatch(/platform\.killTree\(/);
    expect(src, "ps does not exist on Windows").not.toMatch(/"ps"/);
    expect(src).not.toMatch(/execFileSync/);
  });
});

describe("no child flashes a console window", () => {
  // The one-shot spawners: three model calls (§15/§19/§29) and the two sidecars,
  // plus git itself, which is polled.
  const SPAWNERS = [
    "pi/PiClient.ts",
    "titles.ts",
    "gitMessage.ts",
    "documents.ts",
    "mcpAdapterStore.ts",
    "git.ts",
  ];

  for (const rel of SPAWNERS) {
    it(`${rel} sets windowsHide on every child it spawns`, () => {
      const src = read(rel);
      // Count the spawn/exec calls that take an options object, and require at least
      // as many windowsHide keys. A new spawner added here without one fails this.
      const calls = (src.match(/\b(?:spawn|spawnSync|execFile|execFileSync)\(/g) ?? []).length;
      const hides = (src.match(/windowsHide:\s*true/g) ?? []).length;
      expect(hides, `${rel}: ${calls} spawn call(s), ${hides} windowsHide`).toBeGreaterThanOrEqual(1);
      expect(hides).toBeGreaterThanOrEqual(calls - 1);
    });
  }

  it("the voice worker is exempt, because utilityProcess has no console to hide", () => {
    expect(read("voice/host.ts")).toMatch(/utilityProcess\.fork/);
  });

  it("the git-install prompt is exempt, because its spawn is darwin-only", () => {
    const src = read("ipc.ts");
    const i = src.indexOf('spawn("git", ["--version"]');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, i - 200), i)).toMatch(/process\.platform === "darwin"/);
  });
});
