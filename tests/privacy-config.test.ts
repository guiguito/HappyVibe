import { beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-privacy-config-"));
  vi.resetModules();
});
const writeCfg = (o: object): void => fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify(o));
const readCfg = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"));

test("a config from before this round reads every switch on (Review Focus 4)", async () => {
  writeCfg({});
  const { getSwitch } = await import("../src/main/config");
  const { SWITCH_KEYS } = await import("../src/main/privacySwitches");
  for (const k of SWITCH_KEYS) expect(getSwitch(k, {}), k).toBe(true);
});

test("one stray key turns off its own switch and nothing else", async () => {
  writeCfg({ updateCheckOff: true });
  const { getSwitch } = await import("../src/main/config");
  const { SWITCH_KEYS } = await import("../src/main/privacySwitches");
  for (const k of SWITCH_KEYS) expect(getSwitch(k, {}), k).toBe(k !== "updateCheck");
});

test("set stores only a negative and deletes it on the way back on", async () => {
  const { getSwitch, setSwitch } = await import("../src/main/config");
  setSwitch("sessionPulse", false);
  expect(readCfg().sessionPulseOff).toBe(true);
  expect(getSwitch("sessionPulse", {})).toBe(false);
  setSwitch("sessionPulse", true);
  expect(readCfg()).not.toHaveProperty("sessionPulseOff");
});

test("an env lock reads off, whatever is stored", async () => {
  const { getSwitch, setSwitch } = await import("../src/main/config");
  expect(getSwitch("crashReports", { HV_NO_CRASH_REPORTS: "1" })).toBe(false);
  setSwitch("feedback", false);
  expect(getSwitch("feedback", { HV_NO_PHONE_HOME: "0" })).toBe(false);
});

test("defaultWeb has no stored key: on unless locked", async () => {
  const { getSwitch } = await import("../src/main/config");
  expect(getSwitch("defaultWeb", {})).toBe(true);
  expect(getSwitch("defaultWeb", { HV_NO_DEFAULT_WEB: "1" })).toBe(false);
});
