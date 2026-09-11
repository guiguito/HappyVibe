import { describe, expect, test } from "vitest";
import { WAIT_TOOLS } from "../pi-runtime/extensions/hv-rules";
import {
  duplicateName,
  editAgentFile,
  joinToolPermissions,
  parseAgentFile,
  renderSubagentSection,
  subagentRosterLine,
  serializeAgentFile,
  isSlashCommandPath,
  toAgentDef,
  type AgentDef,
  type PermState,
} from "../pi-runtime/extensions/hv-agents";

const FILE = `---
name: greeter
description: Says hello
tools: read, grep, glob
model: deepseek/deepseek-v4-flash
---
You are a friendly greeter.

Say hello.
`;

describe("parseAgentFile", () => {
  test("splits flat frontmatter from the body", () => {
    const { frontmatter, body } = parseAgentFile(FILE);
    expect(frontmatter).toMatchObject({
      name: "greeter",
      description: "Says hello",
      tools: "read, grep, glob",
      model: "deepseek/deepseek-v4-flash",
    });
    expect(body).toBe("You are a friendly greeter.\n\nSay hello.");
  });
  test("no frontmatter → whole file is the body", () => {
    const { frontmatter, body } = parseAgentFile("just a prompt");
    expect(frontmatter).toEqual({});
    expect(body).toBe("just a prompt");
  });
  test("strips surrounding quotes on values", () => {
    const { frontmatter } = parseAgentFile('---\nname: "quoted"\n---\nbody');
    expect(frontmatter.name).toBe("quoted");
  });
  test("normalizes CRLF", () => {
    const { frontmatter, body } = parseAgentFile("---\r\nname: x\r\ndescription: y\r\n---\r\nhi");
    expect(frontmatter).toMatchObject({ name: "x", description: "y" });
    expect(body).toBe("hi");
  });
});

describe("serializeAgentFile round-trip", () => {
  test("re-parses to the same frontmatter + body", () => {
    const { frontmatter, body } = parseAgentFile(FILE);
    const out = serializeAgentFile(frontmatter, body);
    const again = parseAgentFile(out);
    expect(again.frontmatter).toEqual(frontmatter);
    expect(again.body).toBe(body);
  });
  test("drops empty values (so clearing model removes the key)", () => {
    const out = serializeAgentFile({ name: "x", description: "y", model: "" }, "body");
    expect(out).not.toContain("model:");
    expect(parseAgentFile(out).frontmatter.model).toBeUndefined();
  });
});

describe("toAgentDef", () => {
  test("normalizes tools to an array and carries source/path", () => {
    const def = toAgentDef(parseAgentFile(FILE).frontmatter, "builtin", "/a/greeter.md");
    expect(def).toEqual({
      name: "greeter",
      description: "Says hello",
      tools: ["read", "grep", "glob"],
      model: "deepseek/deepseek-v4-flash",
      source: "builtin",
      path: "/a/greeter.md",
    });
  });
  test("keeps every discovered source through toAgentDef", () => {
    // Widened 2026-08-29 from builtin|project: upstream reports four scopes and
    // we split its "user" into ours (bundled) and everyone else's.
    for (const source of ["builtin", "bundled", "user", "project", "package"] as const) {
      expect(toAgentDef({ name: "a", description: "d" }, source, "/x/a.md")?.source).toBe(source);
    }
  });

  test("returns null when name or description is missing (pi-subagents skips those)", () => {
    expect(toAgentDef({ name: "x" }, "project", "/p.md")).toBeNull();
    expect(toAgentDef({ description: "y" }, "project", "/p.md")).toBeNull();
  });
  test("no tools key → tools undefined", () => {
    const def = toAgentDef({ name: "x", description: "y" }, "project", "/p.md");
    expect(def?.tools).toBeUndefined();
  });
});

