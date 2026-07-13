/**
 * Hermetic mock-OAuth + mock-MCP test for authenticate().
 * No real browser, no real network: a single Node http server implements the
 * minimal OAuth surface the SDK probes (RFC 9728 protected-resource metadata,
 * RFC 8414 authorization-server metadata, DCR /register, /authorize → 302 to
 * the loopback callback, /token) plus a Streamable-HTTP MCP endpoint requiring
 * a bearer token that serves initialize + tools/list.
 *
 * The injected openExternal fetches the authorize URL, which 302s back to the
 * provider's loopback /callback — simulating the user approving in a browser.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { authenticate } from "../src/main/mcpOAuth";
import { readAuthEntry } from "../src/main/mcpAuthStore";

let server: Server;
let base: string; // http://127.0.0.1:<port>
let tmp: string;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// One MCP JSON-RPC message per POST (batching not needed for this test).
function mcpResult(res: ServerResponse, id: unknown, result: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "mcp-oauth-test-"));

  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;

    // RFC 9728 — protected resource metadata (served at root; path-aware probe 404s then falls back here)
    if (path === "/.well-known/oauth-protected-resource") {
      return json(res, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
      });
    }

    // RFC 8414 — authorization server metadata
    if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }

    // RFC 7591 — dynamic client registration
    if (path === "/register" && req.method === "POST") {
      const meta = JSON.parse((await readBody(req)) || "{}");
      return json(res, 201, {
        client_id: "mock-client-id",
        redirect_uris: meta.redirect_uris,
        token_endpoint_auth_method: meta.token_endpoint_auth_method ?? "none",
        grant_types: meta.grant_types,
        response_types: meta.response_types,
      });
    }

    // Authorization endpoint — immediately 302 back to the loopback callback with code+state
    if (path === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const state = url.searchParams.get("state") ?? "";
      const loc = new URL(redirectUri);
      loc.searchParams.set("code", "TESTCODE");
      loc.searchParams.set("state", state);
      res.writeHead(302, { location: loc.toString() });
      return res.end();
    }

    // Token endpoint — exchange code (or refresh) for a bearer token
    if (path === "/token" && req.method === "POST") {
      return json(res, 200, {
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "mock-refresh-token",
      });
    }

    // Streamable-HTTP MCP endpoint — requires bearer, serves initialize + tools/list
    if (path === "/mcp" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer mock-access-token") {
        res.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        });
        return res.end();
      }
      const msg = JSON.parse((await readBody(req)) || "{}");
      if (msg.method === "initialize") {
        return mcpResult(res, msg.id, {
          protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp", version: "1.0.0" },
        });
      }
      if (msg.method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      }
      if (msg.method === "tools/list") {
        return mcpResult(res, msg.id, {
          tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object" } }],
        });
      }
      return mcpResult(res, msg.id ?? null, {});
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
});

describe("mcpOAuth.authenticate (hermetic)", () => {
  it("drives full OAuth flow, lists tools, and persists an adapter-readable AuthEntry", async () => {
    const cfg = { url: `${base}/mcp` };
    const result = await authenticate("mock", cfg, tmp, {
      // Simulate the user approving: GET the authorize URL, follow the 302 to /callback.
      openExternal: (u: string) => {
        void fetch(u, { redirect: "follow" }).catch(() => undefined);
      },
      timeoutMs: 10_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tools.map((t) => t.name)).toContain("echo");
    }

    const entry = readAuthEntry(tmp, "mock");
    expect(entry?.serverUrl).toBe(`${base}/mcp`);
    expect(entry?.tokens?.accessToken).toBe("mock-access-token");
    expect(entry?.clientInfo?.clientId).toBe("mock-client-id");
  });
});
