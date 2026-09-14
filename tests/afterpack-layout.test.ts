import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain ESM, no type declarations
import {
  fitsWindowsPathLimit,
  longestRelativePath,
  runtimeDest,
  WIN_INSTALL_PREFIX_BUDGET,
  WIN_PATH_LIMIT,
} from "../build/afterPackLayout.mjs";

/**
 * PRD §4 (Windows round), key-free.
 *
 * afterPack hardcoded `${productName}.app` for the app's whole life, and only the
 * RE-SIGN step was guarded by the platform. So a Windows build cheerfully created
 * `release/win-unpacked/HappyVibe.app/Contents/Resources/…` — a folder nothing loads
 * — and shipped a pi-runtime with no node_modules: the build went green and the
 * installed app could not spawn Pi at all.
 *
 * This runs on macOS too, which is the point: the Windows layout is asserted without
 * a Windows machine, the same way the platform seam is.
 */
const ctx = (electronPlatformName: string, appOutDir: string) => ({
  appOutDir,
  electronPlatformName,
  packager: { appInfo: { productName: "HappyVibe" } },
});

describe("runtimeDest", () => {
  it("darwin: inside the bundle, where process.resourcesPath points", () => {
    expect(runtimeDest(ctx("darwin", "/out/mac-arm64"))).toBe(
      path.join("/out/mac-arm64", "HappyVibe.app", "Contents", "Resources", "pi-runtime", "node_modules"),
    );
  });

  it("win32 and linux: flat under <appOutDir>/resources", () => {
    expect(runtimeDest(ctx("win32", "/out/win-unpacked"))).toBe(
      path.join("/out/win-unpacked", "resources", "pi-runtime", "node_modules"),
    );
    expect(runtimeDest(ctx("linux", "/out/linux-unpacked"))).toBe(
      path.join("/out/linux-unpacked", "resources", "pi-runtime", "node_modules"),
    );
  });

  it("never puts a .app folder on a non-darwin build", () => {
    for (const p of ["win32", "linux"]) {
      expect(runtimeDest(ctx(p, "/out/x")), p).not.toContain(".app");
    }
  });
});

describe("longestRelativePath", () => {
  it("finds the deepest file and reports its relative length", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lp-"));
    try {
      fs.mkdirSync(path.join(dir, "a", "bb", "ccc"), { recursive: true });
      fs.writeFileSync(path.join(dir, "a", "bb", "ccc", "dddd.js"), "");
      fs.writeFileSync(path.join(dir, "x.js"), "");
      const r = longestRelativePath(dir);
      expect(r.rel.split(/[\\/]/)).toEqual(["a", "bb", "ccc", "dddd.js"]);
      expect(r.length).toBe(path.join("a", "bb", "ccc", "dddd.js").length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the Windows path budget", () => {
  it("accepts a realistic depth and refuses one that would not install", () => {
    expect(fitsWindowsPathLimit(100)).toBe(true);
    expect(fitsWindowsPathLimit(WIN_PATH_LIMIT)).toBe(false);
  });

  it("leaves room for the install prefix and a temp rename", () => {
    // MAX_PATH is 260. The budget keeps 20 back so an updater's rename still fits.
    expect(WIN_PATH_LIMIT).toBeLessThan(260);
    expect(WIN_INSTALL_PREFIX_BUDGET).toBeGreaterThan(
      "C:\\Users\\Guiguito\\AppData\\Local\\Programs\\HappyVibe\\".length - 10,
    );
  });
});

describe("the hook itself", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "build", "afterPack.mjs"), "utf8");

  it("throws when the copy did not land, rather than succeeding silently", () => {
    expect(src).toMatch(/did not land/);
    expect(src).toMatch(/bundle["'\s,\]]*.*cli\.js|cli\.js/);
  });

  it("still guards the ad-hoc re-sign to darwin, with its entitlements argument", () => {
    expect(src).toMatch(/electronPlatformName === "darwin"/);
    expect(src).toMatch(/--entitlements/);
  });
});