describe("editAgentFile", () => {
  test("replaces the body, preserves frontmatter", () => {
    const out = editAgentFile(FILE, { body: "New prompt." });
    const { frontmatter, body } = parseAgentFile(out);
    expect(body).toBe("New prompt.");
    expect(frontmatter.name).toBe("greeter");
    expect(frontmatter.model).toBe("deepseek/deepseek-v4-flash");
  });
  test("sets the agent-tier model", () => {
    const out = editAgentFile(FILE, { model: "anthropic/claude" });
    expect(parseAgentFile(out).frontmatter.model).toBe("anthropic/claude");
  });
  test("clears the model with null or empty string", () => {
    expect(parseAgentFile(editAgentFile(FILE, { model: null })).frontmatter.model).toBeUndefined();
    expect(parseAgentFile(editAgentFile(FILE, { model: "" })).frontmatter.model).toBeUndefined();
  });
  test("undefined model leaves it untouched", () => {
    expect(parseAgentFile(editAgentFile(FILE, { body: "x" })).frontmatter.model).toBe("deepseek/deepseek-v4-flash");
  });
});

describe("duplicateName", () => {
  test("first copy is <name>-copy", () => {
    expect(duplicateName("greeter", new Set())).toBe("greeter-copy");
  });
  test("collides → -copy-2, -copy-3, …", () => {
    expect(duplicateName("greeter", new Set(["greeter-copy"]))).toBe("greeter-copy-2");
    expect(duplicateName("greeter", new Set(["greeter-copy", "greeter-copy-2"]))).toBe("greeter-copy-3");
  });
});

describe("joinToolPermissions", () => {
  test("attaches the per-tool verdict; missing verdict defaults to ask", () => {
    const verdicts: Record<string, PermState> = { bash: "deny", read: "allow" };
    const rows = joinToolPermissions(
      [{ name: "bash" }, { name: "read" }, { name: "write" }],
      verdicts,
    );
    expect(rows).toEqual([
      { name: "bash", description: "", source: "", permission: "deny" },
      { name: "read", description: "", source: "", permission: "allow" },
      { name: "write", description: "", source: "", permission: "ask" },
    ]);
  });
});

describe("renderSubagentSection", () => {
  const mk = (name: string, description: string): AgentDef => ({ name, description, source: "builtin", path: `/x/${name}.md` });

  test("empty list injects nothing", () => {
    expect(renderSubagentSection([])).toBe("");
  });

  test("lists each agent with name + description inside one delimited element", () => {
    const s = renderSubagentSection([mk("code-explorer", "Read-only investigator"), mk("agents-md-maker", "Drafts AGENTS.md")]);
    // X4: one delimiter family, underscore-named to match Pi's own
    // <project_instructions> / <available_skills> rather than fight them.
    expect(s).toContain("<happyvibe_subagents>");
    expect(s).toContain("</happyvibe_subagents>");
    expect(s).not.toContain("## Available subagents");
    expect(s).toContain("subagent"); // guidance mentions the tool
    expect(s).toContain("- **code-explorer** — Read-only investigator");
    expect(s).toContain("- **agents-md-maker** — Drafts AGENTS.md");
    // Countermand the tool description's "call { action: list } first" so the
    // model delegates directly — upstream 0.64 still says it three times.
    expect(s).toContain('{ action: "list" }');
  });

  test("A2 — a delegation THRESHOLD, no wait-tool name, and no shouting", () => {
    const s = renderSubagentSection([mk("worker", "implements things")]);
    // The threshold replaced "prefer delegating exploration, long searches…",
    // which made models delegate two-file questions.
    expect(s).toMatch(/Delegate when the work spans many files/);
    expect(s).not.toMatch(/Prefer delegating exploration/);
    // F2: the roster named `wait`, renamed twice upstream. No wait-tool name
    // may be written outside WAIT_TOOLS, which the intercept derives from.
    for (const w of WAIT_TOOLS) expect(s, w).not.toContain(w);
    // X3: the calm register — a real gate stands behind none of this.
    expect(s).not.toMatch(/\bDo NOT\b|\bNEVER\b/);
  });

  test("no longer claims the injected roster is the complete list", () => {
    // §12 (2026-08-29): it never was — the roster came from a two-directory scan
    // while pi-subagents discovers from six plus installed packages. The
    // countermand above stays (the tool description steers the model to call
    // `list` first, which costs a turn); the superlative goes, because a
    // project-local agent file can falsify it between one turn and the next.
    const s = renderSubagentSection([mk("worker", "implements things")]);
    expect(s).not.toContain("the full, current list");
    expect(s).not.toContain("full, current");
  });

  test("clamps long descriptions to ~200 chars", () => {
    const long = "x".repeat(500);
    const s = renderSubagentSection([mk("verbose", long)]);
    expect(s).toContain("x".repeat(200));
    expect(s).not.toContain("x".repeat(201));
  });
});

