import { describe, expect, test } from "vitest";
import { watchTargets } from "../src/renderer/src/watchTargets";
import { emptyTabs, openFile, type WorkspaceTabs } from "../src/renderer/src/tabs";
import { type PlanCardData } from "../src/renderer/src/components/PlanCard";

/**
 * §23: this set IS the live-progress contract. A workspace missing from it is a
 * workspace main never watches, which is how the "Implementing n/m" badge came to
 * freeze at its implement-time count with the file drawer closed.
 */

const WS_A = "/ws/a";
const WS_B = "/ws/b";

const withFile = (rel: string): WorkspaceTabs => openFile(emptyTabs, rel);
const plan = (sessionId: string, workspaceId: string): PlanCardData => ({
  sessionId, workspaceId, path: ".agents/plans/001-x.md", status: "implementing", done: 1, total: 4,
});

describe("watchTargets", () => {
  test("watches nothing when there are no file tabs and no plans", () => {
    expect(watchTargets({}, {})).toEqual(new Set());
    expect(watchTargets({ [WS_A]: emptyTabs }, {})).toEqual(new Set());
  });

  test("watches a workspace with an open file tab (F6)", () => {
    expect(watchTargets({ [WS_A]: withFile("src/x.ts") }, {})).toEqual(new Set([WS_A]));
  });

  test("watches a workspace with an active plan and no open tab", () => {
    expect(watchTargets({}, { s1: plan("s1", WS_A) })).toEqual(new Set([WS_A]));
  });

  test("both reasons on one workspace collapse to a single entry", () => {
    const got = watchTargets({ [WS_A]: withFile("src/x.ts") }, { s1: plan("s1", WS_A) });
    expect(got).toEqual(new Set([WS_A]));
    expect(got.size).toBe(1);
  });

  test("unions across workspaces, and two sessions planning in one workspace stay one entry", () => {
    const got = watchTargets(
      { [WS_A]: withFile("src/x.ts") },
      { s1: plan("s1", WS_B), s2: plan("s2", WS_B) },
    );
    expect(got).toEqual(new Set([WS_A, WS_B]));
  });

  test("ignores a plan with no workspaceId", () => {
    expect(watchTargets({}, { s1: { ...plan("s1", WS_A), workspaceId: "" } })).toEqual(new Set());
  });

  test("dropping the plan drops the watch — what session delete relies on", () => {
    const active = { s1: plan("s1", WS_A) };
    expect(watchTargets({}, active)).toEqual(new Set([WS_A]));
    const { s1: _removed, ...pruned } = active;
    expect(watchTargets({}, pruned)).toEqual(new Set());
  });
});
