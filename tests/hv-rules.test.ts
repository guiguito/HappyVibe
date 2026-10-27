import { describe, expect, test } from "vitest";
import {
  EMPTY_RULES,
  escapesWorkspace,
  evaluate,
  globToRegExp,
  parseRulesFile,
  type Rule,
  type RulesFile,
} from "../pi-runtime/extensions/hv-rules";

const WS = "/Users/me/proj";
const call = (tool: string, input: Record<string, unknown> = {}, workspace = WS) => ({ tool, input, workspace });
const rules = (global: Rule[] = [], workspaces: Record<string, Rule[]> = {}): RulesFile => ({ global, workspaces });

describe("no-match defaults (pre-B4 behavior preserved)", () => {
  test("safe tools allow by default", () => {
    for (const t of ["read", "grep", "glob", "list", "ls"]) {
      expect(evaluate(EMPTY_RULES, call(t))).toEqual({ action: "allow", source: "safe-default" });
    }
  });
  test("everything else asks by default", () => {
    expect(evaluate(EMPTY_RULES, call("bash", { command: "npm install" }))).toEqual({ action: "ask", source: "default" });
    expect(evaluate(EMPTY_RULES, call("write", { path: ".env" }))).toEqual({ action: "ask", source: "default" });
  });
});

describe("v5: workspace confinement", () => {
  test("escapesWorkspace: absolute inside/outside", () => {
    expect(escapesWorkspace("/Users/me/proj/src/a.ts", WS)).toBe(false);
    expect(escapesWorkspace("/Users/me/proj", WS)).toBe(false); // the root itself
    expect(escapesWorkspace("/etc/passwd", WS)).toBe(true);
    expect(escapesWorkspace("/Users/me/project2/x", WS)).toBe(true); // prefix but not a subdir
  });
  test("escapesWorkspace: relative climbs and home", () => {
    expect(escapesWorkspace("src/a.ts", WS)).toBe(false);
    expect(escapesWorkspace("a/../b", WS)).toBe(false);
    expect(escapesWorkspace("../secret", WS)).toBe(true);
    expect(escapesWorkspace("a/../../b", WS)).toBe(true);
    expect(escapesWorkspace("~/.ssh/id_rsa", WS)).toBe(true);
  });
  test("a file tool reaching outside the workspace ASKS — even a read", () => {
    expect(evaluate(EMPTY_RULES, call("read", { path: "/etc/passwd" }))).toMatchObject({
      action: "ask", source: "outside-workspace", outsidePath: "/etc/passwd",
    });
    expect(evaluate(EMPTY_RULES, call("write", { path: "../escape.txt" }))).toMatchObject({
      action: "ask", source: "outside-workspace",
    });
  });
  test("in-workspace file tools keep their defaults", () => {
    expect(evaluate(EMPTY_RULES, call("read", { path: "src/a.ts" }))).toEqual({ action: "allow", source: "safe-default" });
    // Round 29: an in-workspace edit is a safe default too.
    expect(evaluate(EMPTY_RULES, call("write", { path: "src/a.ts" }))).toEqual({ action: "allow", source: "safe-default" });
  });
  test("bash is NOT path-confined (stays under command rules)", () => {
    expect(evaluate(EMPTY_RULES, call("bash", { command: "cat /etc/passwd" }))).toEqual({ action: "ask", source: "default" });
  });
  test("an explicit allow rule overrides confinement", () => {
    const r = rules([{ layer: "tool", pattern: "read", action: "allow" }]);
    expect(evaluate(r, call("read", { path: "/etc/passwd" }))).toMatchObject({ action: "allow", source: "rule" });
  });
  test("a deny rule still denies an outside path", () => {
    const r = rules([{ layer: "tool", pattern: "read", action: "deny" }]);
    expect(evaluate(r, call("read", { path: "/etc/passwd" }))).toMatchObject({ action: "deny", source: "rule" });
  });
});

