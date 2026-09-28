import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { TurnTracker, startsTurn, turnEndFor } from "../src/main/usage/turns";
import { eventFromLog, isSubagentPrompt, type TapContext } from "../src/main/usage/fromLog";
import { USAGE_EVENTS } from "../src/main/usage/events";
import { panelJustOpened } from "../src/renderer/src/usageUi";

const ctx: TapContext = { waitSec: () => 3, aiMessage: () => false, isStorePlugin: () => null, isScheduleSession: () => false, inWorktree: () => false };

describe("§39 review fixes", () => {
  it("#1 an agent_end Pi will retry ends nothing; the final one decides", () => {
    expect(turnEndFor({ willRetry: true }, { stopReason: "error", errorMessage: "429" })).toBeNull();
    expect(turnEndFor({ willRetry: false }, { stopReason: "error", errorMessage: "429 Too Many Requests" })).toEqual({ outcome: "error", errorKind: "rate_limit" });
    expect(turnEndFor({}, { stopReason: "aborted" })).toEqual({ outcome: "aborted" });
    expect(turnEndFor({}, undefined)).toEqual({ outcome: "completed" });
  });
  it("#2 a /hv-* command starts no turn, and a failed send leaves none open", () => {
    expect(startsTurn("/hv-dangerous off")).toBe(false);
    expect(startsTurn("  /hv-plan on")).toBe(false);
    expect(startsTurn("fix the bug")).toBe(true);
    const t = new TurnTracker();
    t.start("s", false);
    t.discard("s");
    expect(t.isBusy("s")).toBe(false);
  });
  it("#3 an auto-allow under a session grant is not an answer; sub-agent prompts queue no wait", () => {
    expect(eventFromLog({ type: "permission.decision", sessionId: "s", data: { tool: "bash", decision: "allow", source: "user", grant: "session" } }, ctx)).toBeNull();
    expect(eventFromLog({ type: "permission.decision", sessionId: "s", data: { tool: "bash", decision: "deny", source: "user" } }, ctx)?.params)
      .toEqual({ decision: "deny", toolKind: "bash", waitSec: 3 });
    expect(Object.keys(USAGE_EVENTS.permission_answered.params)).not.toContain("byRule");
    expect(Object.keys(USAGE_EVENTS.permission_answered.params)).not.toContain("fromSubagent");
    expect(isSubagentPrompt(JSON.stringify({ kind: "hv.permission", tool: "bash", child: { agent: "x" } }))).toBe(true);
    expect(isSubagentPrompt(JSON.stringify({ kind: "hv.permission", tool: "bash" }))).toBe(false);
    expect(isSubagentPrompt("not json")).toBe(false);
  });
  it("#4 the §39 block in Pi's event handler cannot throw past the event forward", () => {
    const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
    const at = ipc.indexOf("// §39: counts only");
    expect(at).toBeGreaterThan(-1);
    expect(ipc.slice(at - 40, at)).toMatch(/try \{\s*$/);
  });
  it("#5 a panel counts as opened only by a change in THIS session, not by a session switch", () => {
    expect(panelJustOpened({ open: false, sid: "a" }, { open: true, sid: "a" })).toBe(true);
    expect(panelJustOpened({ open: false, sid: "a" }, { open: true, sid: "b" })).toBe(false);
    expect(panelJustOpened({ open: true, sid: "a" }, { open: true, sid: "a" })).toBe(false);
    expect(panelJustOpened(null, { open: true, sid: "a" })).toBe(false);
  });
});
