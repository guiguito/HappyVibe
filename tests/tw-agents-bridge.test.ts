/**
 * PRD §12 (2026-09-26), live: on the tintinweb path the Agents page inventory and the
 * roster injected into the model's prompt come from tintinweb's own discovery — our
 * bundled agents and the project's, and NONE of upstream's defaults (general-purpose,
 * Explore, Plan), which disableDefaultAgents turns off.
 */
import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { TINTINWEB_SETTINGS } from "../src/main/subagentSettings";
import { MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient | undefined;
afterEach(() => { client?.stop(); client = undefined; });

// Key-free: /hv-agents answers without a model turn.
test("the Agents page lists our agents and the project's — never upstream's defaults", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twagents-agent-"));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twagents-ws-"));
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twagents-sess-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  fs.mkdirSync(path.join(ws, ".pi", "agents"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".pi", "agents", "project-helper.md"), "---\nname: project-helper\ndescription: a project agent\n---\nHelp.\n");
  fs.writeFileSync(path.join(agentDir, "subagents.json"), JSON.stringify(TINTINWEB_SETTINGS));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ subagents: { agentOverrides: { worker: { disabled: true } } } }));
  const rulesFile = path.join(agentDir, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const spec = resolvePiSpawn(ws, sessionDir, runtime, { subagentsLib: "tintinweb", agentDir, providerEnv: { ...PROVIDER_ENV }, rulesFile, model: MODEL });
  const agentsNotes: Array<{ agents: Array<{ name: string; source: string; enabled?: boolean; tools?: string[] }> }> = [];
  const c = new PiClient(spec);
  client = c;
  c.on("ui-request", (u) => {
    const r = u as { method?: string; message?: string };
    if (r.method !== "notify") return;
    try { const m = JSON.parse(r.message ?? "") as { kind?: string }; if (m.kind === "hv.agents") agentsNotes.push(m as never); } catch { /* not ours */ }
  });
  await c.start();
  await c.send({ type: "prompt", message: "/hv-agents" });
  const t0 = Date.now();
  while (!agentsNotes.length && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 200));
  const agents = agentsNotes[0].agents;
  const names = agents.map((a) => a.name).sort();
  expect(names).toEqual(["agents-md-maker", "code-explorer", "project-helper", "worker"]);
  for (const absent of ["general-purpose", "Explore", "Plan"]) expect(names).not.toContain(absent);
  expect(agents.find((a) => a.name === "code-explorer")!.source).toBe("bundled");
  expect(agents.find((a) => a.name === "project-helper")!.source).toBe("project");
  // An undeclared project agent is shown with what the boundary will actually allow.
  expect(agents.find((a) => a.name === "project-helper")!.tools).toEqual(["find", "grep", "ls", "read"]);
  // Switched off on the page: still listed (so it can come back on), marked disabled.
  expect(agents.find((a) => a.name === "worker")!.enabled).toBe(false);
}, 60_000);
