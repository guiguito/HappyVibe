import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { toolLabel, brandIconFor, BRAND_ICONS } from "../src/renderer/src/toolLabel";
import { MCP_CATALOG } from "../src/main/mcpCatalog";

// W1.1 — human headlines for tool cards (PRD "Chat experience").

// V2.A: bash goes through describeCommand (parsed explanations, destructive
// flag) — exhaustive parser coverage lives in tests/describe-command.test.ts;
// here we assert the toolLabel integration.
test("bash → parsed explanation via describeCommand", () => {
  expect(toolLabel("bash", { command: "npm install" })).toEqual({ icon: "terminal", label: "Installing dependencies…" });
  expect(toolLabel("bash", { command: "git status -sb" })).toEqual({ icon: "terminal", label: "Checking git status" });
  // unknown commands keep the honest Running: <truncated> fallback
  const long = "x".repeat(200);
  expect(toolLabel("bash", { command: long }).label).toBe(`Running: ${"x".repeat(60)}…`);
});

test("bash destructive commands carry destructive: true", () => {
  expect(toolLabel("bash", { command: "rm -rf dist" })).toEqual({
    icon: "terminal",
    label: "Deleting dist",
    destructive: true,
  });
  // non-destructive commands DON'T carry the field (exact shape preserved)
  expect(toolLabel("bash", { command: "npm test" })).toEqual({ icon: "terminal", label: "Running tests" });
});

// W2.2: file-ish tools also expose `path` — ToolCard turns it into the
// clickable path chip (the label keeps just the basename).
test("edit → Editing <basename> + path", () => {
  expect(toolLabel("edit", { path: "src/app/main.ts" })).toEqual({
    icon: "edit",
    label: "Editing main.ts",
    path: "src/app/main.ts",
  });
});

test("write → Creating <basename> + path", () => {
  expect(toolLabel("write", { path: "/tmp/notes.md", content: "hi" })).toEqual({
    icon: "file-plus",
    label: "Creating notes.md",
    path: "/tmp/notes.md",
  });
});

test("read → Reading <basename> + path", () => {
  expect(toolLabel("read", { path: "docs/prd.md" })).toEqual({ icon: "eye", label: "Reading prd.md", path: "docs/prd.md" });
});

test("grep/find → Searching for <pattern>", () => {
  expect(toolLabel("grep", { pattern: "TODO", path: "src" })).toEqual({ icon: "search", label: "Searching for TODO" });
  expect(toolLabel("find", { pattern: "*.test.ts" })).toEqual({ icon: "search", label: "Searching for *.test.ts" });
});

test("ls → Listing <dir>", () => {
  expect(toolLabel("ls", { path: "src/renderer/" })).toEqual({ icon: "folder", label: "Listing renderer" });
  expect(toolLabel("ls", {})).toEqual({ icon: "folder", label: "Listing the current directory" });
});

test("subagent: intent takes precedence, else Delegating to <agent>", () => {
  expect(toolLabel("subagent", { agent: "code-explorer", task: "t", intent: "Mapping the auth flow" })).toEqual({
    icon: "robot",
    label: "Mapping the auth flow",
  });
  expect(toolLabel("subagent", { agent: "code-explorer", task: "t" })).toEqual({
    icon: "robot",
    label: "Delegating to code-explorer",
  });
  expect(toolLabel("subagent", {}).label).toBe("Delegating to a subagent");
});

test("unknown tool: intent when present, else prettified name", () => {
  expect(toolLabel("fetch_url-fast", {})).toEqual({ icon: "wrench", label: "Fetch url fast" });
  expect(toolLabel("my_tool", { intent: "Checking the weather" })).toEqual({
    icon: "wrench",
    label: "Checking the weather",
  });
});

test("missing/malformed args never throw — sensible fallbacks", () => {
  expect(toolLabel("bash", undefined).label).toBe("Running a command");
  expect(toolLabel("edit", "not-an-object").label).toBe("Editing a file");
  expect(toolLabel("write", null).label).toBe("Creating a file");
  expect(toolLabel("read", { path: "   " }).label).toBe("Reading a file");
  expect(toolLabel("grep", {}).label).toBe("Searching");
});

test("mcp proxy invoke → unwrapped label, never bare 'mcp'", () => {
  const l = toolLabel("mcp", { tool: "github_create_issue", args: "{}" });
  expect(l.label).toBe("MCP → github_create_issue");
  expect(l.icon).toBe("wrench");
});

