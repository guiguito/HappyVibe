// Key-free: Pi's built-in MCP + the real bridge, driven by a scripted faux model.
// Pins that every MCP call reaches the permission gate and that Deny never reaches
// the server (PRD §13, Decision 2026-10-05).
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");
const echo = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
let client: PiClient | undefined;
afterEach(() => client?.stop());

function boot(tmp: string, steps: object[]): PiClient {
  return new PiClient({
    execPath: process.execPath,
    args: [path.join(runtime, PI_CLI_RELPATH), "--mode", "rpc", "--no-session",
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"),
      "-e", "builtin:mcp", "-e", "builtin:tool-search",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "faux", "--model", "script"],
    env: { ...process.env, HOME: tmp, PI_CODING_AGENT_DIR: path.join(tmp, "agent"),
      HV_TEST_RUNTIME: runtime, HV_FAUX_STEPS: JSON.stringify(steps),
      ECHO_CALL_LOG: path.join(tmp, "calls.log") } as Record<string, string>,
    cwd: tmp,
  });
}

type Prompt = { tool: string; summary: string };
async function runTurn(c: PiClient, answer: (p: Prompt) => string): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  c.on("ui-request", (m: { id: string; method?: string; title?: string }) => {
    if (m.method !== "select") return;
    let t: Prompt & { kind?: string };
    try { t = JSON.parse(m.title ?? "{}"); } catch { return; }
    if (t.kind !== "hv.permission") return;
    prompts.push(t);
    c.respondUi(m.id, { value: answer(t) });
  });
  const ended = new Promise<void>((r) => c.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
  await c.start();
  await c.send({ type: "prompt", message: "go" });
  await ended;
  return prompts;
}

const steps = [
  { tool: "tool_search", args: { query: "echo" } },
  { tool: "mcp__echo__echo", args: { text: "hi" } },
  { text: "done" },
];

function tmpWithGlobal(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcpb-"));
  fs.mkdirSync(path.join(tmp, "agent"));
  fs.writeFileSync(path.join(tmp, "agent/mcp.json"), JSON.stringify({ mcpServers: {
    echo: { command: process.execPath, args: [echo], exposure: "deferred" } } }));
  return tmp;
}

test("a deferred MCP call raises hv.permission; Deny never reaches the server", async () => {
  const tmp = tmpWithGlobal();
  client = boot(tmp, steps);
  const prompts = await runTurn(client, (p) => (p.tool === "tool_search" ? "Allow" : "Deny"));
  // Phase 0: the bridge does not know Pi's MCP yet, so it gates the raw name.
  expect(prompts.map((p) => p.tool)).toEqual(["tool_search", "mcp__echo__echo"]);
  expect(fs.existsSync(path.join(tmp, "calls.log"))).toBe(false);
}, 60_000);
