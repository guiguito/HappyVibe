import { describe, expect, test } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * §13 round 26 — what a spawn does with each tool switch. Every switch rides HV_BUILTINS, whose
 * keys are listed EXPLICITLY in spawn.ts; a key missing there never reaches the bridge, which is
 * exactly how the Schedules switch silently did nothing until this round.
 */
const builtins = (over: Record<string, unknown> = {}) => ({
  plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true,
  document: true, memory: true, memoryAppend: "", schedules: true,
  ...over,
});
const spawnWith = (over: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  resolvePiSpawn("/w", "/s", "/rt", { builtinTools: builtins(over) as never, ...extra });

describe("HV_BUILTINS carries every switch", () => {
  test("schedules:false reaches the bridge", () => {
    expect(JSON.parse(spawnWith({ schedules: false }).env.HV_BUILTINS).schedules).toBe(false);
  });
});
