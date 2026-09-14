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
    expect(evaluate(EMPTY_RULES, call("bash", { command: "ls" }))).toEqual({ action: "ask", source: "default" });
    expect(evaluate(EMPTY_RULES, call("write", { path: "a.txt" }))).toEqual({ action: "ask", source: "default" });
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
    expect(evaluate(EMPTY_RULES, call("write", { path: "src/a.ts" }))).toEqual({ action: "ask", source: "default" });
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
    expect(evaluate(r, call("write", { path: "x" }))).toMatchObject({ action: "ask", source: "default" });
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
    expect(evaluate(r, call("bash", { command: "git status" })).source).toBe("default");
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
    expect(evaluate(r, call("write", { path: "a.txt" })).source).toBe("default");
  });
  test("regex specials in patterns are literal", () => {
    const r = rules([{ layer: "command", pattern: "echo (hi)", action: "deny" }]);
    expect(evaluate(r, call("bash", { command: "echo (hi)" })).action).toBe("deny");
    expect(evaluate(r, call("bash", { command: "echo hi" })).source).toBe("default");
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
    expect(evaluate(star, call("write", { path: "src/deep/a.ts" })).source).toBe("default");
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
    expect(evaluate(r, call("bash", { command: "ls" })).source).toBe("default");
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
