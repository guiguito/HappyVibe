/**
 * PRD §12 (2026-08-28) — upstream's external-CLI agents are refused at source.
 *
 * pi-subagents 0.58 grew upstream's builtin roster from 7 agents to 13, and the
 * six new ones run a third-party CLI in its own process (`runner: external-cli`).
 * The capability ceiling cannot bound one, the child guard cannot run inside one,
 * and its tool calls never reach the audit log — upstream refuses ask/deny rules
 * for external runners by design. So §12's three-layer guarantee does not reach
 * inside them, and they arrive DELEGATABLE the moment the pin lands.
 *
 * Two halves, and the split is the point:
 *   - ENFORCEMENT is ours, in the bridge, because a PROJECT-scope
 *     `.pi/settings.json` override beats the user scope outright (pi-subagents
 *     agents.ts returns on the project override before it ever reads the user
 *     one). A cloned repo could otherwise re-enable one.
 *   - HYGIENE is the settings write, which keeps them out of the injected roster
 *     so the model never proposes one and spends a turn being refused.
 *
 * Key-free: source scans plus the real config writer against a temp agent dir.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXTERNAL_CLI_AGENTS, isExternalCliAgent } from "../pi-runtime/extensions/hv-rules";

const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");
const CONFIG = path.join(__dirname, "..", "src", "main", "config.ts");
const SETTINGS = path.join(__dirname, "..", "src", "main", "subagentSettings.ts");

describe("external-CLI sub-agents are refused at the boundary", () => {
  it("names exactly the six upstream external-CLI builtins", () => {
    expect([...EXTERNAL_CLI_AGENTS].sort()).toEqual([
      "claude-code",
      "claude-code-writer",
      "codex-exec",
      "codex-exec-writer",
      "cursor-agent",
      "cursor-agent-writer",
    ]);
  });

  it("matches by exact name and never by prefix", () => {
    expect(isExternalCliAgent("claude-code")).toBe(true);
    expect(isExternalCliAgent("cursor-agent-writer")).toBe(true);
    // A user's OWN agent whose name merely contains one of ours is not refused:
    // the six are upstream builtin names, and shadowing one is the user's
    // business — their file is a native Pi child the ceiling governs normally.
    expect(isExternalCliAgent("claude-code-review-helper")).toBe(false);
    expect(isExternalCliAgent("my-codex-exec")).toBe(false);
    expect(isExternalCliAgent("code-explorer")).toBe(false);
    expect(isExternalCliAgent(undefined)).toBe(false);
    expect(isExternalCliAgent(42)).toBe(false);
  });

  it("the bridge refuses via isExternalCliAgent, never an inlined literal", () => {
    // Same discipline as WAIT_TOOLS: a literal in the bridge drifts silently
    // when upstream renames an adapter or adds a seventh. The set is the one place.
    const src = readFileSync(BRIDGE, "utf8");
    expect(src).toMatch(/isExternalCliAgent\(subagentName\)/);
    for (const name of EXTERNAL_CLI_AGENTS) {
      expect(src, `bridge must not inline "${name}"`).not.toContain(`"${name}"`);
    }
  });

  it("refuses BEFORE the boundary is resolved, so no ceiling is ever widened", () => {
    // resolveBoundary is also what WIDENS the session ceiling for an approved
    // boundary. An external agent must never reach it: the ceiling cannot bound
    // that agent, so widening for it would be a real grant with nothing
    // enforcing it. Source order is the only way to assert this without
    // invoking the whole tool_call handler.
    const src = readFileSync(BRIDGE, "utf8");
    const refusal = src.indexOf("isExternalCliAgent(subagentName)");
    const resolve = src.indexOf("await resolveBoundary(subagentName)");
    expect(refusal, "the refusal exists").toBeGreaterThan(-1);
    expect(resolve, "resolveBoundary still exists").toBeGreaterThan(-1);
    expect(refusal, "refusal precedes resolveBoundary").toBeLessThan(resolve);
  });

  it("leaves an audit row, because a refused delegation IS a permission decision", () => {
    // Unlike the wait-tool guard (a behavioural nudge with no audit, by design),
    // this denies work the model asked for. §6 says the audit log records
    // permission denials, and a silent refusal leaves the user wondering why
    // nothing happened.
    // `hv.audit` is the envelope audit() emits (see its definition); the call
    // site spells the helper, so assert on the helper and the decision.
    const src = readFileSync(BRIDGE, "utf8");
    const refusal = src.indexOf("isExternalCliAgent(subagentName)");
    expect(refusal).toBeGreaterThan(-1);
    const block = src.slice(refusal, refusal + 1600);
    expect(block, "the refusal block audits").toMatch(/audit\(ctx\.ui, \{[^}]*decision: "deny"/);
    expect(block, "under the per-agent rule name, not the bare tool").toContain("tool: permTool");
  });

  it("`summary` is declared before every audit call that reads it", () => {
    // Found while adding the refusal above. `const summary` used to sit AFTER
    // three §12 refusal paths that audit with it, so each was a temporal-dead-zone
    // ReferenceError. It failed CLOSED — Pi's beforeToolCall re-throws as
    // "Extension failed, blocking execution" (agent-session.js:236-241), and
    // emitToolCall has no try/catch of its own unlike emitUserBash/emitContext —
    // so the boundary held, but a refusal surfaced as an extension crash with NO
    // hv.audit row instead of a clean denial naming its reason.
    //
    // Nothing caught it and nothing would have: happyvibe-bridge.ts is in NEITHER
    // typecheck include list (tsconfig.node.json lists only the pure hv-*.ts
    // modules), so TS never saw the use-before-declaration it would normally
    // reject, and no test invokes the handler on those three paths.
    const src = readFileSync(BRIDGE, "utf8");
    const decl = src.indexOf("const summary = mcp?.display ?? summarize(tool, input)");
    expect(decl, "summary is declared").toBeGreaterThan(-1);
    const firstUse = src.indexOf("summary, decision:");
    expect(firstUse, "something audits with it").toBeGreaterThan(-1);
    expect(decl, "declaration precedes the first audit that reads it").toBeLessThan(firstUse);
  });

  it("the reason names the agent and says why, so the model can act on it", () => {
    // A refusal the model cannot understand becomes a retry loop.
    const src = readFileSync(BRIDGE, "utf8");
    const refusal = src.indexOf("isExternalCliAgent(subagentName)");
    const block = src.slice(refusal, refusal + 1600);
    expect(block, "interpolates the agent name").toContain("${subagentName}");
    expect(block, "offers the alternative").toMatch(/instead/);
  });
});

describe("the upstream roster is trimmed at source too", () => {
  let priorAgentDir: string | undefined;
  let tmpUserData: string;

  // writeSubagentSettings resolves its path through agentDir(), which is
  // <userData>/pi-agent — an Electron path, unavailable here. The writer is
  // exercised through its pure core instead (see externalAgentOverrides), and
  // the wiring is asserted by source scan. Same split as subagent-config.test.ts.
  beforeEach(() => {
    priorAgentDir = process.env.PI_CODING_AGENT_DIR;
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ext-agents-"));
    process.env.PI_CODING_AGENT_DIR = tmpUserData;
  });

  afterEach(() => {
    if (priorAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    else delete process.env.PI_CODING_AGENT_DIR;
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  });

  it("writes agentOverrides, the key pi-subagents actually reads", () => {
    // NOT `overrides`. pi-subagents parses settings.subagents.agentOverrides
    // INTO an internal field it calls `overrides` (agents.ts:1129), so writing
    // `overrides` here parses to nothing and silently does nothing at all.
    expect(readFileSync(SETTINGS, "utf8")).toContain("agentOverrides");
    expect(readFileSync(CONFIG, "utf8")).toMatch(/export function writeSubagentSettings/);
  });

  it("never reaches for disableBuiltins", () => {
    // disableBuiltins is all-or-nothing and would also remove worker and
    // reviewer — the two the fleet round wants to adopt. Absence-tested so a
    // later "simplification" cannot quietly take out the seven native ones.
    // Comments are stripped first: both files DISCUSS disableBuiltins, on purpose
    // — the record of a rejected option is worth keeping. What must not exist is
    // code that writes it.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const f of [CONFIG, SETTINGS]) {
      expect(stripComments(readFileSync(f, "utf8")), `no blunt instrument in ${path.basename(f)}`)
        .not.toContain("disableBuiltins");
    }
  });

  it("upstream still reads agentOverrides from the settings file", () => {
    // The whole hygiene half rests on this key name. If a pin renames it, the
    // write becomes a no-op with no symptom, so pin it against upstream itself.
    const agents = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "agents", "agents.ts"),
      "utf8",
    );
    expect(agents).toMatch(/subagentsObject\.agentOverrides/);
    expect(agents, "and a disabled builtin is filtered out of the roster")
      .toMatch(/agent\.disabled !== true/);
  });

  it("a PROJECT override still beats the user scope — why enforcement is ours", () => {
    // This is the measurement that decided the architecture. If upstream ever
    // makes the user scope win, the settings write could become the enforcement
    // and the bridge refusal could be reconsidered. Until then it cannot.
    const agents = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "agents", "agents.ts"),
      "utf8",
    );
    const project = agents.indexOf("const projectOverride = projectSettings.overrides[agent.name]");
    const user = agents.indexOf("const userOverride = userSettings.overrides[agent.name]");
    expect(project).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(-1);
    expect(project, "project override is consulted first").toBeLessThan(user);
    // …and returns, rather than merging, so the user value is never reached.
    expect(agents.slice(project, user)).toMatch(/return applyGlobalThinking\(/);
  });
});

describe("externalAgentOverrides — the pure half of the settings write", () => {
  it("disables all six on an empty settings object", async () => {
    const { externalAgentOverrides } = await import("../src/main/subagentSettings");
    const out = externalAgentOverrides({});
    const overrides = (out.subagents as { agentOverrides: Record<string, { disabled: boolean }> }).agentOverrides;
    expect(Object.keys(overrides).sort()).toEqual([...EXTERNAL_CLI_AGENTS].sort());
    for (const name of EXTERNAL_CLI_AGENTS) expect(overrides[name].disabled).toBe(true);
  });

  it("preserves unrelated top-level keys — Pi reads this file for its own settings", () => {
    // The one that matters. <agentDir>/settings.json is Pi's, not ours; this is
    // simply the first thing in the app to write it. Replacing it would silently
    // discard whatever Pi or the user put there.
    return import("../src/main/subagentSettings").then(({ externalAgentOverrides }) => {
      const out = externalAgentOverrides({ theme: "dark", models: { default: "x" } });
      expect(out.theme).toBe("dark");
      expect(out.models).toEqual({ default: "x" });
    });
  });

  it("preserves a user's own agentOverrides entry for a different agent", async () => {
    const { externalAgentOverrides } = await import("../src/main/subagentSettings");
    const out = externalAgentOverrides({
      subagents: { agentOverrides: { "code-explorer": { model: "openrouter/x" } }, defaultThinking: "low" },
    });
    const subagents = out.subagents as Record<string, unknown>;
    expect(subagents.defaultThinking, "sibling subagents keys survive").toBe("low");
    const overrides = subagents.agentOverrides as Record<string, Record<string, unknown>>;
    expect(overrides["code-explorer"]).toEqual({ model: "openrouter/x" });
    expect(overrides["claude-code"].disabled).toBe(true);
  });

  it("is idempotent, and merges into an existing entry rather than replacing it", async () => {
    const { externalAgentOverrides } = await import("../src/main/subagentSettings");
    const once = externalAgentOverrides({
      subagents: { agentOverrides: { "claude-code": { model: "keep-me" } } },
    });
    const twice = externalAgentOverrides(structuredClone(once));
    expect(twice).toEqual(once);
    const overrides = (once.subagents as Record<string, unknown>).agentOverrides as Record<string, Record<string, unknown>>;
    expect(overrides["claude-code"], "existing keys kept beside disabled").toEqual({ model: "keep-me", disabled: true });
  });
});
