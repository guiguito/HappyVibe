import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Module under test (not yet created — tests fail until Step 4)
import {
  authEntryPath,
  readAuthEntry,
  writeAuthEntry,
  deleteAuthEntry,
  authState,
  type AuthEntry,
} from "../src/main/mcpAuthStore";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-auth-test-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("mcpAuthStore", () => {
  // (a) path-equality: our path must match the adapter's path byte-for-byte
  it("authEntryPath matches adapter getAuthEntryFilePath", async () => {
    const { getAuthEntryFilePath } = await import(
      "../pi-runtime/node_modules/pi-mcp-adapter/mcp-auth.ts"
    );
    process.env.PI_CODING_AGENT_DIR = tmp;
    const adapterPath = getAuthEntryFilePath("notion");
    delete process.env.PI_CODING_AGENT_DIR;
    expect(authEntryPath(tmp, "notion")).toBe(adapterPath);
  });

  // (b) write → read round-trip
  it("write then read returns the same AuthEntry", () => {
    const entry: AuthEntry = {
      tokens: { accessToken: "tok-abc", expiresAt: 9999999999 },
      serverUrl: "https://api.notion.com",
    };
    writeAuthEntry(tmp, "notion", entry);
    expect(readAuthEntry(tmp, "notion")).toEqual(entry);
  });

  // (c) needs-auth on url mismatch
  it("authState returns needs-auth when url does not match stored serverUrl", () => {
    const entry: AuthEntry = {
      tokens: { accessToken: "tok-abc", expiresAt: 9999999999 },
      serverUrl: "https://api.notion.com",
    };
    writeAuthEntry(tmp, "notion", entry);
    expect(authState(tmp, "notion", "https://other.example.com")).toBe("needs-auth");
  });

  // (d) authenticated when url matches and token not expired
  it("authState returns authenticated when url matches and token is valid", () => {
    const entry: AuthEntry = {
      tokens: { accessToken: "tok-abc", expiresAt: 9999999999 },
      serverUrl: "https://api.notion.com",
    };
    writeAuthEntry(tmp, "notion", entry);
    expect(authState(tmp, "notion", "https://api.notion.com")).toBe("authenticated");
  });
});