test("mcp discovery → discovery label", () => {
  expect(toolLabel("mcp", { search: "screenshot" }).label).toBe('MCP discovery: search "screenshot"');
});

test("mcp: model-authored intent takes precedence over the derived label", () => {
  const l = toolLabel("mcp", {
    tool: "notion_fetch",
    args: '{"url":"https://notion.so/p/1"}',
    intent: "Fetching this page to check opinions",
  });
  expect(l.label).toBe("Fetching this page to check opinions");
  expect(l.icon).toBe("wrench");
});

test("mcp: without intent, falls back to the enriched factual display", () => {
  expect(toolLabel("mcp", { tool: "notion_fetch", args: '{"url":"https://notion.so/p/1"}' }).label).toBe(
    "MCP → notion_fetch: https://notion.so/p/1",
  );
});

// #4 (round-4 follow-up): brand icon resolution from the tool identifier.
test("mcp proxy call resolves a brand icon from the server prefix", () => {
  expect(toolLabel("mcp", { tool: "notion_create-pages", args: "{}" }).brand).toBe("si-notion");
  expect(toolLabel("mcp", { tool: "github_create_issue", args: "{}" }).brand).toBe("si-github");
});

test("brand resolution tolerates server-key variants and hyphens", () => {
  // notionApi_… → prefix-match "notion"; notion-mcp_… → token "notion"
  expect(toolLabel("mcp", { tool: "notionApi_create-pages", args: "{}" }).brand).toBe("si-notion");
  expect(toolLabel("mcp", { tool: "notion-mcp_fetch", args: "{}" }).brand).toBe("si-notion");
});

test("direct-mode MCP tool (not the proxy) still resolves its brand", () => {
  // In "expose tools directly" mode the tool name hits the default case.
  expect(toolLabel("notion_create-pages", {}).brand).toBe("si-notion");
});

test("non-brand tools carry no brand icon", () => {
  expect(toolLabel("ask_user", {}).brand).toBeUndefined();
  expect(toolLabel("mcp", { tool: "customserver_dostuff", args: "{}" }).brand).toBeUndefined();
});

// §13 round 8 — brand icons for the curated catalog's new entries. Only classes
// that actually ship in simple-icons v16 are mapped; the rest keep the generic
// MCP glyph, which is the documented fallback.
test("catalog servers added in round 8 resolve their brand icon", () => {
  expect(brandIconFor("n8n_list_nodes")).toBe("si-n8n");
  expect(brandIconFor("chrome_devtools_performance_trace")).toBe("si-googlechrome");
  expect(brandIconFor("shadcn_get_component")).toBe("si-shadcnui");
  expect(brandIconFor("neon_run_sql")).toBe("si-neon");
  // Context7 is an Upstash product and simple-icons ships si-upstash, not si-context7.
  expect(brandIconFor("context7_get_docs")).toBe("si-upstash");
});

test("catalog brands simple-icons does not ship fall back to the generic glyph", () => {
  expect(brandIconFor("firecrawl_scrape")).toBeUndefined();
  expect(brandIconFor("composio_execute")).toBeUndefined();
});

// Round 8: a mapped class that simple-icons does not ship renders as an
// INVISIBLE icon — strictly worse than the generic glyph fallback. Four dead
// entries (aws, openai, slack, playwright) shipped unnoticed from round 4 until
// a GUI pass caught Playwright's blank card. This pins the whole map to the
// installed font so the next simple-icons bump fails here instead of in the UI.
test("every BRAND_ICONS class exists in the installed simple-icons font", () => {
  const css = readFileSync(
    new URL("../node_modules/simple-icons-font/font/simple-icons.css", import.meta.url),
    "utf8",
  );
  const dead = Object.entries(BRAND_ICONS).filter(([, cls]) => !css.includes(`.${cls}:`));
  expect(dead, `dead icon classes: ${dead.map(([k, v]) => `${k}→${v}`).join(", ")}`).toEqual([]);
});

test("every catalog entry's brand icon exists too", () => {
  const css = readFileSync(
    new URL("../node_modules/simple-icons-font/font/simple-icons.css", import.meta.url),
    "utf8",
  );
  const dead = MCP_CATALOG.filter((e) => e.brand && !css.includes(`.${e.brand}:`));
  expect(dead.map((e) => `${e.key}→${e.brand}`)).toEqual([]);
});
