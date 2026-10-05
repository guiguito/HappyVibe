import { describe, expect, it } from "vitest";
import { featureOfTool, toolKind } from "../src/main/usage/features";
import { USAGE_EVENTS } from "../src/main/usage/events";

describe("§39 tool → kind / feature", () => {
  it("maps the virtual rule names and built-ins", () => {
    expect(toolKind("bash")).toBe("bash");
    expect(toolKind("mcp:github_create")).toBe("mcp");
    expect(toolKind("mcp")).toBe("mcp");
    expect(toolKind("browser:docs.foo.com")).toBe("browser");
    expect(toolKind("subagent:explorer")).toBe("subagent");
    expect(toolKind("Agent")).toBe("subagent");
    expect(toolKind("web_fetch")).toBe("web");
    expect(toolKind("schedule_create")).toBe("schedule");
    expect(toolKind("something_new")).toBe("other");
  });
  it("every kind and feature it can return is in the catalog's enums", () => {
    const kinds = (USAGE_EVENTS.permission_answered.params.toolKind as { values: readonly string[] }).values;
    const feats = (USAGE_EVENTS.feature_used.params.feature as { values: readonly string[] }).values;
    for (const t of ["bash", "edit", "write", "read", "web_search", "web_fetch", "web_map", "web_crawl", "memory_save", "terminal_run", "browser_open", "ask_user", "schedule_create", "mcp", "mcp:x", "subagent:y", "Agent", "subagent", "workflow", "use_skill", "document_read"]) {
      expect(kinds, t).toContain(toolKind(t));
      const f = featureOfTool(t);
      if (f) expect(feats, t).toContain(f);
    }
    expect(featureOfTool("web_search")).toBe("web_search");
    expect(featureOfTool("web_fetch")).toBe("web_read");
    expect(featureOfTool("use_skill")).toBe("skill");
    expect(featureOfTool("bash")).toBeNull();
  });
  it("§13 (2026-10-05): Pi's MCP tool calls count as MCP; finding a tool is not a use", () => {
    expect(featureOfTool("mcp__linear__get_issue")).toBe("mcp_tool");
    expect(featureOfTool("read_mcp_resource")).toBe("mcp_tool");
    expect(toolKind("mcp__x__y")).toBe("mcp");
    expect(featureOfTool("tool_search")).toBeNull();
  });
});