describe("tool layer", () => {
  test("exact tool name match", () => {
    const r = rules([{ layer: "tool", pattern: "bash", action: "deny" }]);
    expect(evaluate(r, call("bash", { command: "ls" }))).toMatchObject({ action: "deny", source: "rule" });
    expect(evaluate(r, call("write", { path: ".env" }))).toMatchObject({ action: "ask", source: "default" });
  });
  test("glob tool pattern", () => {
    const r = rules([{ layer: "tool", pattern: "*", action: "deny" }]);
    expect(evaluate(r, call("read", { path: "x" })).action).toBe("deny"); // rule beats safe-default
  });
  test("allow rule on a non-safe tool", () => {
    const r = rules([{ layer: "tool", pattern: "write", action: "allow" }]);
    expect(evaluate(r, call("write", { path: "x" }))).toMatchObject({ action: "allow", source: "rule" });
  });
});

describe("command layer", () => {
  test("glob matches across spaces", () => {
    const r = rules([{ layer: "command", pattern: "git push*", action: "ask" }]);
    expect(evaluate(r, call("bash", { command: "git push origin main" })).action).toBe("ask");
    expect(evaluate(r, call("bash", { command: "git status" })).source).not.toBe("rule");
  });
  test("leading/trailing whitespace in the command is trimmed", () => {
    const r = rules([{ layer: "command", pattern: "rm *", action: "deny" }]);
    expect(evaluate(r, call("bash", { command: "  rm -rf / " })).action).toBe("deny");
  });
  test("? matches exactly one char", () => {
    const r = rules([{ layer: "command", pattern: "make -j?", action: "allow" }]);
    expect(evaluate(r, call("bash", { command: "make -j4" })).action).toBe("allow");
    expect(evaluate(r, call("bash", { command: "make -j16" })).source).toBe("default");
  });
  test("no command arg → command rules never match", () => {
    const r = rules([{ layer: "command", pattern: "*", action: "deny" }]);
    expect(evaluate(r, call("write", { path: ".env" })).source).toBe("default");
  });
  test("regex specials in patterns are literal", () => {
    const r = rules([{ layer: "command", pattern: "echo (hi)", action: "deny" }]);
    expect(evaluate(r, call("bash", { command: "echo (hi)" })).action).toBe("deny");
    expect(evaluate(r, call("bash", { command: "echo hi" })).source).not.toBe("rule");
  });
});

describe("path layer", () => {
  const denyEnv = rules([{ layer: "path", pattern: ".env*", action: "deny" }]);
  test("relative path arg matches", () => {
    expect(evaluate(denyEnv, call("write", { path: ".env" })).action).toBe("deny");
    expect(evaluate(denyEnv, call("write", { path: ".env.local" })).action).toBe("deny");
  });
  test("absolute path inside the workspace is relativized", () => {
    expect(evaluate(denyEnv, call("read", { path: `${WS}/.env` })).action).toBe("deny");
  });
  test("* stays within a segment; ** crosses segments", () => {
    const star = rules([{ layer: "path", pattern: "src/*.ts", action: "allow" }]);
    expect(evaluate(star, call("write", { path: "src/a.ts" })).action).toBe("allow");
    expect(evaluate(star, call("write", { path: "src/deep/a.ts" })).source).not.toBe("rule");
    const dstar = rules([{ layer: "path", pattern: "src/**", action: "allow" }]);
    expect(evaluate(dstar, call("write", { path: "src/deep/a.ts" })).action).toBe("allow");
  });
  test("matches any file-ish input key", () => {
    const r = rules([{ layer: "path", pattern: "secrets/**", action: "deny" }]);
    expect(evaluate(r, call("edit", { file_path: "secrets/k.pem" })).action).toBe("deny");
    expect(evaluate(r, call("x", { directory: "secrets/sub" })).action).toBe("deny");
  });
  test("no path-ish args → path rules never match", () => {
    const r = rules([{ layer: "path", pattern: "**", action: "deny" }]);
    expect(evaluate(r, call("bash", { command: "ls" })).source).not.toBe("rule");
  });
  test("absolute path outside the workspace still matches absolute patterns", () => {
    const r = rules([{ layer: "path", pattern: "/etc/**", action: "deny" }]);
    expect(evaluate(r, call("read", { path: "/etc/passwd" })).action).toBe("deny");
  });
});

