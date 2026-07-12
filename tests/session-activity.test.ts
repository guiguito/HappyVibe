import { expect, test } from "vitest";
import { SessionActivity } from "../src/main/activity";

// W1.3 hibernation policy — pure victim-selection rules. A session is idle
// iff not busy AND no pending permission prompt AND no subagent running.

test("unknown sessions count as idle and sort first", () => {
  const a = new SessionActivity();
  expect(a.isIdle("never-seen")).toBe(true);
  expect(a.oldestIdle(["x", "y"])).toBe("x");
});

test("busy (prompt sent, no agent_end yet) protects; agent_end releases", () => {
  const a = new SessionActivity();
  a.prompted("s1");
  expect(a.isIdle("s1")).toBe(false);
  expect(a.oldestIdle(["s1"])).toBeNull();
  a.event("s1", { type: "agent_end" });
  expect(a.isIdle("s1")).toBe(true);
});

test("pending permission prompt protects until answered", () => {
  const a = new SessionActivity();
  a.promptOpened("s1");
  a.promptOpened("s1");
  expect(a.isIdle("s1")).toBe(false);
  a.promptClosed("s1");
  expect(a.isIdle("s1")).toBe(false); // one still open
  a.promptClosed("s1");
  expect(a.isIdle("s1")).toBe(true);
  a.promptClosed("s1"); // never goes negative
  expect(a.isIdle("s1")).toBe(true);
});

test("running subagent protects; end (or agent_end) releases", () => {
  const a = new SessionActivity();
  a.event("s1", { type: "tool_execution_start", toolName: "subagent" });
  a.event("s1", { type: "tool_execution_start", toolName: "subagent" });
  expect(a.isIdle("s1")).toBe(false);
  a.event("s1", { type: "tool_execution_end", toolName: "subagent" });
  expect(a.isIdle("s1")).toBe(false); // one still running
  a.event("s1", { type: "tool_execution_end", toolName: "subagent" });
  expect(a.isIdle("s1")).toBe(true);

  // agent_end sweeps any dangling count (dead child never sent its end)
  a.event("s1", { type: "tool_execution_start", toolName: "subagent" });
  a.event("s1", { type: "agent_end" });
  expect(a.isIdle("s1")).toBe(true);
});

test("non-subagent tools never protect", () => {
  const a = new SessionActivity();
  a.event("s1", { type: "tool_execution_start", toolName: "bash" });
  expect(a.isIdle("s1")).toBe(true);
});

test("oldest idle by last activity wins; active sessions are skipped", async () => {
  const a = new SessionActivity();
  a.event("old", { type: "agent_end" });
  await new Promise((r) => setTimeout(r, 5));
  a.event("new", { type: "agent_end" });
  a.prompted("busy");
  expect(a.oldestIdle(["busy", "new", "old"])).toBe("old");
});

test("all genuinely active → null (honest refusal)", () => {
  const a = new SessionActivity();
  a.prompted("s1");
  a.promptOpened("s2");
  a.event("s3", { type: "tool_execution_start", toolName: "subagent" });
  expect(a.oldestIdle(["s1", "s2", "s3"])).toBeNull();
});

test("remove() forgets a session's state entirely", () => {
  const a = new SessionActivity();
  a.prompted("s1");
  a.remove("s1");
  expect(a.isIdle("s1")).toBe(true);
});
