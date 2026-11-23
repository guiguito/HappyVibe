import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { evaluate, EMPTY_RULES } from "../pi-runtime/extensions/hv-rules";

/**
 * After a deny, edits ask for the rest of the session. Round 29 lets write/edit inside the
 * workspace run without asking because Rewind can undo them — but the live batch showed the
 * hole that leaves (2026-11-22): the user denies `bash touch forbidden.txt`, and one second
 * later the model creates forbidden.txt with a `write` the safe default lets through. Once
 * something was denied in a session, an edit is no longer the agent's way around the "no".
 */

describe("the engine: afterDeny withdraws the edit safe default, and nothing else", () => {
  const ev = (tool: string, input: Record<string, unknown>, afterDeny?: boolean) =>
    evaluate(EMPTY_RULES, { tool, input, workspace: "/ws", ...(afterDeny === undefined ? {} : { afterDeny }) });

  test("no deny yet: write and edit inside the workspace run freely, as round 29 set", () => {
    expect(ev("write", { path: "forbidden.txt", content: "" })).toEqual({ action: "allow", source: "safe-default" });
    expect(ev("edit", { path: "src/a.ts" }, false)).toEqual({ action: "allow", source: "safe-default" });
  });

  test("after a deny: they ask", () => {
    expect(ev("write", { path: "forbidden.txt", content: "" }, true)).toEqual({ action: "ask", source: "default" });
    expect(ev("edit", { path: "src/a.ts" }, true)).toEqual({ action: "ask", source: "default" });
  });

  test("reads stay free, and the user's own allow rule still allows", () => {
    expect(ev("read", { path: "src/a.ts" }, true)).toEqual({ action: "allow", source: "safe-default" });
    const allowWrite = { global: [{ layer: "tool" as const, pattern: "write", action: "allow" as const }], workspaces: {} };
    expect(evaluate(allowWrite, { tool: "write", input: { path: "a.txt" }, workspace: "/ws", afterDeny: true }).action).toBe("allow");
  });
});

describe("the bridge: who counts as a deny, and how long it lasts", () => {
  const bridge = fs.readFileSync(path.join(import.meta.dirname, "..", "pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  const after = (anchor: string): string => {
    const i = bridge.indexOf(anchor);
    expect(i, anchor).toBeGreaterThan(-1);
    return bridge.slice(i, i + anchor.length + 40);
  };

  test("the user's Deny and a deny rule set it — at the tool gate and for a workflow", () => {
    expect(after(`audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "user" });`)).toContain("noteDeny(pi)");
    expect(after(`audit(ctx.ui, { tool: permTool, summary, decision: "deny", source: "rule", rule: v.rule });`)).toContain("noteDeny(pi)");
    expect(after(`audit(ctx.ui, { tool: "workflow", summary: name, decision: "deny", source: "user" });`)).toContain("noteDeny(pi)");
    expect(after(`audit(ctx.ui, { tool: "workflow", summary: name, decision: "deny", source: "rule", rule: wv.rule });`)).toContain("noteDeny(pi)");
  });

  test("a mode's clamp does not: plan, read-only and switched-off tools are settings, not a no", () => {
    for (const source of ["plan", "readonly", "terminal", "web", "document"]) {
      const i = bridge.indexOf(`decision: "deny", source: "${source}" });`);
      expect(i, source).toBeGreaterThan(-1);
      expect(bridge.slice(i, i + 80), source).not.toContain("noteDeny");
    }
  });

  test("both evaluate() calls of the tool gate receive it", () => {
    expect(bridge.match(/fileRewind: FILE_REWIND, afterDeny: deniedInSession,/g)).toHaveLength(2);
  });

  test("it lasts the session: persisted on the first deny, restored on session_start", () => {
    expect(bridge).toMatch(/pi\.appendEntry\(DENIED_TYPE, \{ denied: true \}\)/);
    expect(bridge).toMatch(/deniedInSession = restoreDenied\(entries\);/);
  });
});
