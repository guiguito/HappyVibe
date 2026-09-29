import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mcpChipTitle } from "../src/renderer/src/mcpChip";
import { RELOAD_NOTICE, reloadNotice } from "../src/renderer/src/reloadNotice";

/**
 * docs round #14 — three MCP-adjacent strings described the wrong thing:
 * "new sessions only" (idle sessions restart at once), "connected for this
 * session" (the number is main's own app-wide probe), and a reload notice that
 * named MCP whatever caused the reload.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
/** Comments stripped, whitespace collapsed — JSX wraps prose across lines (tests/go-to.test.ts). */
const rendered = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ");
const row = (state: string) => ({ name: state, scope: "global" as const, workspaceId: null, state });

describe("the MCP pages say what a change does to open sessions", () => {
  test("the behaviour the copy describes: idle sessions restart now, busy ones defer", () => {
    // The copy is only true while runMcpReloadPass does exactly this.
    expect(read("src/main/ipc.ts")).toMatch(
      /if \(activity\.isIdle\(id\)\) await reloadSession\(id\);[^\n]*\n\s*else pendingMcpReload\.add\(id\);/,
    );
  });

  test("the list header and the add/edit dialog say it, and 'new sessions' is gone", () => {
    const s = rendered("src/renderer/src/components/McpServersSection.tsx");
    expect(s).toContain("Open sessions restart to pick up a change once they're idle");
    expect(s).toContain("Open sessions restart to pick it up once they're idle.");
    expect(s).not.toMatch(/new sessions/);
  });
});

describe("the 🔌 chip's tooltip names whose check the number is", () => {
  test("n of m, in the MCP page's own words", () => {
    expect(mcpChipTitle([row("connected"), row("failed")])).toBe("1 of 2 MCP servers answered HappyVibe's check");
    expect(mcpChipTitle([row("connected")])).toBe("1 of 1 MCP server answered HappyVibe's check");
    expect(mcpChipTitle([row("needs-auth"), row("checking")])).toBe("0 of 2 MCP servers answered HappyVibe's check");
  });

  test("ChatView renders it and no longer claims a session connection", () => {
    const c = read("src/renderer/src/components/ChatView.tsx");
    expect(c).toContain("title={mcpChipTitle(rows)}");
    expect(c).not.toContain("connected for this session");
  });
});

describe("the reload notice names the change that caused it", () => {
  const reasons = [...read("src/main/ipc.ts").match(/type ReloadReason = ([^;]+);/)![1].matchAll(/"(\w+)"/g)].map(
    (m) => m[1],
  );

  test("one line per ReloadReason, derived from ipc.ts", () => {
    expect(reasons.length).toBeGreaterThan(0); // guard: not vacuous
    expect(Object.keys(RELOAD_NOTICE).sort()).toEqual([...reasons].sort());
  });

  test("every line keeps the reset warning; only the MCP one names MCP", () => {
    for (const r of reasons) {
      expect(reloadNotice(r), r).toMatch(/permission grants and dangerous mode reset to safe defaults\.$/);
      expect(/MCP/.test(reloadNotice(r)), r).toBe(r === "mcp");
    }
    expect(reloadNotice("something-new")).toMatch(/^Reloading to apply your changes — /);
  });

  test("a built-in tool toggle reloads as 'tools', not 'skills'", () => {
    const ipc = read("src/main/ipc.ts");
    expect(ipc).toMatch(/ipcMain\.handle\("hv:builtins-set"[\s\S]{0,900}?scheduleRuntimeReload\("tools", "global", null\)/);
    expect(ipc).not.toContain('scheduleRuntimeReload("skills", "global", null)');
  });

  test("App renders the notice from the reason main sends", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toContain("text: reloadNotice(reason)");
    expect(app).not.toContain("Reloading to apply MCP server changes");
  });
});
