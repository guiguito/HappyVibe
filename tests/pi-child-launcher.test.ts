import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PI_CLI_RELPATH, resolvePiSpawn } from "../src/main/pi/spawn";
import { makePlatform, type PlatformDeps } from "../src/main/platform";

/**
 * PRD §12 on Windows, key-free.
 *
 * The child guard's ONLY injection point is the launcher named by
 * PI_SUBAGENT_PI_BINARY — a capability ceiling's `denyExtensions` cannot strip it
 * because pi-args has finished building argv by then. pi-node.sh is a POSIX script,
 * so Windows needs its own launcher, and it is a plain .mjs because pi-subagents
 * itself runs a `.mjs` PI_SUBAGENT_PI_BINARY as `process.execPath <script> …args`
 * (that upstream branch is pinned in pi-subagents-contract.test.ts).
 */
const ROOT = path.join(__dirname, "..");
const RUNTIME = path.join(ROOT, "pi-runtime");
const src = fs.readFileSync(path.join(RUNTIME, "bin", "pi-child.mjs"), "utf8");

function fakePlatform(over: Partial<PlatformDeps>) {
  return makePlatform({
    platform: "darwin",
    execPath: "/x",
    env: {},
    existsSync: () => false,
    exec: () => ({ status: 0, stdout: "" }),
    ...over,
  });
}

describe("pi-child.mjs", () => {
  it("runs the SAME entry as the parent and the .sh launcher", () => {
    expect(src).toContain(PI_CLI_RELPATH);
    expect(src, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });

  it("injects the child guard BEFORE the forwarded argv", () => {
    // pi-args puts the task LAST as a positional; a flag after a positional may or
    // may not be parsed, and that is not a bet to take with the permission gate.
    const guardIdx = src.indexOf('"--extension"');
    const forwardIdx = src.indexOf("process.argv.slice(2)");
    expect(guardIdx).toBeGreaterThan(0);
    expect(forwardIdx).toBeGreaterThan(guardIdx);
    expect(src).toMatch(/hv-child-guard\.ts/);
  });

  it("resolves the runtime from its own location, never from cwd", () => {
    // A child's cwd is the WORKSPACE, so a cwd-relative runtime path would look
    // correct in dev and resolve to the user's project in the packaged app.
    expect(src).toContain("import.meta.url");
    expect(src).not.toMatch(/process\.cwd\(\)/);
  });

  it("has a .mjs extension, which is the whole mechanism", () => {
    // isNodeScriptPath is /\.(?:mjs|cjs|js)$/i — rename this file to .sh or .bat and
    // pi-subagents spawns it directly, which Windows cannot do.
    expect(fs.existsSync(path.join(RUNTIME, "bin", "pi-child.mjs"))).toBe(true);
  });
});

describe("spawn points PI_SUBAGENT_PI_BINARY at the platform's launcher", () => {
  it("the .mjs on a win32 platform", () => {
    const win = fakePlatform({ platform: "win32", execPath: "C:\\HV\\HappyVibe.exe" });
    const s = resolvePiSpawn("C:\\ws", "C:\\sessions", "C:\\HV\\resources\\pi-runtime", {}, win);
    expect(s.env.PI_SUBAGENT_PI_BINARY).toMatch(/[\\/]bin[\\/]pi-child\.mjs$/);
  });

  it("the .sh on darwin and linux", () => {
    // Separator-agnostic on purpose: spawn.ts joins with node:path, which uses the
    // HOST separator — so this assertion runs identically whether the suite is
    // executing on macOS or on the Windows box simulating darwin.
    for (const platform of ["darwin", "linux"] as const) {
      const s = resolvePiSpawn("/ws", "/sessions", "/rt", {}, fakePlatform({ platform }));
      expect(s.env.PI_SUBAGENT_PI_BINARY, platform).toMatch(/[\\/]bin[\\/]pi-node\.sh$/);
    }
  });

  it("the child launcher lives under the RUNTIME dir it was given", () => {
    // Packaged, that is <resources>/pi-runtime — not the repo the app was built in.
    const win = fakePlatform({ platform: "win32", execPath: "C:\\HV\\HappyVibe.exe" });
    const s = resolvePiSpawn("C:\\ws", "C:\\sessions", "C:\\HV\\resources\\pi-runtime", {}, win);
    expect(s.env.PI_SUBAGENT_PI_BINARY?.startsWith("C:\\HV\\resources\\pi-runtime")).toBe(true);
  });
});

describe("the launcher survives Windows' ESM loader", () => {
  it("imports the CLI as a file:// URL, never as a bare absolute path", () => {
    // Node's ESM loader refuses an absolute Windows path outright:
    //   "absolute paths must be valid file:// URLs. Received protocol 'c:'"
    // A bare import(CLI) therefore fails EVERY delegation on the one platform this
    // file exists for — and the same bug was live in the anydoc sidecar, where its
    // catch reported it as "no anydoc build for this platform".
    expect(src).toMatch(/await import\(\s*pathToFileURL\(/);
    expect(src).toMatch(/pathToFileURL/);
    expect(src, "a bare import(CLI) is the bug").not.toMatch(/await import\(CLI\)/);
  });
});
