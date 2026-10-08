/**
 * PRD §12 (2026-09-26): gating tintinweb's tools keeps the rule vocabulary, and an
 * agent that declares no `tools:` is read-only — even though tintinweb itself would
 * hand it every builtin.
 */
import { describe, expect, it } from "vitest";
import { WORKFLOW_CHOICES, declaresTools, twAgentOf, twBoundary, workflowAgents, workflowName, workflowSource } from "../pi-runtime/extensions/hv-tw-gate";
import { boundaryRuleName } from "../pi-runtime/extensions/hv-subagent-boundary";
import { parseAgentFile } from "../pi-runtime/extensions/hv-agents";

const ALL_BUILTINS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

describe("twAgentOf — an Agent call gates as subagent:<type>", () => {
  it("names the agent", () => {
    const agent = twAgentOf("Agent", { subagent_type: "worker", prompt: "x", description: "y" });
    expect(agent).toBe("worker");
    expect(boundaryRuleName(agent!)).toBe("subagent:worker");
  });
  it("only Agent, and only with a type, is a delegation", () => {
    expect(twAgentOf("SubagentWorkflow", { script: "…" })).toBeNull();
    expect(twAgentOf("subagent", { agent: "worker" })).toBeNull();
    expect(twAgentOf("Agent", { prompt: "no type" })).toBeNull();
    expect(twAgentOf("Agent", { subagent_type: "" })).toBeNull();
  });
});

describe("twBoundary", () => {
  it("a declared write-capable toolset is named on the boundary", () => {
    const b = twBoundary("worker", { builtinToolNames: ["read", "bash", "write"], declared: true }, {})!;
    expect(b.declared).toBe(true);
    expect(b.tools).toEqual(["bash", "read", "write"]);
    expect(b.writeCapable).toEqual(expect.arrayContaining(["bash", "write"]));
    expect(b.context).toBe("fresh");
  });

  it("no tools: line ⇒ read-only, although tintinweb resolved ALL builtins", () => {
    const b = twBoundary("vague", { builtinToolNames: ALL_BUILTINS, declared: false }, {})!;
    expect(b.declared).toBe(false);
    expect(b.writeCapable).toEqual([]);
    expect(b.tools).toEqual(["find", "grep", "ls", "read"]);
  });

  it("§13 round 26: a switched-off core tool is not promised on the boundary", () => {
    expect(twBoundary("worker", { builtinToolNames: ["read", "bash", "write"], declared: true }, {}, new Set(["bash"]))!.tools).toEqual(["read", "write"]);
    expect(twBoundary("vague", { builtinToolNames: ALL_BUILTINS, declared: false }, {}, new Set(["read"]))!.tools).toEqual(["find", "grep", "ls"]);
  });

  it("inherit_context is shown, not clamped", () => {
    expect(twBoundary("code-explorer", { builtinToolNames: ["read"], declared: true }, { inherit_context: true })!.context).toBe("fork");
  });

  it("nested delegation, resume and isolation are declared on the prompt", () => {
    const b = twBoundary("lead", { builtinToolNames: ["read"], declared: true, allowedSubagents: ["worker"] }, { resume: "abc", isolated: true })!;
    expect(b.fanout).toBe(true);
    expect(b.declarations).toEqual(["can delegate to: worker", "resumes run abc", "isolated (no extension tools)"]);
  });

  it("an unknown agent has no boundary (so the bridge refuses before any prompt)", () => {
    expect(twBoundary("nope", undefined, {})).toBeUndefined();
  });
});

describe("declaresTools — read from the FILE", () => {
  it("tells 'declared' from 'said nothing'", () => {
    expect(declaresTools(parseAgentFile("---\nname: a\ndescription: d\ntools: read, grep\n---\nbody").frontmatter)).toBe(true);
    expect(declaresTools(parseAgentFile("---\nname: a\ndescription: d\ntools: all\n---\nbody").frontmatter)).toBe(true);
    expect(declaresTools(parseAgentFile("---\nname: a\ndescription: d\n---\nbody").frontmatter)).toBe(false);
  });
});

describe("workflows — approved as code (decision 7)", () => {
  const fsLike = (files: Record<string, string>) => ({
    cwd: "/ws", agentDir: "/agent",
    read: (p: string) => files[p] ?? null,
    join: (...p: string[]) => p.join("/"),
    resolve: (...p: string[]) => (p[1]?.startsWith("/") ? p[1] : p.join("/")),
  });

  it("scriptPath beats script beats a saved name (upstream's precedence)", () => {
    const d = fsLike({ "/ws/a.js": "FROM-PATH", "/agent/workflows/n.js": "SAVED" });
    expect(workflowSource({ scriptPath: "a.js", script: "INLINE", name: "n" }, d)).toEqual({ script: "FROM-PATH", origin: "path" });
    expect(workflowSource({ script: "INLINE", name: "n" }, d)).toEqual({ script: "INLINE", origin: "inline" });
    expect(workflowSource({ name: "n" }, d)).toEqual({ script: "SAVED", origin: "saved" });
  });

  it("a saved workflow comes from the app's agent dir only — never the project's", () => {
    const d = fsLike({ "/ws/.pi/workflows/evil.js": "EVIL" });
    expect(workflowSource({ name: "evil" }, d)).toHaveProperty("error");
    expect(workflowSource({ name: "../../etc/passwd" }, d)).toHaveProperty("error");
  });

  it("lists the agents it can name, and says when a call escapes the scan", () => {
    expect(workflowAgents(`const a = await agent('x', { agentType: 'code-explorer' })\nawait agent({ agentType: "worker", prompt: "y" })`)).toEqual({ types: ["code-explorer", "worker"], unparsed: false });
    expect(workflowAgents(`const t = pick(); await agent('x', { agentType: t })`).unparsed).toBe(true);
    expect(workflowAgents(`await agent('x')`).unparsed).toBe(true);
  });

  it("offers Allow and Deny only, and names the workflow from its meta block", () => {
    expect([...WORKFLOW_CHOICES]).toEqual(["Allow", "Deny"]);
    expect(workflowName("export const meta = { name: 'probe-wf', description: 'two explorers' }")).toBe("probe-wf");
    expect(workflowName("no meta")).toBe("workflow");
  });
});
