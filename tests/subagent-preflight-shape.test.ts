/**
 * The preflight CONTRACT SHAPE the boundary prompt reads, pinned against a real
 * `resolveSubagentLaunchContract` call over the real bundled agents.
 *
 * This file exists because of a bug the unit tests could not catch. The boundary
 * summariser was tested with hand-built inputs, so it passed while the bridge fed
 * it fields from the wrong level: the result is `{ok, contract}` and everything
 * lives under `contract`, but the code read `result.tools` and friends. Every
 * field came back `undefined`, which the bridge correctly interprets as "cannot
 * describe this child's reach" — and therefore refused every delegation. Four
 * live tests stalled for 150s and 121s before this was found, at ~10 minutes a
 * run. A shape test costs milliseconds and needs no key.
 *
 * KEY-FREE by measurement, not by hope: preflight builds model *candidates* but
 * never calls a model, so this runs in CI and in the normal `npm test`.
 *
 * If a bump moves any of these paths, this fails in seconds with the field named,
 * instead of a stall in the live batch.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSubagentLaunchContract } from "../pi-runtime/node_modules/pi-subagents/src/api/preflight.ts";

const runtime = path.join(process.cwd(), "pi-runtime");

let priorAgentDir: string | undefined;
let agentDir: string;

beforeAll(() => {
  // Scope PI_CODING_AGENT_DIR or preflight reads the developer's own ~/.pi/agent
  // (see tests/subagent-adversarial.test.ts for what that costs).
  priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-preflight-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (priorAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  else delete process.env.PI_CODING_AGENT_DIR;
  fs.rmSync(agentDir, { recursive: true, force: true });
});

const contractFor = async (agent: string) =>
  (await resolveSubagentLaunchContract({ agent, cwd: process.cwd() })) as Record<string, any>;

describe("preflight result shape", () => {
  it("nests everything under `contract`, NOT at the top level", () => {
    // The exact mistake this file was written for.
    return contractFor("code-explorer").then((res) => {
      expect(res.ok).toBe(true);
      expect(res.contract, "the payload is under .contract").toBeDefined();
      expect(res.tools, "…and NOT at the top level").toBeUndefined();
      expect(res.skills).toBeUndefined();
    });
  });

  it("carries every field the approval prompt reads", async () => {
    const { contract: k } = await contractFor("code-explorer");
    expect(k.tools.effectiveAllowlist, "the child's tools").toBeInstanceOf(Array);
    expect(typeof k.tools.explicitAllowlist, "declared-vs-inherited").toBe("boolean");
    expect(k.skills, "skills block").toBeDefined();
    expect(k.skills.resolved).toBeInstanceOf(Array);
    expect(typeof k.context, "fresh | fork | profile").toBe("string");
    expect(typeof k.inheritSkills).toBe("boolean");
    expect(typeof k.inheritProjectContext).toBe("boolean");
    expect(k.agent.shadowedCandidates).toBeInstanceOf(Array);
    expect(k.tools.configuredExtensions).toBeInstanceOf(Array);
    expect(k.tools.toolExtensionPaths).toBeInstanceOf(Array);
  });

  it("resolves the bundled agents as read-only and DECLARED", async () => {
    for (const agent of ["code-explorer", "agents-md-maker"]) {
      const { ok, contract: k } = await contractFor(agent);
      expect(ok, agent).toBe(true);
      expect(k.tools.explicitAllowlist, `${agent} declares its own tools`).toBe(true);
      expect([...k.tools.effectiveAllowlist].sort(), agent).toEqual(["find", "grep", "ls", "read"]);
    }
  });

  it("reports an unknown agent as not-ok rather than throwing", async () => {
    const res = await contractFor("definitely-not-an-agent");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("missing_agent");
  });

  it("does NOT expose outputMode — FR8 cannot surface it, and must not pretend to", async () => {
    // If a future bump adds it, this fails and the prompt can start showing it.
    const { contract: k } = await contractFor("code-explorer");
    expect("outputMode" in k).toBe(false);
  });

  it("has no side effects: resolving twice changes nothing on disk", async () => {
    const before = fs.readdirSync(path.join(agentDir, "agents")).sort();
    await contractFor("code-explorer");
    await contractFor("code-explorer");
    expect(fs.readdirSync(path.join(agentDir, "agents")).sort()).toEqual(before);
  });
});

describe("the bridge reads the contract at the right level", () => {
  it("destructures `contract` rather than the result", () => {
    const src = fs.readFileSync(path.join(runtime, "extensions", "happyvibe-bridge.ts"), "utf8");
    expect(src, "reads res.contract").toMatch(/res\?\.contract|const k = res/);
    expect(src, "never reads tools off the result").not.toMatch(/\bres\.tools\b/);
  });
});


/**
 * FR8/FR11 — the two inheritance defaults, asserted as RESOLVED VALUES.
 *
 * §12 states the skills hole is "opt-in, because inheritSkills defaults false".
 * That sentence is load-bearing and was previously guarded only by
 * `typeof === "boolean"`, which a flipped default passes happily. A flip would be
 * invisible in every other way: every child would inherit the user's approved
 * skills, no test would fail, and no UI would change — the §14 trust gate quietly
 * extended to processes it was never reviewed for.
 *
 * Asserted against the BUNDLED agents, which declare neither key, so the value
 * read here IS the default.
 */
describe("inheritance defaults (the ones §12 and §14 rest on)", () => {
  it("an agent that declares nothing does NOT inherit skills", async () => {
    for (const agent of ["code-explorer", "agents-md-maker"]) {
      const { contract: k } = await contractFor(agent);
      expect(k.inheritSkills, `${agent} must not inherit skills by default`).toBe(false);
    }
  });

  it("…and does not inherit project context either", async () => {
    // Same class: AGENTS.md reaching a child is a context decision the approval
    // prompt reports (FR8), so its default must not drift silently.
    const { contract: k } = await contractFor("code-explorer");
    expect(k.inheritProjectContext).toBe(false);
  });

  it("neither bundled agent declares the keys — so the values above are defaults", () => {
    // Guards the test itself: if someone adds `inheritSkills: false` to the
    // bundled agents, the assertions above would pass while measuring the
    // declaration rather than the default.
    for (const f of ["code-explorer.md", "agents-md-maker.md"]) {
      const md = fs.readFileSync(path.join(runtime, "agents", f), "utf8");
      expect(md, f).not.toMatch(/^inheritSkills:/m);
      expect(md, f).not.toMatch(/^inheritProjectContext:/m);
    }
  });
});
