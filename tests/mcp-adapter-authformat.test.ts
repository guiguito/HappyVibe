/**
 * CONTRACT test (adapter-pin-bump gate).
 *
 * The contract MOVED on 2026-08-14. It used to be "the adapter reads the file
 * HappyVibe writes"; the adapter stopped doing that in 2.17.0, when credentials
 * moved into the OS keychain and a plaintext tokens.json became a legacy
 * artefact to import and delete. So what is pinned now is the credential API
 * main depends on instead — and, in both directions, the legacy behaviour that
 * makes the one-time sweep work.
 *
 * If a pi-mcp-adapter pin bump changes any of it, this breaks. That is the gate.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * The adapter reads the OS KEYCHAIN first and treats tokens.json as a legacy
 * entry to import. Two consequences, both learned the hard way: an unforced run
 * resolves whatever the developer really authenticated under this server name
 * (a real "notion" login made this fail on one machine and pass on CI), and the
 * import path WRITES the fixture into that developer's keychain. The adapter's
 * own memory store gives an empty secure store, which is the only state in
 * which the legacy path — still part of the contract — is reached at all.
 */
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = "memory";

const ADAPTER = join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter");
const URL_A = "https://mcp.example.com/mcp";
const URL_B = "https://other.example.com/mcp";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-authformat-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

/**
 * Writes the legacy plaintext entry by hand rather than through main's store —
 * main does not write this shape any more, and a test describing the ADAPTER's
 * format must not depend on our code to spell it.
 */
function writeLegacyEntry(agentDir: string, name: string, entry: unknown): string {
  const hash = createHash("sha256").update(name, "utf8").digest("hex");
  const p = join(agentDir, "mcp-oauth", `sha256-${hash}`, "tokens.json");
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(entry), { mode: 0o600 });
  return p;
}

