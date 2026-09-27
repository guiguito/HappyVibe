/**
 * The owned patch's remaining parts (PRD §3 2026-09-26; scripts/tintinweb-hunks.mjs):
 * P3-model and P4 by BEHAVIOUR, importing the patched vendored modules directly; P5
 * and P6 by PLACEMENT, because they sit behind a worker thread and the in-process
 * bus — their behaviour is pinned by the live workflow/steer bridge tests. Every
 * "without the host" case is here too: the patch must be inert outside HappyVibe,
 * which is what makes it upstreamable (tw1.md § Gate 8).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveModel } from "../pi-runtime/node_modules/@tintinweb/pi-subagents/src/model-resolver";
import { loadSettings } from "../pi-runtime/node_modules/@tintinweb/pi-subagents/src/settings";

const POLICY = Symbol.for("hv:child-policy");
const bag = globalThis as unknown as Record<symbol, unknown>;
const registry = {
  getAvailable: () => [{ provider: "openrouter", id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
  getAll: () => [],
  find: (provider: string, id: string) => ({ provider, id }),
};
const SRC = "pi-runtime/node_modules/@tintinweb/pi-subagents/src";
const src = (f: string): string => fs.readFileSync(path.join(SRC, f), "utf8");

describe("P3-model — only an exact provider/modelId under HappyVibe (§16: refuse, never substitute)", () => {
  afterEach(() => { delete bag[POLICY]; });

  it("an exact, usable reference still resolves", () => {
    bag[POLICY] = {};
    expect(resolveModel("openrouter/deepseek/deepseek-v4-flash", registry as never)).toMatchObject({ provider: "openrouter" });
  });

  it("a fuzzy name is refused with a sentence, not guessed", () => {
    bag[POLICY] = {};
    const r = resolveModel("deepseek", registry as never);
    expect(typeof r).toBe("string");
    expect(r).toMatch(/Model "deepseek" is not an exact provider\/modelId/);
  });

  it("without the host, upstream's fuzzy match is untouched", () => {
    expect(typeof resolveModel("deepseek", registry as never)).toBe("object");
  });
});

describe("P4 — a project's subagents.json never overrides the host", () => {
  let cwd: string;
  const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hv-p4-"));
    fs.mkdirSync(path.join(cwd, ".pi"));
    fs.writeFileSync(path.join(cwd, ".pi", "subagents.json"), JSON.stringify({ schedulingEnabled: true }));
    // The global side is Pi's getAgentDir() — never the developer's real ~/.pi/agent.
    process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hv-p4-agent-"));
  });
  afterEach(() => {
    delete process.env.HV_HOST;
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  });

  it("HV_HOST=1 reads the global file only", () => {
    process.env.HV_HOST = "1";
    expect(loadSettings(cwd).schedulingEnabled).toBeUndefined();
  });

  it("without the host, upstream still merges the project file over the global one", () => {
    expect(loadSettings(cwd).schedulingEnabled).toBe(true);
  });
});

describe("placement — the parts that sit behind a worker or the bus", () => {
  it("P5-gate: executeGate returns its refusal BEFORE pi.exec", () => {
    const s = src("workflow/host.ts");
    const fn = s.indexOf("async function executeGate");
    const mark = s.indexOf("hv-patch:P5-gate", fn);
    expect(mark).toBeGreaterThan(fn);
    expect(mark).toBeLessThan(s.indexOf("pi.exec(", fn));
    expect(s.slice(mark, s.indexOf("pi.exec(", fn))).toMatch(/process\.env\.HV_HOST === "1"\) return \{ ok: false/);
  });

  it("P5-saved: under the host, saved workflows come from the agent dir only", () => {
    const s = src("workflow/saved.ts");
    expect(s).toMatch(/process\.env\.HV_HOST === "1" \? \[\] : \[join\(cwd, "\.pi", "workflows"\), join\(cwd, "\.agents", "workflows"\)\]/);
    expect(s).toMatch(/join\(getAgentDir\(\), "workflows"\)/);
  });

  it("P3-refuse: in spawn() itself, before an id is minted — so every spawn path passes it", () => {
    const s = src("agent-manager.ts");
    const spawn = s.indexOf("  spawn(\n");
    const mark = s.indexOf("hv-patch:P3-refuse", spawn);
    expect(mark).toBeGreaterThan(spawn);
    expect(mark).toBeLessThan(s.indexOf("randomUUID()", spawn));
  });

  it("P6: steer and workflow-stop are on the bus, wired to the manager, and torn down", () => {
    const rpc = src("cross-extension-rpc.ts");
    expect(rpc).toMatch(/"subagents:rpc:steer"/);
    expect(rpc).toMatch(/"subagents:rpc:workflow-stop"/);
    expect(rpc).toMatch(/if \(!isTopLevelAgent\(record\)\) throw new Error\("Agent is owned by another agent or workflow"\);\n\s+if \(!manager\.steer/);
    const idx = src("index.ts");
    expect(idx).toMatch(/steer: \(id: string, message: string\) =>/);
    expect(idx).toMatch(/stopWorkflow: \(runId: string\) =>[\s\S]{0,200}workflowTasks\.get\(runId\)/);
    expect(idx).toMatch(/rpcHandle\?\.unsubSteer\(\);/);
    expect(idx).toMatch(/rpcHandle\?\.unsubWorkflowStop\(\);/);
  });

  it("P6-settled: a workflow tool run announces its end on the bus, before the model's notification", () => {
    expect(src("index.ts")).toMatch(/runWorkflowTask\(ctx, task\)\.then\(\(\) => \{ pi\.events\.emit\("subagents:workflow-settled", \{ runId: task\.id, status: task\.status \}\); notifyWorkflowFinished\(task\); \}\)/);
  });

  it("P6-progress: the workflow runtime's progress is forwarded on the bus", () => {
    expect(src("index.ts")).toMatch(/onProgress: entries => \{ updateWorkflowProgressBatch\(task, entries\); pi\.events\.emit\("subagents:workflow-progress", \{ runId: task\.id, entries \}\); \}/);
  });

  it("the P3 child policy and the child-spawn getter use the symbols hv-child-policy.ts exports", async () => {
    const { CHILD_POLICY, CHILD_SPAWN } = await import("../pi-runtime/extensions/hv-child-policy");
    expect(CHILD_POLICY).toBe(Symbol.for("hv:child-policy"));
    expect(CHILD_SPAWN).toBe(Symbol.for("pi-subagents:child-spawn"));
    expect(src("agent-runner.ts")).toMatch(/Symbol\.for\("hv:child-policy"\)/);
    expect(src("child-context.ts")).toMatch(/Symbol\.for\("pi-subagents:child-spawn"\)/);
  });
});
