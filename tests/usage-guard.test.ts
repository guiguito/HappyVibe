import { describe, expect, it } from "vitest";
import { checkEvent, usageBeforeSend } from "../src/main/usage/guard";

describe("§39 the guard", () => {
  it("accepts a valid event", () => {
    expect(checkEvent("bypass_changed", { on: true, scope: "global" })).toEqual({ ok: true, category: "trust", params: { on: true, scope: "global" } });
  });
  it("refuses an unknown name, an unknown param, a non-enum value, a wrong type", () => {
    expect(checkEvent("secret_event", {}).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: true, scope: "global", path: "/Users/me" }).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: true, scope: "everywhere" }).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: "yes", scope: "global" }).ok).toBe(false);
  });
  it("an id param takes a catalog-shaped id or custom — never a path, URL or sentence", () => {
    expect(checkEvent("model_changed", { provider: "openrouter", model: "deepseek/deepseek-v4-flash", scope: "global" }).ok).toBe(false);
    expect(checkEvent("model_changed", { provider: "openrouter", model: "deepseek:deepseek-v4-flash", scope: "global" }).ok).toBe(true);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "/Users/me/secret", transport: "stdio", auth: "none" }).ok).toBe(false);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "my server", transport: "stdio", auth: "none" }).ok).toBe(false);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "https://x.test", transport: "http", auth: "none" }).ok).toBe(false);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "custom", transport: "stdio", auth: "none" }).ok).toBe(true);
  });
  it("numbers must be finite", () => {
    expect(checkEvent("panel_opened", { panel: "context", contextPct: Number.NaN }).ok).toBe(false);
    expect(checkEvent("panel_opened", { panel: "context", contextPct: Infinity }).ok).toBe(false);
  });
  it("beforeSend drops the three bad shapes and passes standard events with only their own params", () => {
    expect(usageBeforeSend({ name: "nope", params: {} })).toBeNull();
    expect(usageBeforeSend({ name: "bypass_changed", params: { on: true, scope: "global", extra: 1 } })).toBeNull();
    expect(usageBeforeSend({ name: "bypass_changed", params: { on: true, scope: "moon" } })).toBeNull();
    expect(usageBeforeSend({ name: "app_started", params: { trigger: "launch", crashReporting: true } })).not.toBeNull();
    expect(usageBeforeSend({ name: "app_installed" })).not.toBeNull();
    expect(usageBeforeSend({ name: "app_started", params: { trigger: "launch", sneaky: "x" } })).toBeNull();
    expect(usageBeforeSend({ name: "screen_viewed", params: { screen: "privacy" } })).not.toBeNull();
    expect(usageBeforeSend({ name: "screen_viewed", params: { screen: "/Users/me" } })).toBeNull();
  });
});
