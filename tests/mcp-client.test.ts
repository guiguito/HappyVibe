import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { probe } from "../src/main/mcpClient";

const ECHO_SERVER = join(import.meta.dirname, "fixtures/mcp-echo-server.mjs");

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "mcp-client-test-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("mcpClient.probe", () => {
  it("connects to stdio echo fixture and returns tools", async () => {
    const result = await probe(
      "echo",
      { command: process.execPath, args: [ECHO_SERVER] },
      tmp,
      { timeoutMs: 10_000 },
    );
    expect(result.state).toBe("connected");
    expect(result.tools).toBeDefined();
    expect(result.tools!.some((t) => t.name === "echo")).toBe(true);
  }, 15_000);

  it("returns failed for a bogus stdio command and does not hang", async () => {
    const result = await probe(
      "bogus",
      { command: "/nonexistent-xyz-happyvibe" },
      tmp,
      { timeoutMs: 5_000 },
    );
    expect(result.state).toBe("failed");
    expect(result.error).toBeDefined();
  }, 10_000);
});
