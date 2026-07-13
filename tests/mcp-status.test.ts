import { describe, it, expect } from "vitest";
import { statusKey } from "../src/main/mcpStatusKey";

describe("statusKey", () => {
  it("produces distinct keys per scope", () => {
    expect(statusKey("global", null, "fs")).not.toBe(statusKey("workspace", null, "fs"));
  });

  it("produces distinct keys per workspaceId", () => {
    expect(statusKey("workspace", "/a", "fs")).not.toBe(statusKey("workspace", "/b", "fs"));
  });

  it("produces distinct keys per name", () => {
    expect(statusKey("global", null, "fs")).not.toBe(statusKey("global", null, "git"));
  });

  it("is stable (same args → same key)", () => {
    expect(statusKey("global", null, "fs")).toBe(statusKey("global", null, "fs"));
    expect(statusKey("workspace", "/ws", "git")).toBe(statusKey("workspace", "/ws", "git"));
  });

  it("global scope uses empty string for workspaceId", () => {
    expect(statusKey("global", null, "fs")).toBe("global::fs");
  });

  it("workspace scope encodes workspaceId in key", () => {
    expect(statusKey("workspace", "/my/ws", "github")).toBe("workspace:/my/ws:github");
  });
});
