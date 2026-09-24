import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PRD §38 — the Electron half of the updater cannot run under vitest (`electron`
 * is a CJS stub there), so its load-bearing properties are pinned by reading the
 * source. Each assertion names the failure it prevents.
 */
const ROOT = path.join(__dirname, "..");
const src = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const UPD = src("src/main/update/index.ts");

describe("updater wiring — §38", () => {
  it("ipc.ts never imports ./update (the §37 rule: it would take every ipc test red)", () => {
    expect(src("src/main/ipc.ts")).not.toMatch(/from ["']\.\/update/);
  });
  it("never checks on the boot path: +30 s, then every 4 h, timers unref'd", () => {
    expect(UPD).toMatch(/FIRST_CHECK_MS = 30_000/);
    expect(UPD).toMatch(/EVERY_MS = 4 \* 60 \* 60_000/);
    expect(UPD.match(/\.unref\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("does nothing at all in a dev build unless HV_UPDATE_FAKE asks for the row", () => {
    expect(UPD).toMatch(/updateMode\(\{ packaged: app\.isPackaged/);
    expect(UPD).toMatch(/HV_UPDATE_FAKE/);
    expect(UPD).toMatch(/!app\.isPackaged && process\.env\.HV_UPDATE_FAKE/);
  });
  it("re-evaluates the gate in MAIN before every quitAndInstall", () => {
    const install = UPD.slice(UPD.indexOf("const tryInstall"));
    expect(install.indexOf("installGate(")).toBeGreaterThan(-1);
    expect(install.indexOf("installGate(")).toBeLessThan(install.indexOf("quitAndInstall("));
  });
  it("never installs a pre-release, and electron-updater is pinned exact", () => {
    expect(UPD).toMatch(/allowPrerelease = false/);
    expect(JSON.parse(src("package.json")).dependencies["electron-updater"]).toBe("6.8.9");
  });
  it("a manual-mode (deb) install opens the release page rather than replacing the app", () => {
    expect(UPD).toMatch(/shell\.openExternal\(RELEASES_URL\)/);
  });
  it("every audit row is app.update and carries no cost key", () => {
    expect(src("src/main/ipc.ts")).toMatch(/type: "app\.update"/);
    expect(UPD).not.toMatch(/cost/i);
  });
  it("index.ts starts the updater with what registerIpc hands back", () => {
    expect(src("src/main/index.ts")).toMatch(/startUpdater\(registerIpc\(/);
  });
});

describe("autoUpdate config — absent means on (the bypassAll idiom)", () => {
  const cfg = src("src/main/config.ts");
  it("reads absent as on", () => expect(cfg).toMatch(/return load\(\)\.autoUpdate \?\? true;/));
  it("deletes the key when set back on, stores only false", () => {
    const set = cfg.slice(cfg.indexOf("export function setAutoUpdate"));
    expect(set).toMatch(/if \(on\) delete cfg\.autoUpdate;\s*else cfg\.autoUpdate = false;/);
  });
});

describe("preload exposes exactly the update surface", () => {
  const pre = src("src/preload/index.ts");
  it.each(["hv:update-get", "hv:update-check", "hv:update-install", "hv:update-download", "hv:update-set-auto", "hv:update-state"])("%s", (ch) => {
    expect(pre).toContain(`"${ch}"`);
  });
});
