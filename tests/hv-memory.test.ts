/** PRD §33 — the per-turn block. Pure; no Pi, no key. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEMORY_POLICY, MEMORY_TOOLS, memoryTokenLines, readIndex, renderMemorySection } from "../pi-runtime/extensions/hv-memory";
import { evaluate, SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";

describe("renderMemorySection", () => {
  it("policy, then global, then workspace — the more specific voice is read LAST (§15's rule)", () => {
    const s = renderMemorySection({ append: "", global: "## user\n- a — b", workspace: "## project\n- c — d" });
    expect(s.indexOf("<memory-policy>")).toBeLessThan(s.indexOf('<memory scope="global"'));
    expect(s.indexOf('<memory scope="global"')).toBeLessThan(s.indexOf('<memory scope="workspace"'));
    expect(s).toContain("- a — b");
    expect(s).toContain("- c — d");
  });

  it("both scope blocks are labelled untrusted", () => {
    const s = renderMemorySection({ append: "", global: "x", workspace: "y" });
    expect(s.match(/trust="untrusted"/g)).toHaveLength(2);
  });

  it("empty scopes render one line, so the model knows the scope exists", () => {
    const s = renderMemorySection({ append: "", global: "", workspace: "" });
    expect(s).toContain("No global memories yet.");
    expect(s).toContain("No workspace memories yet.");
  });

  it("workspace null renders NO workspace block — the toggle is off, not the scope empty", () => {
    const s = renderMemorySection({ append: "", global: "", workspace: null });
    expect(s).not.toContain('scope="workspace"');
    expect(s).not.toContain("No workspace memories yet.");
    expect(s).toContain('scope="global"');
  });

  it("the append lands INSIDE the policy block, after the policy — never replacing it", () => {
    const s = renderMemorySection({ append: "Never save anything about food.", global: "", workspace: "" });
    expect(s).toMatch(/<memory-policy>[\s\S]*Never save anything about food\.\n<\/memory-policy>/);
    expect(s).toContain(MEMORY_POLICY);
  });

  it("an empty or whitespace append changes nothing", () => {
    const a = renderMemorySection({ append: "", global: "g", workspace: "w" });
    expect(renderMemorySection({ append: "   \n ", global: "g", workspace: "w" })).toBe(a);
  });
});

describe("MEMORY_POLICY", () => {
  it("names the three tools it tells the model to use", () => {
    expect(MEMORY_TOOLS).toEqual(["memory_save", "memory_recall", "memory_forget"]);
    for (const t of MEMORY_TOOLS) expect(MEMORY_POLICY).toContain(t);
  });

  it("carries the four rules the machinery enforces", () => {
    expect(MEMORY_POLICY).toMatch(/secrets/);
    expect(MEMORY_POLICY).toMatch(/hints, not evidence/);
    expect(MEMORY_POLICY).toMatch(/remember …/);
    expect(MEMORY_POLICY).toMatch(/updating an existing memory/);
  });

  it("names both scopes and says what each is", () => {
    expect(MEMORY_POLICY).toMatch(/global \(about the user/);
    expect(MEMORY_POLICY).toMatch(/workspace \(this project/);
  });
});

describe("readIndex / memoryTokenLines fail soft", () => {
  it("undefined or missing dir ⇒ empty and zero", () => {
    expect(readIndex(undefined)).toBe("");
    expect(readIndex("/nope/never/at/all")).toBe("");
    const t = memoryTokenLines(undefined, undefined);
    expect(t.global).toMatchObject({ count: 0, tokens: 0 });
    expect(t.workspace).toMatchObject({ count: 0, tokens: 0 });
    expect(t.policy).toBeGreaterThan(50); // the policy costs something even with no memories
  });

  it("counts index lines and weighs them chars/4", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mem-idx-"));
    fs.writeFileSync(path.join(d, "MEMORY.md"), "## user\n- a — bbbb\n- c — dddd\n");
    const t = memoryTokenLines(d, undefined);
    expect(t.global.count).toBe(2);
    expect(t.global.items.map((i) => i.name)).toEqual(["a", "c"]);
    expect(t.global.tokens).toBe(t.global.items.reduce((s, i) => s + i.tokens, 0));
    expect(t.workspace.count).toBe(0);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("the heading lines are not counted as memories", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mem-idx2-"));
    fs.writeFileSync(path.join(d, "MEMORY.md"), "## user\n## project\n- only-one — d\n");
    expect(memoryTokenLines(d, undefined).global.count).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

/**
 * §33 — the two gate sets, asserted through the PUBLIC functions rather than the sets, so the
 * test survives a refactor of either and fails on a change in BEHAVIOUR.
 */
describe("gates", () => {
  it("memory_recall is a safe default; save and forget are NOT", () => {
    expect(SAFE_TOOLS.has("memory_recall")).toBe(true);
    expect(SAFE_TOOLS.has("memory_save")).toBe(false);
    expect(SAFE_TOOLS.has("memory_forget")).toBe(false);
  });

  it("a bare memory_save resolves to ASK, and memory_recall to allow", () => {
    const noRules = { global: [], workspaces: {} };
    expect(evaluate(noRules, { tool: "memory_save" }).action).toBe("ask");
    expect(evaluate(noRules, { tool: "memory_forget" }).action).toBe("ask");
    const recall = evaluate(noRules, { tool: "memory_recall" });
    expect(recall.action).toBe("allow");
    expect(recall.source).toBe("safe-default");
  });

  it("all three PASS plan mode's clamp — memory is not the workspace", () => {
    for (const t of MEMORY_TOOLS) expect(gatePlanCall(t, {}).kind, t).toBe("pass");
  });

  it("…and passing means the RULE ENGINE still decides, so plan mode neither widens nor narrows", () => {
    // The contrast that makes "pass" meaningful: a write is blocked outright.
    expect(gatePlanCall("write", {}).kind).toBe("block");
  });
});
