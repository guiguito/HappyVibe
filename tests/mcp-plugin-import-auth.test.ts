/**
 * CONTRACT test (adapter-pin-bump gate) + the fix it forces.
 *
 * A plugin's MCP server config is written by its author for a host that always
 * does OAuth explicitly. The vendored adapter instead AUTO-DETECTS OAuth, and
 * disables that auto-detection as soon as any custom header is present:
 *
 *   mcp-auth-flow.ts: "Configured custom headers take precedence over implicit
 *                      OAuth auto-detection."
 *
 * That heuristic is right for `Authorization: Bearer …` (the header IS the auth)
 * and wrong for a non-auth header. The Miro plugin ships
 * `X-AI-Source: claude-code-plugin` — a vendor telemetry tag — so its server
 * connected UNAUTHENTICATED inside a session while the MCP page's own login and
 * tool listing worked, because main's connect path does OAuth explicitly.
 *
 * If a pin bump makes the adapter smarter about which headers mean auth, the
 * first group fails — and `normalizePluginMcpServer` can then be deleted.
 */
import { describe, it, expect } from "vitest";
import { supportsOAuth } from "../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth-flow.ts";
import { normalizePluginMcpServer } from "../src/main/plugins/mcpImport";

describe("adapter contract: what suppresses implicit OAuth", () => {
  it("auto-detects OAuth for a bare remote server", () => {
    expect(supportsOAuth({ url: "https://mcp.notion.com/mcp" })).toBe(true);
  });

  it("disables OAuth when an Authorization header is present — correct", () => {
    expect(
      supportsOAuth({ url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer x" } }),
    ).toBe(false);
  });

  it("ALSO disables OAuth for a non-auth header — the bug we work around", () => {
    // The whole reason normalizePluginMcpServer exists. When this flips to true,
    // the workaround is obsolete.
    expect(
      supportsOAuth({ url: "https://mcp.miro.com/", headers: { "X-AI-Source": "claude-code-plugin" } }),
    ).toBe(false);
  });

  it("honours an explicit auth:'oauth' regardless of headers", () => {
    // This is the lever the fix pulls.
    expect(
      supportsOAuth({
        url: "https://mcp.miro.com/",
        headers: { "X-AI-Source": "claude-code-plugin" },
        auth: "oauth",
      }),
    ).toBe(true);
  });
});

describe("normalizePluginMcpServer", () => {
  const miro = {
    type: "http",
    url: "https://mcp.miro.com/",
    headers: { "X-AI-Source": "claude-code-plugin" },
  };

  it("restores OAuth for a remote server whose only headers are non-auth", () => {
    const out = normalizePluginMcpServer(miro);
    expect(out.auth).toBe("oauth");
    // The property that actually matters: the adapter now authenticates it.
    expect(supportsOAuth(out)).toBe(true);
  });

  it("leaves a server whose header IS the auth alone", () => {
    const keyed = { url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer ${K}" } };
    expect(normalizePluginMcpServer(keyed).auth).toBeUndefined();
    expect(supportsOAuth(normalizePluginMcpServer(keyed))).toBe(false);
  });

  it("treats any auth-looking header name as auth, erring toward the adapter's default", () => {
    for (const h of ["x-api-key", "API-Key", "X-Auth-Token", "x-consumer-api-key", "Proxy-Authorization", "x-access-token", "X-Secret"]) {
      const out = normalizePluginMcpServer({ url: "https://x.test/mcp", headers: { [h]: "v" } });
      expect(out.auth, h).toBeUndefined();
    }
  });

  it("does not touch a server with no headers — auto-detect already works", () => {
    const out = normalizePluginMcpServer({ url: "https://mcp.canva.com/mcp" });
    expect(out.auth).toBeUndefined();
    expect(supportsOAuth(out)).toBe(true);
  });

  it("never overrides an explicit auth the author set", () => {
    expect(normalizePluginMcpServer({ ...miro, auth: "bearer" }).auth).toBe("bearer");
    expect(normalizePluginMcpServer({ ...miro, auth: false }).auth).toBe(false);
    expect(normalizePluginMcpServer({ ...miro, oauth: false }).auth).toBeUndefined();
  });

  it("ignores stdio servers, which never authenticate", () => {
    const stdio = { command: "npx", args: ["-y", "@playwright/mcp@latest"] };
    expect(normalizePluginMcpServer(stdio)).toEqual(stdio);
  });

  it("preserves every other field verbatim", () => {
    const out = normalizePluginMcpServer(miro);
    expect(out.url).toBe(miro.url);
    expect(out.headers).toEqual(miro.headers);
    expect(out.type).toBe("http");
  });
});
