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
import { probe } from "../src/main/mcpClient";
import { readAuthEntry, writeAuthEntry } from "../src/main/mcpAuthStore";

let server: Server;
let base: string; // http://127.0.0.1:<port>
let tmp: string;
// redirect_uris registered via DCR this flow — /authorize enforces membership,
// mirroring a real AS (e.g. Notion) that rejects an unregistered redirect_uri.
let registeredRedirectUris: string[];

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
  registeredRedirectUris = [];

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
      registeredRedirectUris = meta.redirect_uris ?? [];
      return json(res, 201, {
        client_id: "mock-client-id",
        redirect_uris: meta.redirect_uris,
        token_endpoint_auth_method: meta.token_endpoint_auth_method ?? "none",
        grant_types: meta.grant_types,
        response_types: meta.response_types,
      });
    }

    // Authorization endpoint — enforce that redirect_uri was registered (as a
    // real AS does), then 302 back to the loopback callback with code+state.
    if (path === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri")!;
      const state = url.searchParams.get("state") ?? "";
      const loc = new URL(redirectUri);
      if (!registeredRedirectUris.includes(redirectUri)) {
        // Mirror Notion: reject the unregistered redirect_uri. (We still 302 to
        // the loopback so the test settles fast; a real AS shows an error page.)
        loc.searchParams.set("error", "invalid_redirect_uri");
        loc.searchParams.set("state", state);
        res.writeHead(302, { location: loc.toString() });
        return res.end();
      }
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

  it("rejects and does not persist tokens when callback state does not match (CSRF guard)", async () => {
    const cfg = { url: `${base}/mcp` };
    const result = await authenticate("csrf-test", cfg, tmp, {
      // Replace the real state param with a bogus one before fetching the authorize URL.
      // The mock server echoes back whatever state it receives, so the callback will
      // arrive with the bogus state while oauthState on disk holds the real one → mismatch.
      openExternal: (u: string) => {
        const tampered = new URL(u);
        tampered.searchParams.set("state", "bogus-csrf-state");
        void fetch(tampered.toString(), { redirect: "follow" }).catch(() => undefined);
      },
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/csrf|state/i);
    // No tokens must be persisted — the handshake must not complete.
    const entry = readAuthEntry(tmp, "csrf-test");
    expect(entry?.tokens).toBeUndefined();
  });

  it("resolves { ok: false } when callback never arrives (timeout guard)", async () => {
    const cfg = { url: `${base}/mcp` };
    const start = Date.now();
    const result = await authenticate("timeout-test", cfg, tmp, {
      openExternal: () => { /* deliberately do nothing — callback never fires */ },
      timeoutMs: 500,
    });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/timed? ?out/i);
    // Must settle within a reasonable bound (timeout + generous overhead).
    expect(elapsed).toBeLessThan(5_000);
  });

  it("re-registers when a stored client was registered for a stale redirect_uri (loopback port drift)", async () => {
    // Seed a stale DCR client from a prior attempt: its redirect_uris point at a
    // port that won't match this flow's OS-assigned callback port. Reusing it
    // would make /authorize reject the new redirect_uri ("Invalid redirect_uri").
    writeAuthEntry(tmp, "stale-client", {
      clientInfo: { clientId: "stale-old-id", redirectUris: ["http://127.0.0.1:9/callback"] },
      serverUrl: `${base}/mcp`,
    });

    const cfg = { url: `${base}/mcp` };
    const result = await authenticate("stale-client", cfg, tmp, {
      openExternal: (u: string) => {
        void fetch(u, { redirect: "follow" }).catch(() => undefined);
      },
      timeoutMs: 10_000,
    });

    // Self-heals: the stale client is ignored, a fresh client is registered for
    // the current port, /authorize accepts it, and auth completes.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tools.map((t) => t.name)).toContain("echo");
    const entry = readAuthEntry(tmp, "stale-client");
    expect(entry?.clientInfo?.clientId).toBe("mock-client-id"); // re-registered, not the stale id
    expect(entry?.tokens?.accessToken).toBe("mock-access-token");
  });

  // Regression: an authenticated OAuth server must probe as "connected", not
  // "failed". Before the fix the probe attached no token, so the server 401'd
  // and (tokens present ⇒ not needs-auth) was misclassified as failed.
  it("probe reports connected for a server with a valid stored token (no browser)", async () => {
    writeAuthEntry(tmp, "seeded", {
      tokens: {
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      clientInfo: { clientId: "mock-client-id", redirectUris: ["http://127.0.0.1:1/callback"] },
      serverUrl: `${base}/mcp`,
    });

    const result = await probe("seeded", { url: `${base}/mcp` }, tmp, { timeoutMs: 10_000 });

    expect(result.state).toBe("connected");
    expect(result.tools?.some((t) => t.name === "echo")).toBe(true);
    // A probe must never mutate on-disk auth artifacts for a valid token.
    expect(readAuthEntry(tmp, "seeded")?.tokens?.accessToken).toBe("mock-access-token");
  });

  it("probe reports needs-auth (not failed) for an unauthenticated OAuth server", async () => {
    const result = await probe("unauthed", { url: `${base}/mcp` }, tmp, { timeoutMs: 10_000 });
    expect(result.state).toBe("needs-auth");
  });
});
