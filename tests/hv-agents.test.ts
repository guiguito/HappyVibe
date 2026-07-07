import { describe, expect, test } from "vitest";
import {
  duplicateName,
  editAgentFile,
  joinToolPermissions,
  parseAgentFile,
  serializeAgentFile,
  toAgentDef,
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