// ── A slash command is not a sub-agent (§12, 2026-08-29) ────────────────────
//
// pi-subagents claims `~/.agents` as its user agent dir and scans it
// RECURSIVELY. That directory is shared with Claude Code / Superset, which keep
// slash commands in `commands/` and skills in `skills/`. Upstream excludes
// `skills/` (isLegacyAgentSkillPath, agents.ts:1817) but not `commands/`, so
// every installed slash command was being read as a delegatable sub-agent:
// measured on a real install, `10x`, `doctor`, `feedback` and `setup` from
// ~/.agents/commands/superset/ were listed on the Agents page AND injected into
// the model's roster every turn. They are not agents — they carry Claude Code's
// `argument-hint` / `allowed-tools` keys and reference ${CLAUDE_SKILL_DIR}.
describe("isSlashCommandPath", () => {
  test("rejects a commands/ file under a user agent dir", () => {
    expect(isSlashCommandPath("/Users/x/.agents/commands/superset/10x.md")).toBe(true);
    expect(isSlashCommandPath("/Users/x/.agents/commands/doctor.md")).toBe(true);
  });

  test("rejects a project-scope commands/ file too", () => {
    expect(isSlashCommandPath("/repo/.agents/commands/deploy.md")).toBe(true);
    expect(isSlashCommandPath("/repo/.claude/commands/deploy.md")).toBe(true);
  });

  test("keeps real agents, wherever they live", () => {
    expect(isSlashCommandPath("/Users/x/.agents/my-agent.md")).toBe(false);
    expect(isSlashCommandPath("/app/pi-agent/agents/worker.md")).toBe(false);
    expect(isSlashCommandPath("/repo/.pi/agents/reviewer.md")).toBe(false);
  });

  test("matches a whole SEGMENT, never a substring", () => {
    // An agent legitimately named for commands must survive.
    expect(isSlashCommandPath("/Users/x/.agents/commands-expert.md")).toBe(false);
    expect(isSlashCommandPath("/Users/x/.agents/my-commands/a.md")).toBe(false);
  });

  test("handles Windows separators", () => {
    expect(isSlashCommandPath("C:\\Users\\x\\.agents\\commands\\superset\\10x.md")).toBe(true);
  });
});

// ── Disabled agents cost nothing (§12, 2026-08-30) ─────────────────────────
describe("renderSubagentSection excludes switched-off agents", () => {
  const mk = (name: string, enabled?: boolean): AgentDef =>
    ({ name, description: `${name} does things`, source: "builtin", path: `/x/${name}.md`, ...(enabled === undefined ? {} : { enabled }) });

  test("a disabled agent is not injected", () => {
    const s = renderSubagentSection([mk("scout"), mk("researcher", false)]);
    expect(s).toContain("scout");
    expect(s).not.toContain("researcher");
  });

  test("`enabled` absent means ON — older payloads must not go dark", () => {
    // The bridge always sets it now, but a stale renderer state or a restored
    // payload without the field must not silently empty the roster.
    expect(renderSubagentSection([mk("scout")])).toContain("scout");
  });

  test("all-off injects NOTHING, not an empty heading", () => {
    // The end state of the context lever. A bare "## Available subagents" with
    // no agents under it would be worse than useless — it would tell the model
    // it has agents and then name none.
    expect(renderSubagentSection([mk("a", false), mk("b", false)])).toBe("");
  });

  test("the measured line is the injected line", () => {
    // subagentRosterLine is what the Agents page estimates from; if the two
    // drifted the app would quote a number it does not actually spend.
    const a = mk("scout");
    expect(renderSubagentSection([a])).toContain(subagentRosterLine(a));
  });
});
