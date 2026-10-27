import { describe, expect, it } from "vitest";
import { isSafeCommand as planIsSafe, PLAN_SAFE_SUBCOMMANDS } from "../pi-runtime/extensions/hv-plan";
import { isSafeCommand as shellIsSafe, READONLY_SUBCOMMANDS } from "../pi-runtime/extensions/hv-shell";

describe("hv-shell", () => {
  it("plan mode and hv-shell share ONE classifier", () => {
    expect(planIsSafe).toBe(shellIsSafe);
    expect(PLAN_SAFE_SUBCOMMANDS).toBe(READONLY_SUBCOMMANDS);
  });
});
