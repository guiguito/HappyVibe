import { describe, it, expect } from "vitest";
import {
  PREREGISTERED_OAUTH_HOSTS,
  preregisteredVendor,
} from "../src/main/mcpPreregistered";

/**
 * §25 — MCP servers HappyVibe can never authenticate with, because the vendor
 * only issues credentials to an allowlist of pre-registered clients and
 * mcpOAuth.ts implements Dynamic Client Registration only.
 */

describe("preregisteredVendor", () => {
  it("blocks Figma's hosted server", () => {
    // Audited 2026-08-01: mcp.figma.com 401s correctly and advertises a
    // registration_endpoint, but that endpoint returns a flat 403 to every
    // well-formed DCR request. Claude, Cursor and VS Code work because they are
    // on Figma's allowlist.
    const v = preregisteredVendor({ url: "https://mcp.figma.com/mcp" });
    expect(v?.vendor).toBe("Figma");
    expect(v?.reason.length).toBeGreaterThan(20);
  });

  it("blocks Slack's hosted server", () => {
    // Slack documents *confidential* OAuth — a pre-registered client_id and
    // secret — and states DCR is unsupported.
    expect(preregisteredVendor({ url: "https://mcp.slack.com/mcp" })?.vendor).toBe("Slack");
  });

  it("does NOT block GitHub — the trap", () => {
    // GitHub advertises no registration_endpoint either, so a rule written as
    // "cannot do DCR" would exclude it. But its server genuinely evaluates a
    // bearer PAT (a bad one returns 401 invalid_token rather than rejecting the
    // method), which is why the MCP catalog ships it as a TOKEN entry. The
    // criterion is "no DCR AND no token path".
    expect(
      preregisteredVendor({
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" },
      }),
    ).toBeNull();
  });

  it("does NOT block Figma's LOCAL Dev Mode server", () => {
    // Unauthenticated and would work fine; it needs the desktop app running,
    // which is a different problem from "cannot get a client_id".
    expect(preregisteredVendor({ url: "http://127.0.0.1:3845/mcp" })).toBeNull();
    expect(preregisteredVendor({ url: "http://localhost:3845/mcp" })).toBeNull();
  });

  it("does NOT block a stdio server — it never authenticates", () => {
    expect(preregisteredVendor({ command: "npx", args: ["-y", "@playwright/mcp@latest"] })).toBeNull();
  });

  it("matches subdomains but not a lookalike suffix", () => {
    expect(preregisteredVendor({ url: "https://eu.mcp.figma.com/mcp" })?.vendor).toBe("Figma");
    // notfigma.com must not match figma.com
    expect(preregisteredVendor({ url: "https://notmcp.figma.com.evil.test/mcp" })).toBeNull();
    expect(preregisteredVendor({ url: "https://evil-mcp.slack.com.attacker.test/" })).toBeNull();
  });

  it("survives junk instead of throwing", () => {
    expect(preregisteredVendor({})).toBeNull();
    expect(preregisteredVendor({ url: "not a url" })).toBeNull();
    expect(preregisteredVendor({ url: "" })).toBeNull();
  });

  it("every entry carries copy a user can act on", () => {
    expect(PREREGISTERED_OAUTH_HOSTS.length).toBeGreaterThan(0);
    for (const h of PREREGISTERED_OAUTH_HOSTS) {
      expect(h.host, h.vendor).toMatch(/^[a-z0-9.-]+$/);
      expect(h.vendor.length, h.host).toBeGreaterThan(0);
      expect(h.reason.length, h.host).toBeGreaterThan(20);
    }
  });
});
