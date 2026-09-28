import { describe, expect, it } from "vitest";
import { knownProviders, mcpParams, modelParams, scheduleParams } from "../src/main/usage/mappers";
import { checkEvent } from "../src/main/usage/guard";

describe("§39 mappers — shipped ids or `custom`", () => {
  it("a catalog provider keeps its ids; a custom endpoint or runner is custom", () => {
    expect(knownProviders().has("openrouter")).toBe(true);
    expect(modelParams("openrouter", "deepseek/deepseek-v4-flash")).toEqual({ provider: "openrouter", model: "deepseek:deepseek-v4-flash" });
    expect(modelParams("my-endpoint", "my model")).toEqual({ provider: "custom", model: "custom" });
    expect(modelParams("lmstudio", "qwen3-8b")).toEqual({ provider: "custom", model: "custom" });
    expect(modelParams("openrouter", "weird model id with spaces")).toEqual({ provider: "openrouter", model: "custom" });
  });
  it("OAuth-only providers are known too", () => {
    expect(knownProviders().has("openai-codex")).toBe(true);
  });
  it("MCP: transport from command vs url, auth from the catalog or headers, a typed name is never sent", () => {
    expect(mcpParams("manual", { command: "npx" })).toEqual({ source: "manual", server: "custom", transport: "stdio", auth: "none" });
    expect(mcpParams("manual", { url: "https://x", headers: { Authorization: "k" } })).toEqual({ source: "manual", server: "custom", transport: "http", auth: "key" });
    expect(mcpParams("catalog", { url: "https://x" }, { id: "github", auth: "oauth" })).toEqual({ source: "catalog", server: "github", transport: "http", auth: "oauth" });
  });
  it("schedules", () => {
    expect(scheduleParams({ repeat: { kind: "weekdays" }, mode: "readonly" }, "agent")).toEqual({ recurrence: "weekdays", access: "readonly", source: "agent" });
  });
  it("everything passes the guard", () => {
    expect(checkEvent("model_changed", { ...modelParams("openrouter", "deepseek/deepseek-v4-flash"), scope: "session" }).ok).toBe(true);
    expect(checkEvent("mcp_server_added", mcpParams("manual", { command: "x" })).ok).toBe(true);
    expect(checkEvent("schedule_created", scheduleParams({ repeat: { kind: "once" }, mode: "full" }, "page")).ok).toBe(true);
  });
});
