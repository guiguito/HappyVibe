/**
 * PRD §12 (2026-09-26): the in-process child guard composes the three §12 layers in
 * ONE place — the approved boundary, the rule engine with ask→deny (Phase 1: nobody
 * to ask), and write confinement — for tintinweb's in-process children.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardDecision } from "../pi-runtime/extensions/hv-child-guard";
import { parseRulesFile } from "../pi-runtime/extensions/hv-rules";

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-ws-"));
const noRules = parseRulesFile(JSON.stringify({ global: [], workspaces: {} }));
const allow = (pattern: string) => parseRulesFile(JSON.stringify({ global: [{ layer: "tool", pattern, action: "allow" }], workspaces: {} }));
const base = { rules: noRules, rulesReadable: true, bypass: false, workspace: ws };
const READ_ONLY = ["find", "grep", "ls", "read"];

describe("guardDecision", () => {
  it("a tool outside the approved boundary is denied, naming the boundary — even under an allow rule", () => {
    const d = guardDecision({ ...base, rules: allow("bash"), tool: "bash", input: { command: "ls" }, boundary: READ_ONLY });
    expect(d.action).toBe("deny");
    expect(d.reason).toMatch(/outside the boundary/);
  });

  it("the boundary holds under bypass too — bypass skips prompts, not the approved reach", () => {
    expect(guardDecision({ ...base, bypass: true, tool: "bash", input: { command: "ls" }, boundary: READ_ONLY }).action).toBe("deny");
  });

  it("inside the boundary, an ask is still denied (Phase 1: nobody to ask)", () => {
    const d = guardDecision({ ...base, tool: "write", input: { path: path.join(ws, "a.txt"), content: "x" }, boundary: ["read", "write"] });
    expect(d).toMatchObject({ action: "deny", wouldHave: "ask" });
  });

  it("inside the boundary with an allow rule, the call runs", () => {
    const d = guardDecision({ ...base, rules: allow("write"), tool: "write", input: { path: path.join(ws, "a.txt"), content: "x" }, boundary: ["read", "write"] });
    expect(d).toMatchObject({ action: "allow", wouldHave: "allow" });
  });

  it("an allowed write OUTSIDE the workspace is still refused, naming the workspace", () => {
    const d = guardDecision({ ...base, rules: allow("write"), tool: "write", input: { path: "/etc/hv-nope", content: "x" }, boundary: ["write"] });
    expect(d.action).toBe("deny");
    expect(d.reason).toContain(ws);
  });

  it("bypass extends to children inside their boundary, and still reports what the rules would have said", () => {
    const d = guardDecision({ ...base, bypass: true, tool: "bash", input: { command: "ls" }, boundary: ["bash"] });
    expect(d).toMatchObject({ action: "allow", wouldHave: "ask" });
  });

  it("unreadable rules fail closed for anything not safe", () => {
    expect(guardDecision({ ...base, rulesReadable: false, tool: "bash", input: { command: "ls" }, boundary: ["bash"] }).action).toBe("deny");
  });

  // §13 round 26: a core tool the user switched off is absent from the parent (--exclude-tools),
  // but a child is its own session and an agent file with no tools: line gets every core tool.
  // So the guard refuses it — before the boundary, under bypass too, and never as an ask.
  it("a switched-off core tool is refused even inside the boundary and under bypass, with no ask", () => {
    const d = guardDecision({ ...base, bypass: true, rules: allow("bash"), tool: "bash", input: { command: "ls" }, boundary: ["bash"], off: ["bash"] });
    expect(d.action).toBe("deny");
    expect(d.reason).toMatch(/switched off 'bash'/);
    expect(d.askable).toBeUndefined();
  });

  it("switching one core tool off leaves the others alone", () => {
    expect(guardDecision({ ...base, tool: "read", input: { path: "a.txt" }, boundary: READ_ONLY, off: ["bash"] }).action).toBe("allow");
  });

  it("safe reads inside the boundary need no rule", () => {
    expect(guardDecision({ ...base, tool: "read", input: { path: "a.txt" }, boundary: READ_ONLY }).action).toBe("allow");
  });
});
