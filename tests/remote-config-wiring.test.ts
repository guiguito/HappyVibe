import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CONFIG_DEFAULTS } from "../src/main/remoteConfig/defaults";
import { setConfigReader, webDefaultServiceAllowed } from "../src/main/remoteConfig/client";

const strip = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§39 remote config", () => {
  it("fails OPEN: true before install, and when the reader throws", () => {
    expect(CONFIG_DEFAULTS).toEqual({ web_default_service: true });
    setConfigReader(null);
    expect(webDefaultServiceAllowed()).toBe(true);
    setConfigReader(() => { throw new Error("boom"); });
    expect(webDefaultServiceAllowed()).toBe(true);
    setConfigReader(() => false);
    expect(webDefaultServiceAllowed()).toBe(false);
    setConfigReader(null);
  });
  it("defaults.ts imports nothing; client.ts nothing Electron", () => {
    expect(strip("src/main/remoteConfig/defaults.ts")).not.toMatch(/\bimport\b/);
    expect(strip("src/main/remoteConfig/client.ts")).not.toMatch(/from ["'](electron|@electron-toolkit\/utils|inlet-sdk\/config\/electron)["']/);
  });
  it("ipc.ts never imports the Electron half", () => {
    expect(strip("src/main/ipc.ts")).not.toMatch(/remoteConfig\/index|["']\.\/remoteConfig["']/);
  });
  it("identity stays main's: acceptRendererIdentity false, never setInstallationIdEnabled(false", () => {
    const idx = strip("src/main/remoteConfig/index.ts");
    expect(idx).toContain('from "inlet-sdk/config/electron"');
    expect(idx).toMatch(/acceptRendererIdentity:\s*false/);
    expect(idx).not.toContain("refreshIntervalMinutes");
    for (const f of ["src/main/remoteConfig/index.ts", "src/main/ipc.ts", "src/main/index.ts"]) {
      expect(strip(f), f).not.toContain("setInstallationIdEnabled(false");
    }
  });
  it("installed from main index, not awaited", () => {
    expect(strip("src/main/index.ts")).toMatch(/void installRemoteConfig\(\)/);
  });
  it("the web flag is read per call", () => {
    expect(strip("src/main/config.ts")).toMatch(/webDefaultServiceAllowed\(\)/);
  });
});
