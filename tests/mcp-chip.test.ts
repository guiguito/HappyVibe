import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { mcpChipLabel, serversForWorkspace } from "../src/renderer/src/mcpChip";

/**
 * §7 round 21 — MCP joins skills and agents in the top bar, and leaves the `+`
 * menu. The workspace filter is a bug fix riding along.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

const row = (name: string, scope: "global" | "workspace", workspaceId: string | null, state: string) =>
  ({ name, scope, workspaceId, state });

test("global servers always count; a workspace server counts only for ITS workspace", () => {
  const all = [
    row("github", "global", null, "connected"),
    row("mine", "workspace", "/a", "connected"),
    row("theirs", "workspace", "/b", "connected"),
  ];
  expect(serversForWorkspace(all, "/a").map((r) => r.name)).toEqual(["github", "mine"]);
  expect(serversForWorkspace(all, "/b").map((r) => r.name)).toEqual(["github", "theirs"]);
});

test("with no workspace, only global servers count", () => {
  const all = [row("github", "global", null, "connected"), row("mine", "workspace", "/a", "connected")];
  expect(serversForWorkspace(all, null).map((r) => r.name)).toEqual(["github"]);
});

test("the label is connected-of-total", () => {
  expect(mcpChipLabel([row("a", "global", null, "connected"), row("b", "global", null, "failed")])).toBe("1/2 MCP");
  expect(mcpChipLabel([row("a", "global", null, "connected")])).toBe("1/1 MCP");
});

test("only `connected` counts as connected — needs-auth and checking do not", () => {
  const rows = ["connected", "needs-auth", "failed", "checking"].map((s, i) => row(`s${i}`, "global", null, s));
  // A server that needs auth is exactly the one the chip exists to surface;
  // counting it as connected would hide it.
  expect(mcpChipLabel(rows)).toBe("1/4 MCP");
});

test("the + menu no longer offers MCP", () => {
  // Absence, as a source scan: the no-DOM suite cannot fail on a row that
  // renders, and this row is what moving MCP to the top bar removes.
  const src = read("src/renderer/src/components/ChatView.tsx");
  expect(src).not.toMatch(/mcpSubOpen/);
  expect(src).not.toMatch(/v5: MCP submenu/);
});

test("the + menu is exactly the two attach rows", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  const menu = src.slice(src.indexOf("attachMenuOpen && ("), src.indexOf("§23: plan-mode toggle — read-only"));
  expect(menu).toContain("Attach image");
  expect(menu).toContain("Attach document");
  expect(menu).not.toContain("Edit AGENTS.md");
  expect(menu).not.toContain("Manage…");
});

test("the chip is rendered from the workspace-filtered rows, not the raw list", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  expect(src).toMatch(/serversForWorkspace\(mcpServers, workspace \?\? null\)/);
  expect(src).toMatch(/<McpChip rows=\{mcpRows\}/);
  // Live, not fetched-when-a-submenu-opens: the count has to be right at a glance.
  expect(src).toMatch(/onMcpStatusChanged\(setMcpServers\)/);
});