describe("most-restrictive-wins across layers and scopes", () => {
  test("deny > ask > allow among matching rules", () => {
    const r = rules([
      { layer: "tool", pattern: "bash", action: "allow" },
      { layer: "command", pattern: "git *", action: "ask" },
      { layer: "command", pattern: "git push*", action: "deny" },
    ]);
    expect(evaluate(r, call("bash", { command: "git push" })).action).toBe("deny");
    expect(evaluate(r, call("bash", { command: "git status" })).action).toBe("ask");
    expect(evaluate(r, call("bash", { command: "ls" })).action).toBe("allow");
  });
  test("workspace deny beats global allow", () => {
    const r = rules(
      [{ layer: "tool", pattern: "bash", action: "allow" }],
      { [WS]: [{ layer: "tool", pattern: "bash", action: "deny" }] },
    );
    const v = evaluate(r, call("bash", { command: "ls" }));
    expect(v.action).toBe("deny");
    expect(v.rule?.scope).toBe("workspace");
  });
  test("global deny beats workspace allow (restrictive wins regardless of scope)", () => {
    const r = rules(
      [{ layer: "tool", pattern: "bash", action: "deny" }],
      { [WS]: [{ layer: "tool", pattern: "bash", action: "allow" }] },
    );
    expect(evaluate(r, call("bash", { command: "ls" })).action).toBe("deny");
  });
  test("other workspaces' rules are ignored", () => {
    const r = rules([], { "/other/ws": [{ layer: "tool", pattern: "*", action: "deny" }] });
    expect(evaluate(r, call("read", { path: "x" }))).toMatchObject({ action: "allow", source: "safe-default" });
  });
  test("verdict carries the winning rule for the audit trail", () => {
    const r = rules([{ layer: "command", pattern: "rm *", action: "deny" }]);
    const v = evaluate(r, call("bash", { command: "rm -rf x" }));
    expect(v.rule).toMatchObject({ layer: "command", pattern: "rm *", action: "deny", scope: "global" });
  });
});

describe("parseRulesFile", () => {
  test("round-trips a valid file", () => {
    const f = rules(
      [{ layer: "tool", pattern: "bash", action: "ask" }],
      { [WS]: [{ layer: "path", pattern: ".env", action: "deny" }] },
    );
    expect(parseRulesFile(JSON.stringify(f))).toEqual(f);
  });
  test("drops malformed rules, keeps valid ones", () => {
    const f = parseRulesFile(JSON.stringify({
      global: [
        { layer: "tool", pattern: "bash", action: "deny" },
        { layer: "nope", pattern: "x", action: "deny" },
        { layer: "tool", pattern: "", action: "deny" },
        { layer: "tool", pattern: "x", action: "maybe" },
        "garbage",
      ],
      workspaces: { [WS]: [{ layer: "command", pattern: "*", action: "ask" }], bad: "not-an-array" },
    }));
    expect(f.global).toHaveLength(1);
    expect(f.workspaces[WS]).toHaveLength(1);
    expect(f.workspaces.bad).toBeUndefined();
  });
  test("missing sections default to empty", () => {
    expect(parseRulesFile("{}")).toEqual(EMPTY_RULES);
  });
  test("invalid JSON throws", () => {
    expect(() => parseRulesFile("not json")).toThrow();
    expect(() => parseRulesFile("null")).toThrow();
  });
});

describe("globToRegExp anchoring", () => {
  test("patterns match the whole string, not a substring", () => {
    expect(globToRegExp("git", "command").test("git push")).toBe(false);
    expect(globToRegExp("a.ts", "path").test("xa.ts")).toBe(false);
    expect(globToRegExp("a.ts", "path").test("aXts")).toBe(false); // "." is literal
  });
});

/**
 * PRD §4 (Windows round): a path rule has to match a Windows path.
 *
 * globToRegExp's path mode is built from `[^/]`, so a `src/**` rule could never match
 * `C:\ws\src\a.ts` — and `*` would span every segment instead of one. The user writes
 * a rule, the Permissions page shows it, and it silently applies to nothing. The
 * outside-workspace ask had the mirror bug: `escapesWorkspace` treated a
 * drive-letter path as RELATIVE, counted its `..` depth (zero), and answered "inside".
 *
 * `caseInsensitivePaths` is set by the CALLER (the bridge from process.platform, main
 * from the platform seam) — the engine stays import-free and platform-agnostic.
 */
