import { describe, expect, it } from "vitest";
import { avatarHue, toRunAvatars, promotedKeys, RUN_STATE_RING, type RunAvatar } from "../src/renderer/src/runRail";
import type { DelegationRun } from "../src/renderer/src/agents";
import type { TerminalRun } from "../src/renderer/src/components/TerminalRunCard";

const del = (over: Partial<DelegationRun> = {}): DelegationRun => ({
  id: "r1", kind: "async", agent: "code-explorer", label: "map the architecture",
  startedAt: 0, status: "running", ...over,
});
const term = (over: Partial<TerminalRun> = {}): TerminalRun => ({
  terminalId: "t1", title: "npm run dev", running: true, intent: "start the dev server",
  startedAt: 0, ...over,
});

describe("avatarHue", () => {
  it("is stable for the same name", () => {
    expect(avatarHue("code-explorer")).toBe(avatarHue("code-explorer"));
  });

  it("stays inside a hue circle", () => {
    for (const n of ["worker", "code-explorer", "agents-md-maker", "", "a"]) {
      const h = avatarHue(n);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("separates the three bundled agents", () => {
    const hues = ["code-explorer", "worker", "agents-md-maker"].map(avatarHue);
    expect(new Set(hues).size).toBe(3);
  });
});

describe("toRunAvatars", () => {
  it("puts agents before terminals", () => {
    const out = toRunAvatars([del()], [term()]);
    expect(out.map((a) => a.kind)).toEqual(["agent", "terminal"]);
  });

  it("keys an agent by its run id and a terminal by its terminal id", () => {
    const out = toRunAvatars([del({ id: "run-9" })], [term({ terminalId: "term-4" })]);
    expect(out.map((a) => a.key)).toEqual(["run-9", "term-4"]);
  });

  it("carries the agent name and its task as the caption", () => {
    const [a] = toRunAvatars([del({ agent: "worker", label: "rename the widget" })], []);
    expect(a.name).toBe("worker");
    expect(a.caption).toBe("rename the widget");
  });

  it("carries the terminal title and its intent as the caption", () => {
    const only = toRunAvatars([], [term({ title: "vitest", intent: "run the suite" })]);
    expect(only).toHaveLength(1);
    expect(only[0].name).toBe("vitest");
    expect(only[0].caption).toBe("run the suite");
  });

  it("maps a running delegation to working and a needs-attention one to attention", () => {
    expect(toRunAvatars([del()], [])[0].state).toBe("working");
    expect(toRunAvatars([del({ live: { activityState: "needs_attention" } })], [])[0].state).toBe("attention");
  });

  it("does not raise attention for a run that has already stopped", () => {
    const a = toRunAvatars([del({ status: "done", live: { activityState: "needs_attention" } })], [])[0];
    expect(a.state).toBe("done");
  });

  it("maps each delegation outcome", () => {
    expect(toRunAvatars([del({ status: "error" })], [])[0].state).toBe("failed");
    expect(toRunAvatars([del({ status: "interrupted" })], [])[0].state).toBe("stopped");
  });

  it("a terminal is working while it runs and stopped once it exits", () => {
    expect(toRunAvatars([], [term()])[0].state).toBe("working");
    expect(toRunAvatars([], [term({ running: false })])[0].state).toBe("stopped");
  });

  it("survives an empty caption without inventing one", () => {
    expect(toRunAvatars([del({ label: "" })], [])[0].caption).toBe("");
  });
});

describe("promotedKeys", () => {
  it("promotes only runs that need attention", () => {
    const avatars: RunAvatar[] = [
      { key: "a", kind: "agent", name: "x", caption: "", state: "working", hue: 0 },
      { key: "b", kind: "agent", name: "y", caption: "", state: "attention", hue: 0 },
      { key: "c", kind: "terminal", name: "z", caption: "", state: "done", hue: 0 },
    ];
    expect(promotedKeys(avatars)).toEqual(["b"]);
  });

  it("promotes nothing when everything is calm", () => {
    expect(promotedKeys(toRunAvatars([del()], [term()]))).toEqual([]);
  });
});

describe("RUN_STATE_RING", () => {
  it("covers every state exactly once", () => {
    expect(Object.keys(RUN_STATE_RING).sort()).toEqual(["attention", "done", "failed", "stopped", "working"]);
  });

  it("animates the two live states and only those", () => {
    expect(RUN_STATE_RING.working).toContain("animate-pulse");
    expect(RUN_STATE_RING.attention).toContain("animate-pulse");
    for (const s of ["done", "failed", "stopped"] as const) {
      expect(RUN_STATE_RING[s]).not.toContain("animate-pulse");
    }
  });
});

/**
 * A1 prerequisite 1 (Animations round, 2026-09-10) — a React key IS DOM
 * identity, and the rail's was unstable for the whole of a run's life.
 *
 * An async delegation is re-keyed `toolCallId → asyncId` at
 * `tool_execution_end`, and the circle was keyed on that same map key — so
 * React destroyed the node and built a new one mid-run. Nothing looked wrong
 * until something had to ANIMATE it: the enter would re-fire, and a flight
 * landing on a node that no longer exists lands nowhere.
 *
 * `key` stays the map key (it is what every lookup uses). `domKey` is the
 * stable one, and it is what React and `data-hv-run-avatar` use.
 */
describe("domKey — stable DOM identity across the async re-key (A1)", () => {
  it("a delegation keeps its tool-call id as its DOM key through the re-key", () => {
    const fg = del({ id: "tc1", toolCallId: "tc1", kind: "fg" });
    // exactly what App.tsx's tool_execution_end does: spread the fg run, swap the id
    const rekeyed = del({ ...fg, id: "async-uuid", kind: "async" });
    expect(toRunAvatars([fg], [])[0].domKey).toBe("tc1");
    expect(toRunAvatars([rekeyed], [])[0].domKey).toBe("tc1");
    // …while the map key still follows the run id, because that is what the
    // completion notify and every lookup are keyed by.
    expect(toRunAvatars([rekeyed], [])[0].key).toBe("async-uuid");
  });

  it("a run with no tool-call id falls back to its run id", () => {
    // The post-respawn `/hv-subagent-list` resync raises runs that never had a
    // tool call in this session: they must still render.
    expect(toRunAvatars([del({ id: "run9", toolCallId: undefined })], [])[0].domKey).toBe("run9");
  });

  it("a terminal's DOM key is its tool-call id when the join is present", () => {
    expect(toRunAvatars([], [term({ terminalId: "t1", toolCallId: "tc7" })])[0].domKey).toBe("tc7");
    expect(toRunAvatars([], [term({ terminalId: "t1", toolCallId: "tc7" })])[0].key).toBe("t1");
  });

  it("a terminal with no join falls back to its terminal id", () => {
    expect(toRunAvatars([], [term({ terminalId: "t1" })])[0].domKey).toBe("t1");
  });

  it("every avatar has a non-empty domKey — an empty one collapses two circles into one", () => {
    for (const a of toRunAvatars([del(), del({ id: "r2" })], [term(), term({ terminalId: "t2" })])) {
      expect(a.domKey.length).toBeGreaterThan(0);
    }
  });
});
