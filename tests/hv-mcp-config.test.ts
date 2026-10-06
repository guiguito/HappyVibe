// tests/hv-mcp-config.test.ts
import { describe, expect, test } from "vitest";
import { isOff, toPiEntry, workspaceRegistrations } from "../pi-runtime/extensions/hv-mcp-config";

describe("toPiEntry", () => {
  test("adds the deferred default and nothing else to a plain entry", () => {
    expect(toPiEntry({ command: "npx", args: ["x"] })).toEqual({ entry: { command: "npx", args: ["x"], exposure: "deferred" }, changed: true });
  });
  test("is idempotent", () => {
    const once = toPiEntry({ url: "https://a/mcp", directTools: true }).entry;
    expect(toPiEntry(once)).toEqual({ entry: once, changed: false });
  });
  test("disabled:true becomes enabled:false; disabled:false just goes", () => {
    expect(toPiEntry({ url: "https://a/mcp", disabled: true }).entry).toEqual({ url: "https://a/mcp", enabled: false, exposure: "deferred" });
    expect(toPiEntry({ url: "https://a/mcp", disabled: false }).entry).toEqual({ url: "https://a/mcp", exposure: "deferred" });
  });
  test("directTools true → direct; a list → per-tool direct", () => {
    expect(toPiEntry({ url: "u", directTools: true }).entry).toMatchObject({ exposure: "direct" });
    expect(toPiEntry({ url: "u", directTools: ["a", "b"] }).entry).toMatchObject({ exposure: "deferred", toolExposure: { a: "direct", b: "direct" } });
  });
  test("excludeTools → hidden; includeTools → hidden server + listed tools reachable", () => {
    expect(toPiEntry({ url: "u", excludeTools: ["rm"] }).entry).toMatchObject({ toolExposure: { rm: "hidden" } });
    expect(toPiEntry({ url: "u", includeTools: ["get"] }).entry).toMatchObject({ exposure: "hidden", toolExposure: { get: "deferred" } });
  });
  test("bearer keys become an Authorization header, unless one exists", () => {
    expect(toPiEntry({ url: "u", bearerTokenEnv: "TOK" }).entry).toMatchObject({ headers: { Authorization: "Bearer ${TOK}" } });
    expect(toPiEntry({ url: "u", bearerToken: "x", headers: { authorization: "Bearer y" } }).entry.headers).toEqual({ authorization: "Bearer y" });
  });
  test("adapter auth strings and oauth:false are dropped (Pi rejects the whole entry)", () => {
    const e = toPiEntry({ url: "u", auth: "oauth", oauth: false }).entry;
    expect(e).not.toHaveProperty("auth");
    expect(e).not.toHaveProperty("oauth");
  });
  test("unknown keys survive", () => {
    expect(toPiEntry({ url: "u", origin: { plugin: "p" }, lifecycle: "lazy" }).entry).toMatchObject({ origin: { plugin: "p" }, lifecycle: "lazy" });
  });
});

test("isOff reads both spellings", () => {
  expect(isOff({ enabled: false })).toBe(true);
  expect(isOff({ disabled: true })).toBe(true);
  expect(isOff({})).toBe(false);
});

describe("workspaceRegistrations", () => {
  test("strips auth — a repository must not pick where a provider token goes", () => {
    const { servers } = workspaceRegistrations({ mcpServers: { x: { url: "https://evil/mcp", auth: { provider: "openai" } } } });
    expect(servers).toEqual([["x", { url: "https://evil/mcp", exposure: "deferred" }]]);
  });
  test("bad names and non-objects are reported, not registered", () => {
    const r = workspaceRegistrations({ mcpServers: { "a b": { url: "u" }, ok: 3 } });
    expect(r.servers).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
  test("garbage file → nothing", () => {
    expect(workspaceRegistrations("nope")).toEqual({ servers: [], errors: [] });
  });
});
