import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_CLI_RELPATH, PI_MCP_ADAPTER_RELPATH } from "../src/main/pi/spawn";

// Tiny .env loader — keeps tests dependency-free
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { askUntil } from "./reask";
let client: PiClient;
afterEach(() => client?.stop());

test.skipIf(!KEY)("mcp proxy call surfaces an unwrapped hv.permission prompt; Allow executes the tool", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcp-"));
  const fixture = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
  // Workspace-tier config — exactly what the Agents & Tools page will write.
  fs.writeFileSync(
    path.join(tmp, ".mcp.json"),
    JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [fixture] } } }),
  );

  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      // Bridge LAST, mirroring production (spawn.ts): the permission gate must
      // be the final tool_call handler so it sees mutated input. Pinned by
      // tests/mcp-spawn.test.ts.
      "-e", path.join(runtime, PI_MCP_ADAPTER_RELPATH),
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    // HOME/XDG redirected into tmp: the adapter also reads ~/.config/mcp/mcp.json
    // and ~/.pi/agent/mcp.json — the developer's real servers must not leak in.
    env: {
      ...process.env, ...PROVIDER_ENV,
      HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"),
    } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();

  const prompts: Array<Record<string, unknown>> = [];
  let resolveInvokePrompt: (r: Record<string, unknown>) => void;
  // A model that calls the tool TWICE raised a second invoke prompt nobody answered, and the
  // turn hung to the 180 s timeout — measured on main as well as on a branch (2026-09-26), i.e.
  // a flake of this harness, not of the gate. The FIRST invoke is the one asserted on; any later
  // one is let through so the turn can end.
  let invokeSeen = false;
  const invokePrompt = new Promise<Record<string, unknown>>((r) => (resolveInvokePrompt = r));
  client.on("ui-request", (m) => {
    const req = m as Record<string, unknown>;
    if (req.method !== "select") return;
    try {
      const t = JSON.parse(req.title as string);
      if (t.kind !== "hv.permission") return;
      console.log("[mcp-bridge.test] hv.permission:", t);
      prompts.push(t);
      if (typeof t.tool === "string" && t.tool.startsWith("mcp:")) {
        if (invokeSeen) client.respondUi(req.id as string, { value: "Allow" });
        else { invokeSeen = true; resolveInvokePrompt(req); }
      }
      else client.respondUi(req.id as string, { value: "Allow" }); // discovery etc. — let it through
    } catch { /* not ours */ }
  });
  const toolStarts: Array<Record<string, unknown>> = [];
  const done = new Promise<void>((resolve) =>
    client.on("event", (e) => {
      if (e.type === "tool_execution_start") toolStarts.push(e as unknown as Record<string, unknown>);
      if (e.type === "agent_end") resolve();
    }));

  await client.send({
    type: "prompt",
    message:
      "You MUST use the mcp tool. First discover the exact tool name of the echo tool " +
      "on the echo server (use mcp with search or describe), then invoke it with text 'hello'. " +
      "Do not ask questions.",
  });

  const req = await invokePrompt;
  const title = JSON.parse((req as { title: string }).title);
  // The unwrapped per-tool identity — NEVER a bare "mcp" for an invoke.
  expect(title.tool).toMatch(/^mcp:/);
  expect(title.tool).toContain("echo");
  expect(String(title.summary)).toContain("MCP");
  client.respondUi((req as { id: string }).id, { value: "Allow" });

  await done;
  // Discovery calls must not have prompted: every recorded prompt except the
  // invoke is unexpected (discovery is safe-defaulted in the bridge).
  const nonInvoke = prompts.filter((p) => !(typeof p.tool === "string" && (p.tool as string).startsWith("mcp:")));
  expect(nonInvoke).toEqual([]);

  // requireIntent injected a required `intent` into the adapter's proxy tool
  // schema, so the model must author a customer-facing intent on the MCP invoke.
  const mcpInvoke = toolStarts.find(
    (t) =>
      t.toolName === "mcp" &&
      typeof (t.args as { tool?: unknown } | undefined)?.tool === "string" &&
      ((t.args as { tool: string }).tool).includes("echo"),
  );
  expect(mcpInvoke, "expected an mcp invoke tool_execution_start").toBeDefined();
  const intent = (mcpInvoke!.args as { intent?: unknown }).intent;
  expect(typeof intent).toBe("string");
  expect((intent as string).trim().length).toBeGreaterThan(0);
}, 180_000);

test.skipIf(!KEY)("docs-round #34: an MCP install asks with the URL, and Deny writes nothing", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcp-install-"));
  const agentDir = path.join(tmp, ".pi", "agent");
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, PI_MCP_ADAPTER_RELPATH),
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: {
      ...process.env, ...PROVIDER_ENV,
      HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"), PI_CODING_AGENT_DIR: agentDir,
    } as Record<string, string>,
    cwd: tmp,
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
      client.respondUi(req.id as string, { value: "Deny" });
    } catch { /* not ours */ }
  });

  // Loopback http is the one non-https URL the adapter accepts; nothing listens on port 9.
  const url = "http://127.0.0.1:9/mcp";
  const isInstall = (p: Record<string, unknown>): boolean => String(p.tool).startsWith("mcp-manage:install:");
  const asked = await askUntil(
    () => client.send({
      type: "prompt",
      message: `Call the \`mcp\` tool right now with exactly these arguments: {"action":"install","url":"${url}"}. `
        + "Do not explain, do not ask questions, do not reply in prose: make the tool call.",
    }),
    () => prompts.some(isInstall),
  );
  expect(asked, "model never called mcp install across 3 attempts").toBe(true);
  const p = prompts.find(isInstall)!;
  expect(p.tool).toBe(`mcp-manage:install:${url}`);
  expect(p.summary).toBe(`MCP: install ${url} into your global MCP config`);
  // Denied: neither config the adapter can write to exists (global <agentDir>/mcp.json, project <cwd>/.mcp.json).
  expect(fs.existsSync(path.join(agentDir, "mcp.json"))).toBe(false);
  expect(fs.existsSync(path.join(tmp, ".mcp.json"))).toBe(false);
}, 180_000);
