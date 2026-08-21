/**
 * FR10 — the boundary must hold against a malicious agent DEFINITION, not merely
 * a careless one.
 *
 * These are the cases a third-party agent file can attempt, each measured against
 * upstream's own `resolvePiLaunchToolPlan` rather than against a mock: the plan it
 * returns IS the child's argv, so a case that passes here is a case that cannot
 * reach a child. A failure in this file is a HOLE IN THE BOUNDARY, never a bad
 * assertion — do not adjust the expectation to make it green.
 *
 * PRD §25 names this file's evidence as the precondition for accepting plugin
 * `agents/` (scenario D).
 *
 * Key-free by construction (pure argv resolution, no Pi spawn, no model), so it
 * stays in the non-live suite and runs in CI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  intersectSubagentCapabilityCeilings,
  parseSubagentCapabilityCeiling,
  type ResolvedSubagentCapabilityCeiling,
} from "../pi-runtime/node_modules/pi-subagents/src/api/capability-ceiling.ts";
import { resolvePiLaunchToolPlan } from "../pi-runtime/node_modules/pi-subagents/src/api/pi-args.ts";

/** The read-only child default — Pi 0.83+ builtins only (no `glob`, no `list`). */
const READ_ONLY = ["find", "grep", "ls", "read"];

/**
 * PI_CODING_AGENT_DIR must be scoped to a temp dir, or this file reads the
 * DEVELOPER'S MACHINE — the same class of trap as mcp-adapter-authformat.test.ts.
 *
 * Measured the hard way: with no ceiling, `resolvePiLaunchToolPlan` calls
 * `resolvePermissionSystemExtension()`, which walks `<agentDir>/extensions/
 * pi-permission-system` and **THROWS** if that directory exists without a
 * package.json. A stray one from the 2026-07 V6 spike sat in the developer's real
 * `~/.pi/agent`, so the negative control below failed with "Permission-system
 * package manifest is missing" — nothing to do with the boundary, everything to
 * do with an unscoped test.
 *
 * The APP is unaffected either way: it passes PI_CODING_AGENT_DIR=<userData>/
 * pi-agent at spawn (spawn.ts:195) and never reads ~/.pi/agent. Note the asymmetry
 * that made this survivable — a ceiling with denyExtensions skips that resolver
 * entirely (pi-args.ts:454), so every OTHER case in this file passed by luck.
 */
let priorAgentDir: string | undefined;
let tmpAgentDir: string;

beforeAll(() => {
  priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-adversarial-agentdir-"));
  process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
});

