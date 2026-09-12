import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §35 source scans — the repo's own pattern for pinning an ABSENCE, which no
 * render test can fail on and which the no-DOM suite cannot see any other way.
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("the Built-in tools row", () => {
  it("renders a Schedules switch bound to builtins.schedules", () => {
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    expect(src).toContain("builtins.schedules");
    expect(src).toMatch(/builtinsSet\(\{ schedules: on \}\)/);
  });

  it("says the scheduler keeps running — the toggle takes tools from the AGENT, not schedules from the user", () => {
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    const row = src.slice(src.indexOf("function SchedulesRow"), src.indexOf("export function BuiltinToolsBlock"));
    expect(row).toMatch(/schedules keep running/i);
  });
});

describe("a schedule can never carry its own permission bypass (§5.1)", () => {
  it("the Schedule type has no bypass or dangerous field", () => {
    const src = R("src/main/schedules.ts");
    const iface = src.slice(src.indexOf("export interface Schedule {"), src.indexOf("export const FAIL_PAUSE_AT"));
    expect(iface.toLowerCase()).not.toMatch(/bypass|dangerous/);
  });
});
