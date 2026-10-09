/**
 * Privacy round (D4, D10). What the vendored Pi sends on its own, read from its
 * dist — so a pin bump that changes it fails here instead of silently calling home.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PI_CLI_RELPATH, piMasterEnv, resolvePiSpawn } from "../src/main/pi/spawn";
import { MODEL_LIST_REFRESH_HOURS } from "../src/main/privacySwitches";

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist");
const read = (rel: string): string => fs.readFileSync(path.join(dist, rel), "utf8");
function jsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "bundle" ? [] : jsFiles(p); // the bundle concatenates these
    return d.name.endsWith(".js") ? [p] : [];
  });
}

describe("Pi's own calls home", () => {
  it("the master sets only PI_OFFLINE — never PI_SKIP_VERSION_CHECK or PI_TELEMETRY", () => {
    expect(piMasterEnv({})).toEqual({});
    expect(piMasterEnv({ HV_NO_PHONE_HOME: "0" })).toEqual({});
    expect(piMasterEnv({ HV_NO_PHONE_HOME: "1" })).toEqual({ PI_OFFLINE: "1" });
  });

  it("the bundle Pi actually runs reads PI_OFFLINE (PR #104)", () => {
    const chunks = path.join(root, "pi-runtime", path.dirname(PI_CLI_RELPATH), "chunks");
    const bundle = [path.join(root, "pi-runtime", PI_CLI_RELPATH), ...fs.readdirSync(chunks).map((f) => path.join(chunks, f))]
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(bundle).toContain("process.env.PI_OFFLINE");
  });

  it("the version check and install telemetry are reached only from the terminal UI and `pi update`", () => {
    const CALLS = /\b(checkForNewPiVersion|getLatestPiRelease|reportInstallTelemetry)\(/;
    const allowed = new Set(["utils/version-check.js", "modes/interactive/interactive-mode.js", "package-manager-cli.js"]);
    const callers = jsFiles(dist)
      .filter((f) => CALLS.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(dist, f).split(path.sep).join("/"));
    expect(callers.filter((f) => !allowed.has(f))).toEqual([]);
    expect(callers).toContain("modes/interactive/interactive-mode.js"); // the scan isn't vacuous
  });

  it("RPC refreshes the model list unless offline, at the interval the Privacy copy states", () => {
    expect(read("main.js")).toContain('if (!offlineMode && appMode === "rpc") {');
    expect(read("core/remote-catalog-provider.js")).toContain(
      `REMOTE_CATALOG_REFRESH_INTERVAL_MS = ${MODEL_LIST_REFRESH_HOURS} * 60 * 60 * 1000`,
    );
  });

  it("index.ts applies the master to process.env at module load, before any child exists", () => {
    expect(fs.readFileSync(path.join(root, "src/main/index.ts"), "utf8")).toMatch(/^Object\.assign\(process\.env, piMasterEnv\(process\.env\)\)$/m);
  });

  it("the Model list switch puts PI_OFFLINE in that session's env only", () => {
    expect(resolvePiSpawn("/w", "/s", "/r", { offline: true }).env.PI_OFFLINE).toBe("1");
    expect(resolvePiSpawn("/w", "/s", "/r", {}).env.PI_OFFLINE).toBe(process.env.PI_OFFLINE);
  });

  it("spawnOpts passes the switch", () => {
    expect(fs.readFileSync(path.join(root, "src/main/ipc.ts"), "utf8")).toMatch(/offline: !getSwitch\("modelList"\)/);
  });
});
