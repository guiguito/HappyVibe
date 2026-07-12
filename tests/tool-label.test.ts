import { expect, test } from "vitest";
import { toolLabel } from "../src/renderer/src/toolLabel";

// W1.1 — human headlines for tool cards (PRD "Chat experience").

test("bash → Running: <command>, truncated at ~60 chars", () => {
  expect(toolLabel("bash", { command: "npm test" })).toEqual({ icon: "terminal", label: "Running: npm test" });
  const long = "x".repeat(200);
  const { label } = toolLabel("bash", { command: long });
  expect(label).toBe(`Running: ${"x".repeat(60)}…`);
  // whitespace collapses so multi-line commands read as one line
  expect(toolLabel("bash", { command: "git  status\n  -sb" }).label).toBe("Running: git status -sb");
});

test("edit → Editing <basename> (<path>)", () => {
  expect(toolLabel("edit", { path: "src/app/main.ts" })).toEqual({
    icon: "edit",
    label: "Editing main.ts (src/app/main.ts)",
  });
});

test("write → Creating <basename>", () => {
  expect(toolLabel("write", { path: "/tmp/notes.md", content: "hi" })).toEqual({
    icon: "file-plus",
    label: "Creating notes.md",
  });
});

test("read → Reading <basename>", () => {
  expect(toolLabel("read", { path: "docs/prd.md" })).toEqual({ icon: "eye", label: "Reading prd.md" });
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
