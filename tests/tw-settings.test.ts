/**
 * PRD §12 (2026-09-26): the settings HappyVibe writes to tintinweb's GLOBAL
 * `<agentDir>/subagents.json`. Every value is stated rather than inherited — the
 * §12 "isolation contract is written down" rule — because a future upstream default
 * flip would otherwise change behaviour with no failing test. The keys are checked
 * against tintinweb's own settings type so a renamed key fails here, not silently.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { TINTINWEB_SETTINGS, tintinwebSettings } from "../src/main/subagentSettings";

describe("tintinwebSettings — every value stated, none inherited", () => {
  const s = tintinwebSettings({ someUserKey: 1, maxConcurrent: 10, workflowsEnabled: false, schedulingEnabled: true });

  it("writes the locked set, overriding what was there", () => {
    expect(s).toMatchObject({
      widgetMode: "off", fleetView: false, agentMentions: "off", outputTranscript: false,
      schedulingEnabled: false, worktreeIsolation: false, disableDefaultAgents: true,
      fallbackSubagent: "none", reportUsage: false, rememberAgents: true, maxConcurrent: 4,
      workflowsEnabled: true,
    });
  });

  it("keeps keys it does not own (upstream's schema, merge-written)", () => {
    expect(s.someUserKey).toBe(1);
  });

  it("every key it writes is a real tintinweb setting", () => {
    const src = fs.readFileSync("pi-runtime/node_modules/@tintinweb/pi-subagents/src/settings.ts", "utf8");
    const iface = src.slice(src.indexOf("export interface SubagentsSettings"), src.indexOf("\n}\n", src.indexOf("export interface SubagentsSettings")));
    for (const key of Object.keys(TINTINWEB_SETTINGS)) {
      expect(iface, key).toMatch(new RegExp(`\\n\\s+${key}\\?:`));
    }
  });
});
