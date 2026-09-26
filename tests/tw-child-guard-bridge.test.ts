/**
 * PRD §12 (2026-09-26), live, end to end on the tintinweb path: the child guard runs
 * INSIDE the app's Pi process, forced into every child by the owned patch + the
 * bridge's child policy, and holds a child to the three §12 layers — the approved
 * boundary, ask→the user (denied here), and approved writes that really happen.
 *
 * Asserted on the bridge's native `hv.audit` rows (source "subagent") and on the
 * filesystem — never on `tool_execution_start`, which fires before any handler.
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
type Ui = { id: string; method?: string; title?: string; message?: string };

const WRITER = `---\nname: writer\ndescription: Test agent that declares a write-capable toolset.\ntools: read, write\n---\nYou are a test agent. Do exactly what the task says, using your tools.\n`;
const VAGUE = `---\nname: vague\ndescription: Test agent that declares NO tools line.\n---\nYou are a test agent. Do exactly what the task says, using your tools.\n`;

let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

async function boot(globalRules: unknown[]) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twguard-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twguard-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twguard-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agents", "writer.md"), WRITER);
  fs.writeFileSync(path.join(agentDir, "agents", "vague.md"), VAGUE);
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: globalRules, workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { agentDir, providerEnv: PROVIDER_ENV, rulesFile, model: MODEL });
  const uis: Ui[] = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => { uis.push(u as Ui); if ((u as Ui).method === "select") c.respondUi((u as Ui).id, { value: "Deny" }); });
  await c.start();
  const childRows = () => uis.filter((u) => u.method === "notify").flatMap((u) => {
    try { const m = JSON.parse(u.message ?? "") as Record<string, unknown>; return m.kind === "hv.audit" && m.source === "subagent" ? [m] : []; } catch { return []; }
  });
  return { c, ws, childRows };
}

const delegate = (agent: string, task: string) =>
  `Use the Agent tool right now with subagent_type '${agent}', run_in_background false, description 'Test task', and this exact prompt: '${task}'. Do nothing else yourself.`;

// Since Phase 4 (2026-09-26) that ask is PUT TO THE USER on the parent's channel; this harness
// answers every select "Deny", so the child is still refused — by the user now, not by a clamp.
test.skipIf(!KEY)("inside its boundary, a write the rules would ASK about is asked, and a Deny holds", async () => {
  const { c, ws, childRows } = await boot([{ layer: "tool", pattern: "subagent*", action: "allow" }]);
  const denied = () => childRows().some((r) => r.tool === "write" && r.decision === "deny");
  const ok = await askUntil(() => c.send({ type: "prompt", message: delegate("writer", "create a file called note.txt containing the word HI") }), denied, { waitMs: 90_000 });
  expect(ok, JSON.stringify(childRows())).toBe(true);
  const row = childRows().find((r) => r.tool === "write" && r.decision === "deny")!;
  expect(row.wouldHave, "the parent would have PROMPTED — that is what got clamped").toBe("ask");
  expect(row.agent).toBe("writer");
  expect(typeof row.runId).toBe("string");
  expect(fs.existsSync(path.join(ws, "note.txt")), "the denied write must not have happened").toBe(false);
}, 300_000);

test.skipIf(!KEY)("an APPROVED write actually succeeds — no layer beneath refuses it blanket", async () => {
  const { c, ws, childRows } = await boot([
    { layer: "tool", pattern: "subagent*", action: "allow" },
    { layer: "tool", pattern: "write", action: "allow" },
  ]);
  const wrote = () => fs.existsSync(path.join(ws, "note.txt"));
  const ok = await askUntil(() => c.send({ type: "prompt", message: delegate("writer", "create a file called note.txt containing the word HI") }), wrote, { waitMs: 90_000 });
  expect(ok, JSON.stringify(childRows())).toBe(true);
  expect(childRows().some((r) => r.tool === "write" && r.decision === "allow" && r.agent === "writer")).toBe(true);
}, 300_000);

test.skipIf(!KEY)("an agent with no tools: line is held to read-only, though tintinweb handed it bash", async () => {
  const { c, ws, childRows } = await boot([
    { layer: "tool", pattern: "subagent*", action: "allow" },
    { layer: "tool", pattern: "bash", action: "allow" },
  ]);
  const refused = () => childRows().some((r) => r.tool === "bash" && r.decision === "deny");
  const ok = await askUntil(() => c.send({ type: "prompt", message: delegate("vague", "run the bash command: touch marker.txt") }), refused, { waitMs: 90_000 });
  expect(ok, JSON.stringify(childRows())).toBe(true);
  expect(fs.existsSync(path.join(ws, "marker.txt")), "an allow RULE never widens the approved boundary").toBe(false);
}, 300_000);
