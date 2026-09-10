import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DOT_TITLE, SESSION_DOT, sessionDotState } from "../src/renderer/src/sessionDot";

/**
 * A8 (Animations round, 2026-09-10) — "working" and "alive" stop sharing a
 * signal.
 *
 * The row's dot was the PROCESS status: `running` meant the Pi child was up, so
 * every open session pulsed green whether its agent was mid-turn or idle, and
 * the turn-in-flight state never reached the sidebar at all. PRD §17's round-15
 * sentence — "a session that is working shows the pulse" — was true only in the
 * *alive* sense.
 *
 * Working is now a ROTATION, precisely because the pulse already meant alive.
 */
const SB = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components/Sidebar.tsx"), "utf8");

describe("the session dot tells working from alive (A8)", () => {
  it("a turn in flight wins over the process status", () => {
    expect(sessionDotState("running", true)).toBe("working");
    expect(sessionDotState("running", false)).toBe("alive");
  });

  it("a turn in flight is working even if main has not said 'running' yet", () => {
    // The renderer marks a session busy the moment it sends. Waiting for main's
    // status to agree would leave the row idle for the first second of every
    // turn — which is exactly the moment the user is looking at it.
    expect(sessionDotState(undefined, true)).toBe("working");
  });

  it("the other three states are unchanged", () => {
    expect(sessionDotState("waking", false)).toBe("waking");
    expect(sessionDotState("crashed", false)).toBe("crashed");
    expect(sessionDotState(undefined, false)).toBe("idle");
  });

  it("a crash is never hidden by a stale busy flag", () => {
    // A crashed session cannot be working, whatever the renderer last thought.
    expect(sessionDotState("crashed", true)).toBe("crashed");
  });

  it("only WORKING spins; alive is a plain dot with no animation at all", () => {
    expect(SESSION_DOT.working).toContain("animate-spin");
    expect(SESSION_DOT.alive).not.toContain("animate-");
    for (const k of ["crashed", "idle"] as const) expect(SESSION_DOT[k]).not.toContain("animate-");
  });

  it("waking keeps its own pulse — it is a third thing, not a synonym", () => {
    expect(SESSION_DOT.waking).toContain("animate-pulse");
  });

  it("every state has a class and a title", () => {
    const states = ["working", "alive", "waking", "crashed", "idle"] as const;
    expect(Object.keys(SESSION_DOT).sort()).toEqual([...states].sort());
    expect(Object.keys(DOT_TITLE).sort()).toEqual([...states].sort());
    for (const s of states) expect(DOT_TITLE[s].length).toBeGreaterThan(0);
  });

  it("the spinner settles to a full ring under reduced motion", () => {
    // A spinner is a ring with a gap. Stopping it mid-turn would leave a
    // lopsided arc on screen forever, so the settled frame closes the gap.
    expect(SESSION_DOT.working).toContain("motion-safe:animate-spin");
    expect(SESSION_DOT.working).toContain("motion-reduce:border-t-tangerine");
  });

  it("the row renders from the record, with no inline ternary left behind", () => {
    expect(SB).toContain("sessionDotState(status, busy)");
    expect(SB).toContain("SESSION_DOT[dotState]");
    expect(SB).toContain("DOT_TITLE[dotState]");
    expect(SB).not.toContain('? "bg-leaf animate-pulse"');
  });

  it("the collapsed rail marks a workspace whose sessions are working", () => {
    // The 48px rail shows no sessions, so without this, collapsing the sidebar
    // hides "working" outright.
    expect(SB).toContain("wsBusy");
  });
});
