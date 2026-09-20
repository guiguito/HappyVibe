import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * PRD §4 (Linux round, 2026-09-20). Key-free.
 *
 * Every assertion here is about a way the Linux package can be WRONG while
 * looking right — a dropped icon, a package that installs and will not launch,
 * a second icon in the dock. None of them fail the build.
 */
const ROOT = path.join(__dirname, "..");
const CONFIG = parse(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("the Linux package", () => {
  it("builds AppImage and deb, x64 only", () => {
    const targets = CONFIG.linux.target as Array<{ target: string; arch: string[] }>;
    expect(targets.map((t) => t.target).sort()).toEqual(["AppImage", "deb"]);
    // linux-arm64 is EXCLUDED because nothing tests it — NOT because no build
    // exists: sherpa-onnx and @firecrawl/anydoc both publish it, unlike win-arm64.
    // Different reason than Windows, different unblock condition.
    for (const t of targets) expect(t.arch, `${t.target} arch`).toEqual(["x64"]);
  });

  it("points at the rendered icon set, not the icns downscale", () => {
    expect(CONFIG.linux.icon).toBe("build/icons");
    expect(fs.existsSync(path.join(ROOT, "build", "icons", "512x512.png"))).toBe(true);
  });

  /**
   * The double-icon-in-the-dock bug. electron-builder derives BOTH the installed
   * .desktop filename (LinuxTargetHelper.js:203-215) and StartupWMClass (:276)
   * from package.json's `desktopName`, and Electron derives its app_id from the
   * same field. Without it StartupWMClass falls back to productName
   * ("HappyVibe") while the filename falls back to executableName
   * (appInfo.sanitizedName.toLowerCase() = "happyvibe", linuxPackager.js:16) —
   * two different strings, so a running window stops associating with its
   * launcher and a second generic icon appears beside it.
   */
  it("names the desktop entry once, in package.json, and syncs to it", () => {
    expect(PKG.desktopName).toBe("happyvibe.desktop");
    expect(CONFIG.linux.syncDesktopName).toBe(true);
    // Derived from desktopName, so a hand-written copy could only drift from it.
    expect(CONFIG.linux.desktop?.entry?.StartupWMClass).toBeUndefined();
  });

  /**
   * DO NOT "fix" this by adding the dependency it names. `depends` REPLACES
   * electron-builder's defaults rather than extending them (FpmTarget.js:185-194
   * assigns straight to customDepends), and the default list already carries
   * libsecret-1-0 — the one MCP OAuth's keychain needs — alongside libgtk-3-0,
   * libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 and libuuid1.
   * `deb: { depends: ["libsecret-1-0"] }` ships a deb that installs and will
   * not launch.
   */
  it("declares NO deb.depends, because the defaults already carry libsecret", () => {
    expect(CONFIG.deb?.depends).toBeUndefined();
    const fpm = fs.readFileSync(
      path.join(ROOT, "node_modules", "app-builder-lib", "out", "targets", "FpmTarget.js"),
      "utf8",
    );
    // Pin-bump gate in the other direction: if upstream ever drops libsecret
    // from its defaults we must start declaring the whole list, and this is
    // where that shows up rather than in a user's "MCP forgot my login".
    expect(fpm).toContain('"libsecret-1-0"');
  });

  it("gives the menu entry a category and a one-line synopsis", () => {
    expect(CONFIG.linux.category).toBe("Development");
    expect(typeof CONFIG.linux.synopsis).toBe("string");
    expect(CONFIG.linux.synopsis.length).toBeGreaterThan(10);
  });
});