describe("path rules on Windows paths", () => {
  const ws = "C:\\Users\\G\\ws";
  const deny = { global: [{ layer: "path" as const, pattern: "src/**", action: "deny" as const }], workspaces: {} };
  const none = { global: [], workspaces: {} };

  test("a src/** rule matches a backslash path under the workspace", () => {
    const v = evaluate(deny, {
      tool: "write",
      input: { path: "C:\\Users\\G\\ws\\src\\a.ts" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.action).toBe("deny");
    expect(v.source).toBe("rule");
  });

  test("and matches whatever case the model writes", () => {
    const v = evaluate(deny, {
      tool: "write",
      input: { path: "c:/users/g/WS/SRC/a.ts" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.action).toBe("deny");
  });

  test("does NOT fold case on a case-sensitive platform", () => {
    const v = evaluate(
      { global: [{ layer: "path", pattern: "src/**", action: "deny" }], workspaces: {} },
      { tool: "write", input: { path: "/tmp/ws/SRC/a.ts" }, workspace: "/tmp/ws" },
    );
    expect(v.source).not.toBe("rule");
  });

  test("a path on another drive is OUTSIDE, not a zero-depth relative path", () => {
    const v = evaluate(none, {
      tool: "read",
      input: { path: "D:\\other\\x.txt" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.source).toBe("outside-workspace");
  });

  test("a sibling sharing a prefix is outside", () => {
    const v = evaluate(none, {
      tool: "read",
      input: { path: "C:\\Users\\G\\ws-evil\\x" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.source).toBe("outside-workspace");
  });

  test("a path inside the workspace is not flagged, whatever its separators", () => {
    const v = evaluate(none, {
      tool: "read",
      input: { path: "c:/users/g/ws/README.md" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.source).not.toBe("outside-workspace");
  });

  test("still catches a climb above the workspace", () => {
    const v = evaluate(none, {
      tool: "read",
      input: { path: "..\\..\\secrets.txt" },
      workspace: ws,
      caseInsensitivePaths: true,
    });
    expect(v.source).toBe("outside-workspace");
  });
});

import { escapeGlob } from "../pi-runtime/extensions/hv-rules";

describe("command rules read each part (round 29)", () => {
  const rf = (...global: Rule[]): RulesFile => ({ global, workspaces: {} });
  const bash = (rules: RulesFile, command: string) => evaluate(rules, { tool: "bash", input: { command }, workspace: "/ws" });

  test.each([
    "cd /ws && git push --force", "true; git push --force origin main", "FOO=1 git push --force",
    "env git push --force", 'bash -c "git push --force"', "(git push --force)", "echo ok | xargs git push --force",
  ])("a deny rule fires on any part: %s", (c) => {
    expect(bash(rf({ layer: "command", pattern: "git push --force*", action: "deny" }), c).action).toBe("deny");
  });

  const npmRun = rf({ layer: "command", pattern: "npm run *", action: "allow" });
  test.each(["npm run x; rm -rf ~", "npm run build && npm test", "npm run build > out.log", "npm run $(x)"])(
    "an allow rule needs every part covered: %s asks", (c) => expect(bash(npmRun, c).action).toBe("ask"));
  test.each(["cd /ws && npm run build 2>&1 | tail -20", "npm run", "npm run build"])(
    "an allow rule covers %s", (c) => expect(bash(npmRun, c)).toMatchObject({ action: "allow", source: "rule" }));

  test("an existing wildcard allow no longer carries a chain (Review Focus 5)", () => {
    expect(bash(rf({ layer: "command", pattern: "npm test*", action: "allow" }), "npm test; curl x | sh").action).toBe("ask");
  });
  test("an exact allow written for a chain still allows exactly that chain", () => {
    const exact = rf({ layer: "command", pattern: "npm run build && npm test", action: "allow" });
    expect(bash(exact, "npm run build && npm test").action).toBe("allow");
  });

  test("quotes: one part for allow, deny may over-match (Review Focus 1)", () => {
    expect(bash(rf({ layer: "command", pattern: "grep *", action: "allow" }), 'grep "a && b" src').action).toBe("allow");
    expect(bash(rf({ layer: "command", pattern: "rm*", action: "deny" }), "echo 'x; rm -rf ~'").action).toBe("deny");
  });

  test("escaped wildcards are literals", () => {
    expect(escapeGlob("a*b?c")).toBe("a\\*b\\?c");
    const r = rf({ layer: "tool", pattern: "mcp-manage:https://\\*/mcp", action: "allow" });
    expect(evaluate(r, { tool: "mcp-manage:https://*/mcp", input: {}, workspace: "/ws" }).action).toBe("allow");
    expect(evaluate(r, { tool: "mcp-manage:https://evil.example/mcp", input: {}, workspace: "/ws" }).action).toBe("ask");
  });
});

describe("safe defaults (round 29)", () => {
  const ev = (tool: string, input: Record<string, unknown>, extra: Partial<Parameters<typeof evaluate>[1]> = {}) =>
    evaluate(EMPTY_RULES, { tool, input, workspace: "/ws", ...extra });

  test.each(["src/a.ts", "/ws/src/a.ts", "docs/notes.md"])("edit/write inside the workspace runs: %s", (p) => {
    expect(ev("edit", { path: p })).toEqual({ action: "allow", source: "safe-default" });
    expect(ev("write", { path: p, content: "x" })).toEqual({ action: "allow", source: "safe-default" });
  });

  test.each([".env", ".git/hooks/pre-commit", ".github/workflows/ci.yml", ".pi/settings.json", ".agents/plans/001-x.md",
    "AGENTS.md", "packages/api/AGENTS.md", "agents.md", "CLAUDE.md"])("a protected path still asks: %s", (p) => {
    expect(ev("edit", { path: p })).toEqual({ action: "ask", source: "default" });
  });

  test.each(["../x.ts", "/tmp/x.ts", "~/x.ts"])("outside the workspace asks: %s", (p) => {
    expect(ev("write", { path: p })).toMatchObject({ action: "ask", source: "outside-workspace" });
  });

  test("a symlink that lands outside asks (Review Focus 3)", () => {
    const realPath = (p: string): string => p.replace("/ws/link", "/tmp");
    expect(ev("write", { path: "/ws/link/a.txt" }, { realPath }).action).toBe("ask");
    expect(ev("write", { path: "link/a.txt" }, { realPath }).action).toBe("ask");
  });

  test("windows paths, case-insensitive (Review Focus 4)", () => {
    const win = { workspace: "C:\\ws", caseInsensitivePaths: true };
    expect(ev("edit", { path: "C:\\ws\\.git\\config" }, win).action).toBe("ask");
    expect(ev("edit", { path: "c:/ws/src/a.ts" }, win).action).toBe("allow");
  });

  test("an explicit ask rule on edit still wins", () => {
    const rules: RulesFile = { global: [{ layer: "tool", pattern: "edit", action: "ask" }], workspaces: {} };
    expect(evaluate(rules, { tool: "edit", input: { path: "src/a.ts" }, workspace: "/ws" })).toMatchObject({ action: "ask", source: "rule" });
  });

  test("read-only bash runs; anything else, and other shells, ask", () => {
    expect(ev("bash", { command: "git status" }, { workspaceHasGit: true })).toEqual({ action: "allow", source: "safe-default" });
    expect(ev("bash", { command: "cat ~/.ssh/id_rsa" })).toEqual({ action: "ask", source: "default" });
    expect(ev("powershell", { command: "ls" }).action).toBe("ask");
    expect(ev("terminal_run", { command: "ls" }).action).toBe("ask");
  });
});

import { parseGrants } from "../pi-runtime/extensions/hv-rules";

describe("parseGrants (round 29)", () => {
  test("a JSON array of names; anything else is no grant at all", () => {
    expect(parseGrants('["bash"]')).toEqual(["bash"]);
    expect(parseGrants("nope")).toEqual([]);
    expect(parseGrants(undefined)).toEqual([]);
    expect(parseGrants('[1,""]')).toEqual([]);
    expect(parseGrants('{"a":1}')).toEqual([]);
  });
});

import { commandGrantPatterns, grantRules } from "../pi-runtime/extensions/hv-rules";

describe("commandGrantPatterns (round 29)", () => {
  const g = (c: string) => commandGrantPatterns(c, "/ws");
  test.each([
    ["npm run build", ["npm run *"]],
    ["cd /ws && npm run build 2>&1 | tail -20", ["npm run *"]],
    ["npm run build && npm test", ["npm run *", "npm test *"]],
    ["node scripts/x.mjs", ["node scripts/x.mjs *"]],
    ["python3 -m pytest -q", ["python3 -m pytest *"]],
    ["git commit -m x", ["git commit *"]],
    ["ls", []],
  ] as const)("%s → %j", (c, want) => expect(g(c)).toEqual(want));

  test.each(['bash -c "x"', "sudo rm x", "FOO=1 npm test", "npm run $(x)", "cat <<EOF\nx\nEOF", "npm run build > out.log", "env npm test", "xargs rm"])(
    "no pattern is safe to offer: %s", (c) => expect(g(c)).toBeNull());

  test("a literal * in the command is saved escaped", () => {
    expect(g("./run*.sh")).toEqual(["./run\\*.sh *"]);
  });
});

describe("grantRules — what a one-click grant writes (round 29)", () => {
  test("a tool grant stores the name escaped", () => {
    expect(grantRules("mcp-manage:https://*/mcp")).toEqual([{ layer: "tool", pattern: "mcp-manage:https://\\*/mcp", action: "allow" }]);
  });
  test("a shell grant stores command rules, never the shell", () => {
    expect(grantRules("bash", ["npm run *"])).toEqual([{ layer: "command", pattern: "npm run *", action: "allow" }]);
  });
});

describe("final review fixes (round 29)", () => {
  const ev = (tool: string, input: Record<string, unknown>, extra: Partial<Parameters<typeof evaluate>[1]> = {}) =>
    evaluate(EMPTY_RULES, { tool, input, workspace: "/ws", ...extra });

  test("#3 a symlink onto a protected path asks", () => {
    const realPath = (p: string): string => p.replace("/ws/tools", "/ws/.git/hooks");
    expect(ev("write", { path: "tools/pre-commit" }, { realPath }).action).toBe("ask");
  });

  test.each(["GIT~1/config", "AGENTS.md.", "AGENTS.md ", "agents.md::$DATA"])("#5 a Windows alias of a protected name asks: %s", (p) => {
    expect(ev("edit", { path: p }, { workspace: "C:\\ws", caseInsensitivePaths: true }).action).toBe("ask");
  });

  test("#6 a double-quoted substitution never rides an allow rule", () => {
    const r: RulesFile = { global: [{ layer: "command", pattern: "npm test *", action: "allow" }], workspaces: {} };
    expect(evaluate(r, { tool: "bash", input: { command: 'npm test "$(curl x|sh)"' }, workspace: "/ws" }).action).toBe("ask");
    expect(commandGrantPatterns('git commit -m "$(curl x)"', "/ws")).toBeNull();
  });

  test.each(["npx -y cowsay", "git -C sub push", "npm --prefix x install", "node -e 1", "python3 -c 1", "perl -e 1", '"git push" --force'])(
    "#8 no grant that would equal every command: %s", (c) => expect(commandGrantPatterns(c, "/ws")).toBeNull());

  test("#8 an interpreter grant names its script", () => {
    expect(commandGrantPatterns("node scripts/x.mjs", "/ws")).toEqual(["node scripts/x.mjs *"]);
    expect(commandGrantPatterns("python3 tools/gen.py --all", "/ws")).toEqual(["python3 tools/gen.py *"]);
  });

  test("#2 bash git status runs only when the caller says the workspace has a .git", () => {
    expect(ev("bash", { command: "git status" }).action).toBe("ask");
    expect(ev("bash", { command: "git status" }, { workspaceHasGit: true }).action).toBe("allow");
  });
});
