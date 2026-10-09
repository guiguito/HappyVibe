import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { MASTER_ENV, PRIVACY_SWITCHES, SWITCH_KEYS, lockedByEnv, lockedKeys } from "../src/main/privacySwitches";

describe("privacy switches: env vars only ever turn a switch off", () => {
  it("nothing set → nothing locked", () => {
    expect(lockedKeys({})).toEqual([]);
  });
  it("the master locks every key", () => {
    expect(lockedKeys({ [MASTER_ENV]: "1" })).toEqual(SWITCH_KEYS);
  });
  it("each variable locks only its own key(s); HV_NO_FEEDBACK locks both feedback surfaces", () => {
    for (const k of SWITCH_KEYS) {
      const name = PRIVACY_SWITCHES[k].env;
      const sharing = SWITCH_KEYS.filter((o) => PRIVACY_SWITCHES[o].env === name);
      expect(lockedKeys({ [name]: "1" }), name).toEqual(sharing);
    }
    expect(lockedKeys({ HV_NO_FEEDBACK: "1" })).toEqual(["feedback", "sessionPulse"]);
  });
  it("an HV_ variable counts only at exactly 1 (Review Focus 1)", () => {
    for (const v of ["0", "", "true", "yes", " 1", "1 "]) {
      expect(lockedKeys({ [MASTER_ENV]: v }), JSON.stringify(v)).toEqual([]);
      expect(lockedByEnv("usageStats", { HV_NO_USAGE_STATS: v }), JSON.stringify(v)).toBe(false);
    }
  });
  it("PI_OFFLINE set to ANY value locks the model list — Pi's model runtime goes offline on `!== undefined`", () => {
    for (const v of ["1", "true", "yes", "0", "", "no"]) expect(lockedByEnv("modelList", { PI_OFFLINE: v }), JSON.stringify(v)).toBe(true);
    expect(lockedByEnv("modelList", {})).toBe(false);
    expect(lockedKeys({ PI_OFFLINE: "0" })).toEqual(["modelList"]);
  });
  it("our rule matches the vendored Pi's model runtime", () => {
    const rt = fs.readFileSync("pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js", "utf8");
    expect(rt).toContain("process.env.PI_OFFLINE === undefined");
  });
  it("is import-free (the renderer imports it)", () => {
    const src = fs.readFileSync("src/main/privacySwitches.ts", "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});
