/**
 * PRD §12 (2026-09-26), live: the bridge gates tintinweb's `Agent` under the SAME
 * rule vocabulary (`subagent:<agent>`), with the boundary modal, and refuses what
 * the user switched off — before any prompt. Asserted on the bridge's `hv.audit`
 * envelopes and on the permission `select` itself, never on `tool_execution_start`
 * (which fires before tool_call handlers and so proves nothing about a block).
 */
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { TINTINWEB_SETTINGS } from "../src/main/subagentSettings";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { askUntil } from "./reask";

const runtime = path.join(process.cwd(), "pi-runtime");
type Ui = { id: string; method?: string; title?: string; message?: string; options?: string[] };

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

function setup(rules: unknown[], extra: (agentDir: string) => void = () => {}) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twgate-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twgate-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twgate-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(ws, `f${i}.txt`), `hello ${i}\n`);
  extra(agentDir);
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: rules, workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { subagentsLib: "tintinweb", agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
  const uis: Ui[] = [];
  const c = new PiClient(spec);
  client = c;
  return { c, uis };
}

const audits = (uis: Ui[]) =>
  uis.filter((u) => u.method === "notify").flatMap((u) => {
    try { const m = JSON.parse(u.message ?? "") as Record<string, unknown>; return m.kind === "hv.audit" ? [m] : []; } catch { return []; }
  });
const permissionPrompts = (uis: Ui[]) =>
  uis.filter((u) => u.method === "select").flatMap((u) => {
    try { const t = JSON.parse(u.title ?? "") as Record<string, unknown>; return t.kind === "hv.permission" ? [{ ui: u, t }] : []; } catch { return []; }
  });

test.skipIf(!KEY)("a deny rule on subagent:<agent> refuses an Agent call with no prompt", async () => {
  const { c, uis } = setup([{ layer: "tool", pattern: "subagent:worker", action: "deny" }]);
  c.on("ui-request", (u) => { uis.push(u as Ui); if ((u as Ui).method === "select") c.respondUi((u as Ui).id, { value: "Deny" }); });
  await c.start();
  const denied = () => audits(uis).some((a) => a.tool === "subagent:worker" && a.decision === "deny" && a.source === "rule");
  const ok = await askUntil(() => c.send({ type: "prompt", message: "Use the Agent tool now with subagent_type 'worker', description 'List files', prompt 'List the files here.'. Do nothing else." }), denied);
  expect(ok, JSON.stringify(audits(uis))).toBe(true);
  expect(permissionPrompts(uis).filter((p) => p.t.tool === "subagent:worker")).toEqual([]);
}, 240_000);

test.skipIf(!KEY)("no rule ⇒ the boundary modal for subagent:<agent>; Deny ⇒ a user deny row", async () => {
  const { c, uis } = setup([]);
  c.on("ui-request", (u) => { uis.push(u as Ui); if ((u as Ui).method === "select") c.respondUi((u as Ui).id, { value: "Deny" }); });
  await c.start();
  const prompted = () => permissionPrompts(uis).some((p) => p.t.tool === "subagent:code-explorer");
  const ok = await askUntil(() => c.send({ type: "prompt", message: "Use the Agent tool now with subagent_type 'code-explorer', description 'List files', prompt 'List the files here.'. Do nothing else." }), prompted);
  expect(ok).toBe(true);
  const p = permissionPrompts(uis).find((x) => x.t.tool === "subagent:code-explorer")!;
  expect(p.ui.options).toEqual(["Allow", "Allow for session", "Deny"]);
  const b = p.t.boundary as { agent: string; tools: string[]; declared: boolean; writeCapable: string[]; context: string };
  expect(b).toMatchObject({ agent: "code-explorer", declared: true, writeCapable: [], context: "fresh" });
  expect(b.tools).toEqual(["find", "grep", "ls", "read"]);
  await new Promise((r) => setTimeout(r, 1500));
  expect(audits(uis).some((a) => a.tool === "subagent:code-explorer" && a.decision === "deny" && a.source === "user")).toBe(true);
}, 240_000);

test.skipIf(!KEY)("an agent switched off on the Agents page is refused before any prompt", async () => {
  const { c, uis } = setup([], (agentDir) => {
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ subagents: { agentOverrides: { worker: { disabled: true } } } }));
  });
  c.on("ui-request", (u) => { uis.push(u as Ui); if ((u as Ui).method === "select") c.respondUi((u as Ui).id, { value: "Deny" }); });
  await c.start();
  const refused = () => audits(uis).some((a) => a.tool === "subagent:worker" && a.decision === "deny" && a.source === "rule");
  const ok = await askUntil(() => c.send({ type: "prompt", message: "Use the Agent tool now with subagent_type 'worker', description 'List files', prompt 'List the files here.'. Do nothing else." }), refused);
  expect(ok).toBe(true);
  expect(permissionPrompts(uis).filter((p) => p.t.tool === "subagent:worker")).toEqual([]);
}, 240_000);

test.skipIf(!KEY)("get_subagent_result with wait:true is refused by the never-block rule", async () => {
  const { c, uis } = setup([{ layer: "tool", pattern: "subagent:*", action: "allow" }]);
  const ends: Array<{ toolName?: string; result?: { content?: Array<{ text?: string }> }; isError?: boolean }> = [];
  c.on("ui-request", (u) => { uis.push(u as Ui); if ((u as Ui).method === "select") c.respondUi((u as Ui).id, { value: "Allow" }); });
  c.on("event", (e) => { const ev = e as { type?: string }; if (ev.type === "tool_execution_end") ends.push(e as never); });
  await c.start();
  const refused = () => ends.some((e) => e.toolName === "get_subagent_result" && JSON.stringify(e.result ?? {}).includes("End your turn"));
  const ok = await askUntil(() => c.send({
    type: "prompt",
    message: "Use the Agent tool with subagent_type 'code-explorer', description 'List files', prompt 'List the files here.' (background). Then IMMEDIATELY call get_subagent_result with that agent's id and wait: true. Do exactly that.",
  }), refused, { attempts: 3, waitMs: 60_000 });
  expect(ok, JSON.stringify(ends.map((e) => e.toolName))).toBe(true);
}, 300_000);