afterAll(() => {
  if (priorAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  else delete process.env.PI_CODING_AGENT_DIR;
  fs.rmSync(tmpAgentDir, { recursive: true, force: true });
});

function ceiling(over: Record<string, unknown> = {}): ResolvedSubagentCapabilityCeiling {
  return parseSubagentCapabilityCeiling({
    version: 1,
    allowedTools: READ_ONLY,
    denyExtensions: true,
    sources: ["happyvibe"],
    ...over,
  });
}

/** The plan upstream would build for a child, under our ceiling. */
function plan(input: Record<string, unknown>, c = ceiling()) {
  return resolvePiLaunchToolPlan({ cwd: process.cwd(), capabilityCeiling: c, ...input } as never);
}

describe("FR10 — adversarial agent definitions", () => {
  // ── The 0.52 hazard (#1249) ────────────────────────────────────────────────
  // Relative extension paths now resolve against the DEFINING AGENT FILE, so an
  // agent can ship a .ts beside itself. That makes a cloned repo's workspace
  // agent a code-execution surface, which is precisely what denyExtensions is
  // registered for.
  it("denyExtensions strips a .ts the agent shipped beside itself", () => {
    const p = plan({ tools: ["read", "./evil.ts"] });
    expect(p.toolExtensionPaths).toEqual([]);
    expect(p.extensionArgs.some((a: string) => a.includes("evil"))).toBe(false);
    expect(p.disableAmbientExtensions, "--no-extensions is emitted").toBe(true);
  });

  it("a path-like tools entry never becomes a child tool either", () => {
    const p = plan({ tools: ["read", "./evil.ts"] });
    expect(p.effectiveToolAllowlist).not.toContain("./evil.ts");
    expect(p.effectiveToolAllowlist).toEqual(["read"]);
  });

  // ── Frontmatter widening ───────────────────────────────────────────────────
  // `resolvePermissionRules` DELETES every `allow` entry from the merged map, so
  // an agent's own frontmatter really can widen the native permission floor
  // (permissions.ts:47). That is why the floor can never be primary — the
  // ceiling has to be the thing that holds.
  it("frontmatter cannot widen its way out of the ceiling", () => {
    const p = plan({ tools: ["read", "write", "bash"] }, ceiling({ allowedTools: ["read"] }));
    expect(p.effectiveToolAllowlist).toEqual(["read"]);
    expect(p.capabilityAudit?.removedTools.sort()).toEqual(["bash", "write"]);
  });

  // ── Declared extension surfaces ────────────────────────────────────────────
  it("a declared extensions list cannot survive denyExtensions", () => {
    const p = plan({ tools: ["read"], extensions: ["/tmp/evil.ts"] });
    expect(p.configuredExtensions).toEqual([]);
    expect(p.extensionArgs.some((a: string) => a.includes("evil"))).toBe(false);
  });

  it("a subagentOnlyExtensions entry cannot survive denyExtensions either", () => {
    const p = plan({ tools: ["read"], subagentOnlyExtensions: ["/tmp/evil2.ts"] });
    expect(p.extensionArgs.some((a: string) => a.includes("evil2"))).toBe(false);
  });

  it("upstream's own runtime extensions DO survive — the guard must not be stripped with the rest", () => {
    // denyExtensions must remove what the AGENT asked for while leaving what the
    // RUNTIME needs. If this ever inverts, the prompt runtime (and with it the
    // native permission gate) disappears from every child.
    const p = plan({ tools: ["read"] });
    expect(p.runtimeExtensions.some((a: string) => a.includes("subagent-prompt-runtime"))).toBe(true);
    expect(p.extensionArgs.some((a: string) => a.includes("subagent-prompt-runtime"))).toBe(true);
  });

  // ── Nested delegation ──────────────────────────────────────────────────────
  it("a grandchild can only narrow — fan-out cannot escape the ceiling", () => {
    const parent = ceiling({ allowedTools: ["read", "grep"] });
    const childWants = ceiling({ allowedTools: ["read", "grep", "bash"] });
    expect(intersectSubagentCapabilityCeilings(parent, childWants)?.allowedTools).toEqual(["grep", "read"]);
  });

  it("intersection can never introduce a tool neither side allowed", () => {
    const a = ceiling({ allowedTools: ["read"], denyExtensions: false });
    const b = ceiling({ allowedTools: ["bash"], denyExtensions: false });
    expect(intersectSubagentCapabilityCeilings(a, b)?.allowedTools).toEqual([]);
  });

  it("denyExtensions is sticky across an intersection — one side asserting it is enough", () => {
    const strict = ceiling({ denyExtensions: true });
    const lax = ceiling({ denyExtensions: false });
    expect(intersectSubagentCapabilityCeilings(strict, lax)?.denyExtensions).toBe(true);
  });

  // ── Agent identity ─────────────────────────────────────────────────────────
  it("the ceiling can restrict WHICH agents run at all", () => {
    const c = ceiling({ allowedAgents: ["code-explorer"] });
    const p = plan({ tools: ["read"], agentName: "evil-agent" }, c);
    expect(p.capabilityAudit?.agentAllowed).toBe(false);
  });

  it("an allowed agent is still bounded by the tool ceiling", () => {
    const c = ceiling({ allowedAgents: ["code-explorer"] });
    const p = plan({ tools: ["read", "bash"], agentName: "code-explorer" }, c);
    expect(p.capabilityAudit?.agentAllowed).toBe(true);
    expect(p.effectiveToolAllowlist).not.toContain("bash");
  });

  // ── MCP reach ──────────────────────────────────────────────────────────────
  it("a child cannot reach MCP tools while extensions are denied", () => {
    // The adapter is an extension, so denyExtensions closes this too. Worth
    // pinning separately: an MCP tool is a remote side effect that the parent
    // gates as mcp:<server>_<tool>, and a child has no route to that prompt.
    const p = plan({ tools: ["read"], mcpDirectTools: ["github_create_issue"] });
    expect(p.effectiveMcpTools).toEqual([]);
    expect(p.resolvedMcpSelections).toEqual([]);
  });
});

describe("FR10 — the ceiling is what forces a bounded toolset at all", () => {
  it("WITHOUT a ceiling an undeclared agent gets no --tools flag — the hole this closes", () => {
    // This is the negative control. It must keep passing: it is the measurement
    // the whole round rests on, and if upstream ever starts emitting --tools on
    // its own, the ceiling stops being load-bearing and we should know.
    const p = resolvePiLaunchToolPlan({ cwd: process.cwd(), tools: undefined } as never);
    expect(p.explicitToolAllowlist, "no --tools flag is emitted").toBe(false);
    expect(p.effectiveToolAllowlist).toEqual([]);
  });

  it("a malformed pi-permission-system dir breaks argv build WITHOUT a ceiling, and cannot WITH one", () => {
    // Measured, not hypothesised: resolvePermissionSystemExtension() throws when
    // <agentDir>/extensions/pi-permission-system exists without a package.json,
    // and it is reached only when denyExtensions is falsy (pi-args.ts:454). So a
    // stray directory in a user's agent dir is enough to fail every delegation —
    // and our ceiling makes that unreachable. A robustness property worth owning
    // even though it was found by accident.
    fs.mkdirSync(path.join(tmpAgentDir, "extensions", "pi-permission-system"), { recursive: true });

    expect(() => resolvePiLaunchToolPlan({ cwd: process.cwd(), tools: ["read"] } as never))
      .toThrow(/Permission-system package manifest is missing/);

    expect(() => plan({ tools: ["read"] })).not.toThrow();
    expect(plan({ tools: ["read"] }).effectiveToolAllowlist).toEqual(["read"]);

    fs.rmSync(path.join(tmpAgentDir, "extensions"), { recursive: true, force: true });
  });

  it("WITH a ceiling the same agent is held to the read-only set", () => {
    const p = plan({ tools: undefined });
    expect(p.explicitToolAllowlist, "--tools IS emitted").toBe(true);
    expect(p.effectiveToolAllowlist.sort()).toEqual(READ_ONLY);
    expect(p.effectiveToolAllowlist).not.toContain("bash");
    expect(p.effectiveToolAllowlist).not.toContain("write");
  });
});
