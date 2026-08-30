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
