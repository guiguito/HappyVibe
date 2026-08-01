import { describe, expect, test } from "vitest";
import { parsePlan } from "../src/renderer/src/permission";

/**
 * §23 + compaction UX: the bridge marks the session_start replay with
 * `restored` (happyvibe-bridge.ts emitPlan). The renderer must NOT append a
 * bottom plan card for that replay — a restored card belongs at its position in
 * history (rebuilt by restoreItems, with real status from readPlan), or nowhere
 * at all if compaction dropped it from context.
 *
 * parsePlan used to discard the flag, so every respawn resurrected a misplaced
 * card stuck at status "draft" — it claimed a plan was un-implemented when it
 * had been implemented, and after a renderer reload it vanished entirely.
 */
const notify = (payload: unknown): ReturnType<typeof parsePlan> =>
  parsePlan({ method: "notify", message: JSON.stringify(payload) } as never);

describe("parsePlan surfaces the restored flag", () => {
  test("reports restored:true for the session_start replay", () => {
    expect(notify({ kind: "hv.plan", enabled: true, planPath: "p.md", restored: true })).toEqual({
      enabled: true,
      planPath: "p.md",
      restored: true,
    });
  });

  test("reports restored:false for a live plan_complete", () => {
    expect(notify({ kind: "hv.plan", enabled: true, planPath: "p.md", restored: false })).toEqual({
      enabled: true,
      planPath: "p.md",
      restored: false,
    });
  });

  test("defaults restored to false when the field is absent", () => {
    expect(notify({ kind: "hv.plan", enabled: false, planPath: null })).toEqual({
      enabled: false,
      planPath: undefined,
      restored: false,
    });
  });

  test("still ignores notifies that are not ours", () => {
    expect(notify({ kind: "hv.something-else", enabled: true })).toBeNull();
  });
});
