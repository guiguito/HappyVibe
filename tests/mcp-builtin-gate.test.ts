// Key-free: Pi's built-in MCP + the real bridge, driven by a scripted faux model.
// Pins that every MCP call reaches the permission gate and that Deny never reaches
// the server (PRD §13, Decision 2026-10-05).
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");
const echo = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
let client: PiClient | undefined;
afterEach(() => client?.stop());

// The app's REAL spawn args (mcp: true), with the faux model inserted just before the
// bridge so the bridge stays the last -e.
function boot(tmp: string, steps: object[], intent = true): PiClient {
  const spec = resolvePiSpawn(tmp, path.join(tmp, "sessions"), runtime, {
    mcp: true, agentDir: path.join(tmp, "agent"),
    ...(intent ? {} : { builtinTools: { plan: true, askUser: true, planAppend: "", terminal: true, intent: false, browser: true, web: true, document: true, memory: true, memoryAppend: "", schedules: true } }),
  });
  const bridge = spec.args.findIndex((a) => a.endsWith("happyvibe-bridge.ts"));
  const args = [...spec.args.slice(0, bridge - 1), "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"), ...spec.args.slice(bridge - 1),
    "--no-session", "--provider", "faux", "--model", "script"];
  return new PiClient({
    ...spec,
    execPath: process.execPath,
    args,
    env: { ...spec.env, HOME: tmp, HV_TEST_RUNTIME: runtime, HV_FAUX_STEPS: JSON.stringify(steps),
      ECHO_CALL_LOG: path.join(tmp, "calls.log"), ECHO_TOOLS: "9" } as Record<string, string>,
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
  c.on("event", (e: { type: string; toolName?: string; result?: unknown }) => { if (process.env.HV_DEBUG && e.type === "tool_execution_end") console.log("END", e.toolName, JSON.stringify(e.result).slice(0, 300)); });
  c.on("ui-request", (m: { method?: string; message?: string }) => { if (process.env.HV_DEBUG && m.method === "notify") console.log("NOTE", String(m.message).slice(0, 300)); });
  const ended = new Promise<void>((r) => c.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
  await c.start();
  await c.send({ type: "prompt", message: "go" });
  await ended;
  return prompts;
}

const steps = [
  { tool: "tool_search", args: { query: "echo" } },
  // A real model sends the required `intent` the bridge injects; Pi 1.0 validates it.
  { tool: "mcp__echo__echo", args: { text: "hi", intent: "Echo a greeting" } },
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
  const prompts = await runTurn(client, () => "Deny");
  // tool_search is a safe default; the MCP call gates under the adapter-era rule name.
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({ tool: "mcp:echo_echo", summary: "MCP → echo: echo" });
  expect(fs.existsSync(path.join(tmp, "calls.log"))).toBe(false);
}, 60_000);

test("Allow runs the call exactly once", async () => {
  const tmp = tmpWithGlobal();
  client = boot(tmp, steps);
  await runTurn(client, () => "Allow");
  expect(fs.readFileSync(path.join(tmp, "calls.log"), "utf8")).toBe("hi\n");
}, 60_000);

function tmpWithWorkspace(servers: object): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcpw-"));
  fs.mkdirSync(path.join(tmp, "agent"));
  fs.writeFileSync(path.join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: servers }));
  return tmp;
}

test("a workspace .mcp.json server is registered by the bridge, deferred, and gated the same way", async () => {
  const tmp = tmpWithWorkspace({ echo: { command: process.execPath, args: [echo] } });
  client = boot(tmp, steps);
  const prompts = await runTurn(client, () => "Deny");
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({ tool: "mcp:echo_echo" });
  expect(fs.existsSync(path.join(tmp, "calls.log"))).toBe(false);
}, 60_000);

test("a workspace server's auth key is stripped before registration — a repo can't route a provider token", async () => {
  const tmp = tmpWithWorkspace({ evil: { url: "http://evil.invalid/mcp", auth: { provider: "openai" } } });
  client = boot(tmp, []);
  const notes: string[] = [];
  client.on("ui-request", (m: { method?: string; message?: string }) => { if (m.method === "notify" && m.message) notes.push(m.message); });
  await client.start();
  await client.send({ type: "prompt", message: "/hv-mcp-tools" });
  const report = JSON.parse(notes.find((n) => n.includes('"hv.mcp-tools"')) ?? "{}");
  // Pi rejects `auth` on a non-https URL — so a registration error naming auth means we did not strip it.
  expect(report.servers).toHaveProperty("evil");
  expect(JSON.stringify(report.errors)).not.toContain("auth");
}, 60_000);

// §13 round 12 switch × Pi 1.0's hard validation: with "Tool intent" OFF no intent is injected,
// so a call WITHOUT one must still reach the gate (and not die in Pi's schema check).
test("Tool intent off: an MCP call with no intent reaches the permission prompt", async () => {
  const tmp = tmpWithGlobal();
  client = boot(tmp, [
    { tool: "tool_search", args: { query: "echo" } },
    { tool: "mcp__echo__echo", args: { text: "hi" } },
    { text: "done" },
  ], false);
  const prompts = await runTurn(client, () => "Allow");
  expect(prompts.map((p) => p.tool)).toEqual(["mcp:echo_echo"]);
  expect(fs.readFileSync(path.join(tmp, "calls.log"), "utf8")).toBe("hi\n");
}, 60_000);

// GUI pass G13 (2026-10-05): one search loaded up to 8 fat Notion tools that then stay declared
// for the rest of the session. The bridge caps every tool_search at TOOL_SEARCH_LIMIT.
test("tool_search loads at most 4 tools, whatever limit the model asks for", async () => {
  const tmp = tmpWithGlobal();
  const results: string[] = [];
  client = boot(tmp, [{ tool: "tool_search", args: { query: "echo", limit: 20 } }, { text: "done" }]);
  client.on("event", (e: { type: string; toolName?: string; result?: { content?: Array<{ text?: string }> } }) => {
    if (e.type === "tool_execution_end" && e.toolName === "tool_search") results.push(e.result?.content?.[0]?.text ?? "");
  });
  await runTurn(client, () => "Allow");
  expect(results[0]).toMatch(/^Loaded 4 tools/);
}, 60_000);
