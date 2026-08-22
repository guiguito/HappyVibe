/**
 * FR4 — the child's half of the permission engine: the SAME rules, with `ask`
 * clamped to `deny`.
 *
 * A child runs `--mode json -p` with stdin ignored and a no-op UI context, so a
 * prompt raised inside one returns `undefined` silently — fail-closed, but
 * mislabeled `source:"user"` and with no audit reaching the app. There is
 * therefore no third option in a child: a call the parent would have asked about
 * is refused, with a reason telling the model where to take it.
 *
 * Pure and key-free.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_RULES, type RulesFile } from "../pi-runtime/extensions/hv-rules";
import { childDecision } from "../pi-runtime/extensions/hv-child-rules";

const call = (tool: string, input: Record<string, unknown> = {}) => ({ tool, input, workspace: "/ws" });
const open = { bypass: false, rulesReadable: true };
const closed = { bypass: false, rulesReadable: false };

const withRules = (...rules: RulesFile["global"]): RulesFile => ({ global: rules, workspaces: {} });

describe("the ask→deny clamp", () => {
  it("clamps a default ask to DENY — there is nobody in a child to ask", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), open);
    expect(d.action).toBe("deny");
    expect(d.wouldHave, "the engine's own verdict is preserved, not squashed").toBe("ask");
  });

  it("names the boundary and points escalation at the parent turn", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), open);
    expect(d.reason).toMatch(/sub-agent/i);
    expect(d.reason).toMatch(/report|main session/i);
    // It must not invite a retry: a child looping on a denied tool burns the
    // whole run and the user sees nothing but a timeout.
    expect(d.reason).toMatch(/do not retry/i);
  });

  it("still allows what the parent would auto-allow", () => {
    const d = childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), open);
    expect(d.action).toBe("allow");
    expect(d.wouldHave).toBe("allow");
  });

  it("an explicit deny rule stays a deny", () => {
    const rules = withRules({ layer: "command", pattern: "rm *", action: "deny" });
    expect(childDecision(rules, call("bash", { command: "rm -rf /" }), open).action).toBe("deny");
  });

  it("an explicit ALLOW on a command is honoured — the whole reason bash needs this guard", () => {
    // Upstream's native child gate refuses to gate bash at all (it throws on a
    // `bash` key and hardcodes bash to allow), so command-layer policy exists
    // nowhere else in a child.
    const rules = withRules({ layer: "command", pattern: "npm test", action: "allow" });
    expect(childDecision(rules, call("bash", { command: "npm test" }), open).action).toBe("allow");
  });

  it("an ask RULE is also clamped, not honoured as a prompt", () => {
    const rules = withRules({ layer: "tool", pattern: "read", action: "ask" });
    const d = childDecision(rules, call("read", { path: "/ws/a.ts" }), open);
    expect(d.action).toBe("deny");
    expect(d.wouldHave).toBe("ask");
  });

  it("workspace confinement carries into the child", () => {
    // evaluate() returns ask for a file tool reaching outside the workspace, so
    // the clamp turns it into a deny. A child must not be a way around v5.
    const d = childDecision(EMPTY_RULES, call("read", { path: "/etc/passwd" }), open);
    expect(d.action).toBe("deny");
  });
});

describe("fail-closed on unreadable rules", () => {
  it("denies a gated tool when the rules file could not be read", () => {
    expect(childDecision(EMPTY_RULES, call("bash", { command: "ls" }), closed).action).toBe("deny");
    expect(childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), closed).action).toBe("deny");
  });

  it("still allows a safe-default read, because a blind child is a useless one", () => {
    // Reading is not the hazard, and denying it would make an unreadable rules
    // file indistinguishable from a broken sub-agent feature.
    expect(childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), closed).action).toBe("allow");
    expect(childDecision(EMPTY_RULES, call("grep", { path: "/ws" }), closed).action).toBe("allow");
  });

  it("a missing rules file is NOT treated as an empty ruleset that permits things", () => {
    // The failure this guards: "no rules" must not read as "no restrictions".
    const d = childDecision(EMPTY_RULES, call("edit", { path: "/ws/a.ts" }), closed);
    expect(d.action).toBe("deny");
  });
});

describe("bypass parity (FR6)", () => {
  const bypass = { bypass: true, rulesReadable: true };

  it("bypass means bypass, for children too", () => {
    expect(childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), bypass).action).toBe("allow");
    expect(childDecision(EMPTY_RULES, call("bash", { command: "rm -rf /" }), bypass).action).toBe("allow");
  });

  it("records what the rules WOULD have said, so the row is not just 'bypass'", () => {
    const d = childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), bypass);
    expect(d.wouldHave).toBe("ask");
  });

  it("overrides an explicit deny, matching the parent's own bypass semantics", () => {
    const rules = withRules({ layer: "tool", pattern: "write", action: "deny" });
    const d = childDecision(rules, call("write", { path: "/ws/a.ts" }), bypass);
    expect(d.action).toBe("allow");
    expect(d.wouldHave).toBe("deny");
  });

  it("bypass wins even when the rules file is unreadable", () => {
    expect(childDecision(EMPTY_RULES, call("bash", { command: "ls" }), { bypass: true, rulesReadable: false }).action).toBe("allow");
  });
});

describe("every decision carries the engine's verdict", () => {
  it("wouldHave is always one of allow | ask | deny", () => {
    const cases = [
      childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), open),
      childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), open),
      childDecision(withRules({ layer: "tool", pattern: "bash", action: "deny" }), call("bash", { command: "x" }), open),
    ];
    for (const d of cases) expect(["allow", "ask", "deny"]).toContain(d.wouldHave);
  });

  it("an allow carries no reason, a deny always does", () => {
    expect(childDecision(EMPTY_RULES, call("read", { path: "/ws/a.ts" }), open).reason).toBeUndefined();
    expect(childDecision(EMPTY_RULES, call("write", { path: "/ws/a.ts" }), open).reason).toBeTruthy();
  });
});
