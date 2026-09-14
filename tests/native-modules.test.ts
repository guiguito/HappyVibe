import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * CONTRACT TEST — key-free. Windows round, 2026-09-14.
 *
 * HappyVibe never rebuilds a native module, and that is a decision with evidence
 * rather than an omission. Both native deps ship binaries for every platform we
 * target: node-pty 1.1.0 is N-API (`prebuilds/<platform>-<arch>/`, ABI-stable across
 * Node AND Electron — see tests/terminals.test.ts) and sherpa-onnx-node resolves a
 * per-platform sibling package (`sherpa-onnx-win-x64`, `sherpa-onnx-darwin-arm64`, …)
 * that is downloaded prebuilt, never compiled.
 *
 * `electron-builder install-app-deps` did not know that. It ran from `postinstall`,
 * asked @electron/rebuild to "prepare" node-pty, and on Windows that is:
 *
 *   ⨯ Error: Could not find any Visual Studio installation to use
 *
 * — so `npm ci` failed outright on a clean Windows machine and `pi-runtime` never
 * installed. Requiring a multi-gigabyte C++ toolchain to run the tests contradicts
 * §3's self-sufficiency posture one directory over, and it bought nothing: the
 * probe below is exactly what the rebuild would have been insuring, and it passes
 * without it. `npmRebuild: false` in electron-builder.yml is the same decision on
 * the packaging side, where the identical failure would otherwise land.
 *
 * If a future native dependency arrives WITHOUT prebuilds, this test is where that
 * shows up — it will still load here (built locally by its own install script) but
 * the packaged app will not have it, so add the platform's prebuilt package rather
 * than turning the rebuild back on.
 */

const ROOT = path.join(__dirname, "..");
const require_ = createRequire(path.join(ROOT, "package.json"));

describe("the native modules load with no build step", () => {
  it("node-pty resolves and exposes spawn", () => {
    const pty = require_("node-pty") as { spawn: unknown };
    expect(typeof pty.spawn).toBe("function");
  });

  it("sherpa-onnx-node resolves and exposes a recogniser", () => {
    const sherpa = require_("sherpa-onnx-node") as Record<string, unknown>;
    expect(typeof sherpa.OfflineRecognizer).toBe("function");
  });

  it("node-pty ships a prebuild for THIS platform, rather than a local build", () => {
    const lib = path.dirname(require_.resolve("node-pty"));
    const prebuilds = path.join(lib, "..", "prebuilds");
    const mine = `${process.platform}-${process.arch}`;
    expect(fs.readdirSync(prebuilds), `no prebuild for ${mine}`).toContain(mine);
  });
});

describe("nothing asks for a compiler", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("postinstall does not run install-app-deps", () => {
    expect(pkg.scripts.postinstall).not.toContain("install-app-deps");
  });

  it("postinstall still does the two things that ARE needed", () => {
    // The pty helper's executable bit (npm drops it) and the esbuild bundle main's
    // keychain sidecar runs — both real, both platform-aware on their own.
    expect(pkg.scripts.postinstall).toContain("fix-pty-helper");
    expect(pkg.scripts.postinstall).toContain("build-mcp-oauth-bridge");
  });

  it("electron-builder is told not to rebuild at pack time either", () => {
    const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
    expect(yml).toMatch(/^npmRebuild:\s*false\s*$/m);
  });
});
