import { describe, expect, test } from "vitest";
import { parsePlan, parsePlanBlocked, parseDangerous } from "../src/renderer/src/permission";

const notify = (payload: unknown) => ({ id: "1", method: "notify", message: JSON.stringify(payload) });

describe("parsePlan", () => {
  test("parses an hv.plan mode notify", () => {
    // `restored` distinguishes the session_start replay from a live
    // plan_complete — absent means live. See tests/parse-plan-restored.test.ts.
    expect(parsePlan(notify({ kind: "hv.plan", enabled: true, planPath: ".agents/plans/001-x.md" }))).toEqual({
      enabled: true,
      planPath: ".agents/plans/001-x.md",
      restored: false,
    });
    expect(parsePlan(notify({ kind: "hv.plan", enabled: false, planPath: null }))).toEqual({ enabled: false, planPath: undefined, restored: false });
  });
  test("ignores non-plan notifies and non-notify requests", () => {
    expect(parsePlan(notify({ kind: "hv.dangerous", on: true }))).toBeNull();
    expect(parsePlan({ id: "1", method: "select", title: "{}" })).toBeNull();
  });
  test("does not confuse hv.plan with hv.dangerous", () => {
    // regression: kind discrimination must be exact
    expect(parseDangerous(notify({ kind: "hv.plan", enabled: true }))).toBeNull();
  });
});

describe("parsePlanBlocked", () => {
  test("parses a blocked-tool notify", () => {
    expect(parsePlanBlocked(notify({ kind: "hv.plan.blocked", toolName: "write", toolCallId: "call-A" }))).toEqual({ toolCallId: "call-A" });
  });
  test("null without a toolCallId", () => {
    expect(parsePlanBlocked(notify({ kind: "hv.plan.blocked" }))).toBeNull();
  });
});
