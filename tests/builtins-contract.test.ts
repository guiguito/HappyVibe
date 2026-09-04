import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

/**
 * §13 round 6 CONTRACT TEST — the built-in-tool toggles, proven end to end at
 * startup with NO API key and NO model turn.
 *
 * Why it matters: disabling Plan mode must remove the model's ENTRY point
 * (plan_start) as well as the UI, because leaving Plan Mode is human-only by
 * design (§23 — there is deliberately no plan_off tool). If a Pi pin bump ever
 * stopped the bridge from suppressing those registrations, a session could be
 * driven into a read-only mode with no exit.
 *
 * Both probes are pure RPC queries, so no key is needed:
 *   get_commands → the bridge's `/hv-plan` slash command
 *   /hv-tools    → a bridge command (handled locally, before the model) whose
 *                  hv.tools notify lists the registered tool names
 */

const runtime = path.join(process.cwd(), "pi-runtime");
// Built from PI_CLI_RELPATH, never hardcoded: the entry moved to dist/bundle/cli.js
// and the old dist/cli.js is broken at Pi 0.85.0 (tests/pi-cli-entry.test.ts). A
// literal here would spawn a different binary than the app does, and the
// existsSync guard below would skip these tests in SILENCE the day it is deleted.
const CLI = path.join(runtime, PI_CLI_RELPATH);
const BRIDGE = path.join(runtime, "extensions/happyvibe-bridge.ts");
const PLAN_TOOLS = ["plan_start", "plan_complete", "plan_status_update"];

let client: PiClient;
afterEach(() => client?.stop());

/** Spawn the bridge with a given HV_BUILTINS and report what it registered. */
async function probe(builtins: string | undefined): Promise<{ tools: string[]; commands: string[] }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-builtins-"));
  const home = path.join(tmp, "home");
  const work = path.join(tmp, "work");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  client = new PiClient({
    execPath: process.execPath,
    args: [
      CLI, "--mode", "rpc", "--no-session",
      "-e", BRIDGE,
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DEEPSEEK_API_KEY: "sk-contract-noop",
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      ...(builtins === undefined ? {} : { HV_BUILTINS: builtins }),
    } as Record<string, string>,
    cwd: work,
  });

  const tools: string[] = [];
  client.on("ui-request", (m) => {
    const r = m as { method?: string; message?: string };
    if (r.method !== "notify") return;
    try {
      const p = JSON.parse(r.message ?? "") as { kind?: string; tools?: Array<{ name: string }> };
      if (p.kind === "hv.tools") for (const t of p.tools ?? []) tools.push(t.name);
    } catch { /* not JSON */ }
  });

  await client.start();

  const res = await client.send({ type: "get_commands" });
  const commands = ((res.data as { commands?: Array<{ name: string }> })?.commands ?? []).map((c) => c.name);

  // /hv-tools is a bridge slash command: Pi dispatches it locally (no model call)
  // and the bridge answers with an hv.tools notify.
  await client.send({ type: "prompt", message: "/hv-tools" });
  for (let i = 0; i < 50 && tools.length === 0; i++) await new Promise((r) => setTimeout(r, 100));

  return { tools, commands };
}

test.skipIf(!fs.existsSync(CLI))("HV_BUILTINS unset ⇒ plan tools and /hv-plan are registered", async () => {
  const { tools, commands } = await probe(undefined);
  expect(tools.length).toBeGreaterThan(0); // the notify arrived at all
  for (const t of PLAN_TOOLS) expect(tools).toContain(t);
  expect(tools).toContain("ask_user");
  expect(commands.some((c) => c.includes("hv-plan"))).toBe(true);
}, 30_000);

test.skipIf(!fs.existsSync(CLI))(
  'HV_BUILTINS {"plan":false} ⇒ plan tools AND the human /hv-plan exit are both gone',
  async () => {
    const { tools, commands } = await probe(JSON.stringify({ plan: false }));
    expect(tools.length).toBeGreaterThan(0);
    for (const t of PLAN_TOOLS) expect(tools).not.toContain(t);
    expect(commands.some((c) => c.includes("hv-plan"))).toBe(false);
    // ask_user is force-coupled to plan in parseBuiltins, but plan is OFF here,
    // so the config's own askUser default (true) applies.
    expect(tools).toContain("ask_user");
  },
  30_000,
);

test.skipIf(!fs.existsSync(CLI))('HV_BUILTINS {"plan":false,"askUser":false} ⇒ ask_user is gone too', async () => {
  const { tools } = await probe(JSON.stringify({ plan: false, askUser: false }));
  expect(tools.length).toBeGreaterThan(0);
  expect(tools).not.toContain("ask_user");
}, 30_000);

test.skipIf(!fs.existsSync(CLI))("a corrupt HV_BUILTINS fails OPEN — every built-in stays registered", async () => {
  const { tools, commands } = await probe("{not json");
  expect(tools.length).toBeGreaterThan(0);
  for (const t of PLAN_TOOLS) expect(tools).toContain(t);
  expect(tools).toContain("ask_user");
  expect(commands.some((c) => c.includes("hv-plan"))).toBe(true);
}, 30_000);

/**
 * §32: the web group, proven against a real Pi at startup with no key and no
 * model turn — the same shape as the plan arms above.
 *
 * The absence half is the load-bearing one. A switch that leaves its tools
 * registered is a switch that lies on the Built-in tools page, and there is no
 * renderer test that can see a Pi registration.
 */
const WEB_TOOLS_EXPECTED = ["web_search", "web_fetch", "web_map", "web_crawl"];

test.skipIf(!fs.existsSync(CLI))("§32: the four web tools register by default", async () => {
  const { tools } = await probe(undefined);
  for (const t of WEB_TOOLS_EXPECTED) expect(tools, t).toContain(t);
}, 30_000);

test.skipIf(!fs.existsSync(CLI))('HV_BUILTINS {"web":false} ⇒ no web tool exists, and its neighbours are untouched', async () => {
  const { tools } = await probe(JSON.stringify({ web: false }));
  expect(tools.length).toBeGreaterThan(0);
  for (const t of WEB_TOOLS_EXPECTED) expect(tools, t).not.toContain(t);
  // One switch, one group: §28's ten and §26's three are not collateral.
  expect(tools).toContain("browser_open");
  expect(tools).toContain("terminal_run");
}, 30_000);
test.skipIf(!fs.existsSync(CLI))(
  "§31: HV_BUILTINS {\"document\":false} unregisters document_read; the default registers it",
  async () => {
    const off = await probe(JSON.stringify({ document: false }));
    expect(off.tools.length).toBeGreaterThan(0);
    expect(off.tools).not.toContain("document_read");
    // The other groups are untouched by this key — one tool, no coupling.
    expect(off.tools).toContain("ask_user");

    const on = await probe(undefined);
    expect(on.tools).toContain("document_read");
  },
  30_000,
);
