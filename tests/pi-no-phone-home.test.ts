/**
 * HV_NO_PHONE_HOME=1 keeps every Pi child off pi.dev. The switches are Pi's own
 * (read from the vendored bundle, not invented), and index.ts must apply them to
 * process.env before any child is spawned, since not every spawn goes through
 * resolvePiSpawn (titles, commit messages, export, `pi mcp`).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { piNoPhoneHomeEnv, PI_CLI_RELPATH } from "../src/main/pi/spawn";

const root = path.resolve(__dirname, "..");

describe("piNoPhoneHomeEnv", () => {
  it("off unless the switch is exactly 1", () => {
    expect(piNoPhoneHomeEnv({})).toEqual({});
    expect(piNoPhoneHomeEnv({ HV_NO_PHONE_HOME: "0" })).toEqual({});
  });

  it("on: offline, no version check, no install telemetry", () => {
    expect(piNoPhoneHomeEnv({ HV_NO_PHONE_HOME: "1" })).toEqual({ PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" });
  });

  it("every variable is one the vendored Pi actually reads", () => {
    const chunks = path.join(root, "pi-runtime", path.dirname(PI_CLI_RELPATH), "chunks");
    const bundle = [path.join(root, "pi-runtime", PI_CLI_RELPATH), ...fs.readdirSync(chunks).map((f) => path.join(chunks, f))]
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    for (const k of Object.keys(piNoPhoneHomeEnv({ HV_NO_PHONE_HOME: "1" }))) expect(bundle, k).toContain(`process.env.${k}`);
  });

  it("index.ts applies it to process.env at module load", () => {
    const src = fs.readFileSync(path.join(root, "src/main/index.ts"), "utf8");
    expect(src).toMatch(/^Object\.assign\(process\.env, piNoPhoneHomeEnv\(process\.env\)\)$/m);
  });
});
