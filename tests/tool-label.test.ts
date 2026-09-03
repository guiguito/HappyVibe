import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { toolLabel, brandIconFor, BRAND_ICONS, describeSubagentArtifact } from "../src/renderer/src/toolLabel";
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

// ── Round 15: the browser card leads with the model's intent ────────────────
// §28 deliberately headlined the URL even when an intent existed ("where the
// agent went is the fact worth reading"). Reversed for the CARD only: the
// permission prompt still summarizes as the URL, which is what makes the card
// free to be a headline. The URL rides `path`, the same slot edit/write use, so
// ToolCard's existing chip renders it with no new machinery.
test("browser_open leads with intent and demotes the URL to the chip", () => {
  const l = toolLabel("browser_open", {
    intent: "Opening the game page to test it.",
    url: "http://localhost:8000/minesweeper.html",
  });
  expect(l.label).toBe("Opening the game page to test it.");
  expect(l.path).toBe("http://localhost:8000/minesweeper.html");
});

test("browser_navigate leads with intent too", () => {
  const l = toolLabel("browser_navigate", { intent: "Checking the docs page.", url: "https://example.org/a" });
  expect(l.label).toBe("Checking the docs page.");
  expect(l.path).toBe("https://example.org/a");
});

test("without an intent the browser card keeps its derived URL headline", () => {
  const l = toolLabel("browser_open", { url: "http://localhost:8000/minesweeper.html" });
  expect(l.label).toBe("Opening localhost:8000/minesweeper.html");
  expect(l.path).toBeUndefined();
});

// ── Sub-agent artifacts read back by the model ───────────────────────────────
// pi-subagents 0.50 truncates the completion payload at a hardcoded 1,000 chars,
// so the model routinely fetches the full result from disk. That surfaced in the
// transcript as "Reading 7753ae03_code-explorer_0_output.md" — our plumbing, in
// the user's face, looking like a leak.

const ARTIFACTS = "/Users/x/Library/Application Support/HappyVibe/sessions/subagent-artifacts";

test("names the agent instead of the generated filename", () => {
  // Verbatim from a real session (2026-08-18).
  expect(toolLabel("read", { path: `${ARTIFACTS}/7753ae03_code-explorer_0_output.md` }).label)
    .toBe("Reading code-explorer's full report");
});

test("distinguishes the other artifact kinds", () => {
  const at = (f: string): string => toolLabel("read", { path: `${ARTIFACTS}/${f}` }).label;
  expect(at("7753ae03_code-explorer_0_input.md")).toBe("Reading the task given to code-explorer");
  expect(at("7753ae03_code-explorer_0_transcript.jsonl")).toBe("Reading code-explorer's transcript");
  expect(at("7753ae03_code-explorer_0_meta.json")).toBe("Reading code-explorer's run details");
});

test("drops the path chip for an artifact, keeps it for a real file", () => {
  // The chip opens files in the editor; an artifact lives in Application Support,
  // not the user's project, so offering to open it is a dead end.
  expect(toolLabel("read", { path: `${ARTIFACTS}/7753ae03_code-explorer_0_output.md` }).path).toBeUndefined();
  expect(toolLabel("read", { path: "/repo/src/app.ts" }).path).toBe("/repo/src/app.ts");
});

test("an ordinary file the user asked about is untouched", () => {
  expect(toolLabel("read", { path: "/repo/src/output.md" }).label).toBe("Reading output.md");
  // Same NAME, but not in the artifacts dir — the directory is what qualifies it.
  expect(describeSubagentArtifact("/repo/notes/7753ae03_code-explorer_0_output.md")).toBeNull();
});

test("copes with an index-less name and an agent containing underscores", () => {
  // getArtifactPaths omits the suffix when index is undefined, and replaces
  // non-word characters in the agent with "_", so both shapes are real.
  expect(describeSubagentArtifact(`${ARTIFACTS}/abc123_researcher_output.md`))
    .toBe("Reading researcher's full report");
  expect(describeSubagentArtifact(`${ARTIFACTS}/abc123_agents_md_maker_0_output.md`))
    .toBe("Reading agents_md_maker's full report");
});

test("returns null rather than guessing at an unknown shape", () => {
  expect(describeSubagentArtifact(`${ARTIFACTS}/not-an-artifact.md`)).toBeNull();
  expect(describeSubagentArtifact(`${ARTIFACTS}/abc123_agent_0_unknownkind.md`)).toBeNull();
  expect(describeSubagentArtifact("")).toBeNull();
});

// Housekeeping #6 — the permission modal is the only caller that passes a
// virtual RULE name (happyvibe-bridge.ts `permTool`) rather than a tool name.
// The tail is an identifier the user typed, a hostname, or a server's tool id.

test("renders a virtual rule name verbatim instead of prettifying it", () => {
  // Was "Subagent:code explorer" — title-cased, hyphen eaten — in the headline
  // of the very prompt that grants the delegation.
  expect(toolLabel("subagent:code-explorer", undefined).label).toBe("Sub-agent: code-explorer");
  expect(toolLabel("mcp:github_create_issue", undefined).label).toBe("MCP: github_create_issue");
  expect(toolLabel("browser:example.org", undefined).label).toBe("Browser: example.org");
});

test("a rule name keeps its own colons, and the bare tools are unaffected", () => {
  // Split on the FIRST colon only: an MCP tool id may contain one.
  expect(toolLabel("mcp:linear_issue:update", undefined).label).toBe("MCP: linear_issue:update");
  // The bare tool names still take their switch cases (cards, not the modal).
  expect(toolLabel("subagent", { agent: "code-explorer" }).label).toBe("Delegating to code-explorer");
  // An unknown prefix is not a rule name — it must not be swallowed by the guard.
  expect(toolLabel("weird:thing", undefined).label).toBe("Weird:thing");
});

test("§31: document_read leads with the model's sentence and falls back to the file name", () => {
  expect(toolLabel("document_read", { path: "/x/report.docx", intent: "Looking for the pricing table" }).label)
    .toBe("Looking for the pricing table");
  const l = toolLabel("document_read", { path: "/x/report.docx" });
  expect(l.label).toBe("Reading report.docx");
  expect(l.icon).toBe("eye");
  // The path rides through so the card can offer Reveal in Finder.
  expect(l.path).toBe("/x/report.docx");
});

test("§31: document_read degrades to a sentence when the model sent no path", () => {
  expect(toolLabel("document_read", {}).label).toBe("Reading a document");
});
