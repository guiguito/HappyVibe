/**
 * The sidecar is the ONLY route main has to MCP credentials, so this spawns it
 * for real — against PI_MCP_ADAPTER_TEST_AUTH_STORE=memory, so it can never
 * read or write a developer's login keychain. (The keychain is global to the OS
 * user and PI_CODING_AGENT_DIR does not scope it; an unforced run would resolve
 * whatever that developer last signed into. That is the defect `045b499` fixed
 * in the sibling contract test, and the same rule applies here.)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createAdapterStore, MCP_OAUTH_BRIDGE_RELPATH } from "../src/main/mcpAdapterStore";

const RUNTIME = resolve(__dirname, "..", "pi-runtime");
const URL_A = "https://mcp.example.com/mcp";
const URL_B = "https://other.example.com/mcp";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-adapter-store-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const store = (): ReturnType<typeof createAdapterStore> =>
  createAdapterStore({
    agentDir: tmp,
    runtimeDir: RUNTIME,
    execPath: process.execPath,
    env: { PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory" },
  });

/**
 * Drives the sidecar directly, NOT through createAdapterStore — a wrapper bug
 * must not be able to mask a protocol bug.
 */
function runBridge(agentDir: string, ops: unknown[]): Promise<{ status: string; tokens?: { accessToken?: string } }[]> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(RUNTIME, MCP_OAUTH_BRIDGE_RELPATH)], {
      cwd: RUNTIME,
      env: { ...process.env, PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory" },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.on("error", rej);
    child.on("close", () => {
      try { res(JSON.parse(out.trim().split("\n").pop()!).results); } catch (e) { rej(e); }
    });
    child.stdin.end(JSON.stringify({ agentDir, ops }));
  });
}

describe("mcpAdapterStore", () => {
  it("reports absent for servers it has never seen, in ONE spawn", async () => {
    const out = await store().read([
      { name: "a", url: URL_A }, { name: "b", url: URL_A }, { name: "c", url: URL_A },
    ]);
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"]);
    for (const k of ["a", "b", "c"]) expect(out[k].status).toBe("absent");
  });

  it("says unavailable, never absent, when the sidecar cannot answer", async () => {
    // "absent" is a claim that the user is signed out. Making that claim on no
    // evidence is the defect this whole module replaces, so a broken sidecar
    // must surface as an error rather than a confident signed-out answer.
    const broken = createAdapterStore({ agentDir: tmp, runtimeDir: "/nonexistent-runtime" });
    await expect(broken.read([{ name: "a", url: URL_A }])).rejects.toThrow();
  });
});

describe("mcp-oauth-bridge protocol", () => {
  // The memory store lives in the sidecar PROCESS, so a write in one spawn is
  // invisible to a read in the next. Round-trips are therefore asserted as one
  // batched request — which is also the shape the startup sweep uses, so this
  // pins the protocol that matters rather than a testing convenience.
  it("round-trips a credential and honours the URL binding within one request", async () => {
    const res = await runBridge(tmp, [
      { op: "writeTokens", name: "hv-fixture", url: URL_A, tokens: { accessToken: "tok-xyz" } },
      { op: "inspect", name: "hv-fixture", url: URL_A },
      { op: "inspect", name: "hv-fixture", url: URL_B },
      { op: "remove", name: "hv-fixture" },
      { op: "inspect", name: "hv-fixture", url: URL_A },
    ]);
    expect(res[1]).toMatchObject({ status: "present", tokens: { accessToken: "tok-xyz" } });
    expect(res[2].status).toBe("absent"); // a different URL is not this credential
    expect(res[4].status).toBe("absent"); // remove actually removed it
  });

  it("keeps client info and tokens together for the same server URL", async () => {
    // updateTokens/updateClientInfo each CLEAR the other field when the stored
    // serverUrl differs, so writing both at one URL must not lose either.
    const res = await runBridge(tmp, [
      { op: "writeClientInfo", name: "hv-fixture", url: URL_A, clientInfo: { clientId: "client-123" } },
      { op: "writeTokens", name: "hv-fixture", url: URL_A, tokens: { accessToken: "tok-xyz" } },
      { op: "inspect", name: "hv-fixture", url: URL_A },
    ]);
    expect(res[2]).toMatchObject({ status: "present", tokens: { accessToken: "tok-xyz" } });
  });
});
