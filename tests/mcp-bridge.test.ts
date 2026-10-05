import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { askUntil } from "./reask";

let client: PiClient;
afterEach(() => client?.stop());

// §13 (2026-10-05): a REAL model on Pi's built-in MCP, with the app's own spawn args.
// The workspace .mcp.json server is registered by the bridge with deferred exposure,
// so the model has to find the tool with tool_search (a safe default — no prompt) and
// then call it; that call gates under the adapter-era rule name.
test.skipIf(!KEY)("a real model finds an MCP tool with tool_search, and the call gates as mcp:<server>_<tool>", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcp-"));
  const agentDir = path.join(tmp, ".pi", "agent");
  const fixture = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
  fs.writeFileSync(
    path.join(tmp, ".mcp.json"),
    JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [fixture] } } }),
  );
  const spec = resolvePiSpawn(tmp, path.join(tmp, "sessions"), runtime, { mcp: true, agentDir, providerEnv: PROVIDER_ENV, model: MODEL });
  client = new PiClient({
    ...spec,
    execPath: process.execPath,
    args: [...spec.args, "--no-session"],
    // HOME redirected: the developer's real servers must not leak in.
    env: { ...spec.env, HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"), ECHO_CALL_LOG: path.join(tmp, "calls.log") } as Record<string, string>,
  });
  await client.start();

  const prompts: Array<Record<string, unknown>> = [];
  client.on("ui-request", (m) => {
    const req = m as Record<string, unknown>;
    if (req.method !== "select") return;
    try {
      const t = JSON.parse(req.title as string);
      if (t.kind !== "hv.permission") return;
      prompts.push(t);
      client.respondUi(req.id as string, { value: "Allow" });
    } catch { /* not ours */ }
  });
  const toolStarts: Array<Record<string, unknown>> = [];
  client.on("event", (e) => {
    if (e.type === "tool_execution_start") toolStarts.push(e as unknown as Record<string, unknown>);
  });

  const called = () => fs.existsSync(path.join(tmp, "calls.log"));
  const ok = await askUntil(
    () => client.send({
      type: "prompt",
      message: "Use tool_search to find the echo tool, then call it with text 'hello'. Do not ask questions, do not reply in prose first.",
    }),
    called,
  );
  expect(ok, "model never called the echo tool across 3 attempts").toBe(true);

  // Every prompt is the MCP call itself — tool_search never asks.
  expect(prompts.length).toBeGreaterThan(0);
  for (const p of prompts) expect(p.tool).toBe("mcp:echo_echo");
  expect(String(prompts[0].summary)).toMatch(/^MCP → echo: echo/);
  expect(toolStarts.some((t) => t.toolName === "tool_search")).toBe(true);

  // requireIntent injected a required `intent` into the MCP tool's schema.
  const call = toolStarts.find((t) => t.toolName === "mcp__echo__echo");
  expect(call, "expected an mcp__echo__echo tool_execution_start").toBeDefined();
  const intent = (call!.args as { intent?: unknown }).intent;
  expect(typeof intent).toBe("string");
  expect((intent as string).trim().length).toBeGreaterThan(0);
  // …and the bridge stripped it before the server saw the call.
  expect(fs.readFileSync(path.join(tmp, "calls.log"), "utf8")).toContain("hello");
}, 180_000);