describe("mcp adapter auth format contract", () => {
  it("still offers the memory store — without it these tests read the real keychain", () => {
    const src = readFileSync(join(ADAPTER, "mcp-auth.ts"), "utf-8");
    expect(src).toContain("PI_MCP_ADAPTER_TEST_AUTH_STORE");
    expect(src).toMatch(/TEST_AUTH_STORE_ENV\] === 'memory'/);
  });

  it("moves the MCP SDK WITH the adapter — main and the agent must speak one version", () => {
    // Same relationship as typebox/yaml to Pi: the adapter DECIDES the version,
    // main follows. Main's own client (mcpClient.ts, mcpOAuth.ts) speaks to the
    // same servers the agent does and shares the credential shapes in
    // shared/auth.js, so two SDK majors either side of one keychain entry is the
    // drift this file exists to catch — and it had already happened once,
    // silently: the root pin sat at 1.29.0 while the vendored adapter resolved
    // 1.30.0, with nothing failing. DERIVED from the adapter's own tree, never a
    // hand-typed number, so a pin bump fails here instead of drifting.
    const root = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    ) as { dependencies: Record<string, string> };
    const vendored = JSON.parse(
      readFileSync(join(__dirname, "..", "pi-runtime", "package-lock.json"), "utf-8"),
    ) as { packages: Record<string, { version: string }> };

    const theirs = vendored.packages["node_modules/@modelcontextprotocol/sdk"]?.version;
    expect(theirs, "the adapter's SDK is not in pi-runtime's lockfile").toBeTruthy();
    // Exact, not a range: a caret here would let npm move main's SDK under a
    // shipped app while the agent stayed put.
    expect(root.dependencies["@modelcontextprotocol/sdk"]).toBe(theirs);
  });

  it("exposes the pi-mcp-adapter/oauth subpath main depends on", () => {
    const pkg = JSON.parse(readFileSync(join(ADAPTER, "package.json"), "utf-8")) as {
      exports?: Record<string, unknown>;
    };
    // An exports map gates BARE specifiers. Losing "./oauth" breaks the sidecar
    // at import; losing it silently is what this case exists to prevent.
    expect(pkg.exports?.["./oauth"]).toBeDefined();
  });

  it("the subpath exports the token API, and mcp-auth.ts the rest the sidecar needs", async () => {
    const oauth = await import(join(ADAPTER, "oauth.ts"));
    for (const fn of ["inspectMcpOAuthTokensForUrl", "updateMcpOAuthTokensForUrl", "getMcpOAuthTokensForUrl"]) {
      expect(typeof oauth[fn]).toBe("function");
    }
    // Reached by RELATIVE path on purpose: the exports map lists none of these,
    // and an exports map gates bare specifiers only — the same escape CLAUDE.md
    // documents for two pi-subagents internals. inspectAuthForUrl in particular
    // is what the subpath cannot replace: it returns the WHOLE entry, and the
    // provider needs clientInfo as well as tokens. If the subpath ever grows
    // these, move the sidecar onto it and delete this case.
    const auth = await import(join(ADAPTER, "mcp-auth.ts"));
    for (const fn of ["inspectAuthForUrl", "getAuthEntry", "updateClientInfo", "removeAuthEntry"]) {
      expect(typeof auth[fn]).toBe("function");
    }
  });

  it("binds a stored credential to its server URL", async () => {
    const { updateMcpOAuthTokensForUrl } = await import(join(ADAPTER, "oauth.ts"));
    const { inspectAuthForUrl } = await import(join(ADAPTER, "mcp-auth.ts"));

    updateMcpOAuthTokensForUrl("hv-contract-fixture", URL_A, { accessToken: "tok-xyz" });

    // The URL binding is the whole point of the API and what main's status
    // answer rests on: same URL present, different URL not.
    expect(inspectAuthForUrl("hv-contract-fixture", URL_A)).toMatchObject({
      status: "present",
      entry: { tokens: { accessToken: "tok-xyz" } },
    });
    expect(inspectAuthForUrl("hv-contract-fixture", URL_B).status).not.toBe("present");
  });

  it("inspectAuthForUrl does NOT consume a legacy file; getAuthEntry does", async () => {
    // Both halves matter. The non-migrating read is what lets a status probe run
    // without destroying anything, and the migrating read is the only thing that
    // moves an old plaintext credential into the keychain — which is exactly what
    // the one-time sweep relies on, and exactly what a future pin could change.
    const { inspectAuthForUrl, getAuthEntry } = await import(join(ADAPTER, "mcp-auth.ts"));
    const priorPiDir = process.env.PI_CODING_AGENT_DIR;
    const priorMcpDir = process.env.MCP_OAUTH_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = tmp;
      delete process.env.MCP_OAUTH_DIR; // adapter resolves <PI_CODING_AGENT_DIR>/mcp-oauth
      const file = writeLegacyEntry(tmp, "hv-legacy-fixture", {
        tokens: { accessToken: "legacy-tok" },
        clientInfo: { clientId: "client-123" },
        serverUrl: URL_A,
      });

      expect(inspectAuthForUrl("hv-legacy-fixture", URL_A)).toMatchObject({
        status: "present",
        entry: { tokens: { accessToken: "legacy-tok" }, clientInfo: { clientId: "client-123" } },
      });
      expect(existsSync(file)).toBe(true); // status-only read left it alone

      expect(getAuthEntry("hv-legacy-fixture")?.tokens?.accessToken).toBe("legacy-tok");
      expect(existsSync(file)).toBe(false); // migrating read consumed it
    } finally {
      if (priorPiDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorPiDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      if (priorMcpDir !== undefined) process.env.MCP_OAUTH_DIR = priorMcpDir;
      else delete process.env.MCP_OAUTH_DIR;
    }
  });

  it("keeps credentials OUT of the plaintext file — the reverse drift", async () => {
    // The mirror image of the original bug. If a future version went back to
    // writing tokens.json, main would be talking to a store nobody reads, and
    // the symptom would look like this bug with the arrows swapped. A write must
    // land in the secure store and leave no plaintext behind.
    const { updateMcpOAuthTokensForUrl } = await import(join(ADAPTER, "oauth.ts"));
    const priorPiDir = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = tmp;
      updateMcpOAuthTokensForUrl("hv-reverse-fixture", URL_A, { accessToken: "secret-tok" });
      const hash = createHash("sha256").update("hv-reverse-fixture", "utf8").digest("hex");
      expect(existsSync(join(tmp, "mcp-oauth", `sha256-${hash}`, "tokens.json"))).toBe(false);
    } finally {
      if (priorPiDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorPiDir;
      else delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});
