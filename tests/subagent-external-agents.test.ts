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
import { DISABLED_BUILTIN_AGENTS, EXTERNAL_CLI_AGENTS, UNSUPPORTED_BUILTIN_AGENTS, isExternalCliAgent } from "../pi-runtime/extensions/hv-rules";

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
  // exercised through its pure core instead (see disabledAgentOverrides), and
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

describe("disabledAgentOverrides — the pure half of the settings write", () => {
  it("disables the whole union on an empty settings object", async () => {
    const { disabledAgentOverrides } = await import("../src/main/subagentSettings");
    const out = disabledAgentOverrides({}, {});
    const overrides = (out.subagents as { agentOverrides: Record<string, { disabled: boolean }> }).agentOverrides;
    expect(Object.keys(overrides).sort()).toEqual([...DISABLED_BUILTIN_AGENTS].sort());
    for (const name of DISABLED_BUILTIN_AGENTS) expect(overrides[name].disabled).toBe(true);
  });

  it("still disables all SIX external-CLI agents after the set became a union", async () => {
    // The regression this file exists for. When the writer started handling two
    // sets (2026-08-30), dropping the original six while adding the new two
    // would look perfectly healthy on the Agents page — and would silently
    // re-open the boundary hole the whole external-CLI decision closed.
    const { disabledAgentOverrides } = await import("../src/main/subagentSettings");
    const overrides = (disabledAgentOverrides({}, {}).subagents as { agentOverrides: Record<string, { disabled: boolean }> }).agentOverrides;
    for (const name of ["claude-code", "claude-code-writer", "codex-exec", "codex-exec-writer", "cursor-agent", "cursor-agent-writer"]) {
      expect(overrides[name]?.disabled, `${name} disabled`).toBe(true);
    }
  });

  it("disables the unsupported builtins, and for a reason that is not safety", async () => {
    // researcher: declares web tools Pi does not register, so under our ceiling
    // it resolves to ["read"] and cannot do what it advertises.
    // oracle: needs a forked context, which defaultSubagentContext: "fresh" denies.
    const { disabledAgentOverrides } = await import("../src/main/subagentSettings");
    const overrides = (disabledAgentOverrides({}, {}).subagents as { agentOverrides: Record<string, { disabled: boolean }> }).agentOverrides;
    expect(overrides["researcher"]?.disabled).toBe(true);
    expect(overrides["oracle"]?.disabled).toBe(true);
    // They are NOT refused at the bridge — that guard stays scoped to the six.
    expect(isExternalCliAgent("researcher")).toBe(false);
    expect(isExternalCliAgent("oracle")).toBe(false);
  });

  it("preserves unrelated top-level keys — Pi reads this file for its own settings", () => {
    // The one that matters. <agentDir>/settings.json is Pi's, not ours; this is
    // simply the first thing in the app to write it. Replacing it would silently
    // discard whatever Pi or the user put there.
    return import("../src/main/subagentSettings").then(({ disabledAgentOverrides }) => {
      const out = disabledAgentOverrides({ theme: "dark", models: { default: "x" } }, {});
      expect(out.theme).toBe("dark");
      expect(out.models).toEqual({ default: "x" });
    });
  });

  it("preserves a user's own agentOverrides entry for a different agent", async () => {
    const { disabledAgentOverrides } = await import("../src/main/subagentSettings");
    const out = disabledAgentOverrides({
      subagents: { agentOverrides: { "code-explorer": { model: "openrouter/x" } }, defaultThinking: "low" },
    }, {});
    const subagents = out.subagents as Record<string, unknown>;
    expect(subagents.defaultThinking, "sibling subagents keys survive").toBe("low");
    const overrides = subagents.agentOverrides as Record<string, Record<string, unknown>>;
    expect(overrides["code-explorer"]).toEqual({ model: "openrouter/x" });
    expect(overrides["claude-code"].disabled).toBe(true);
  });

  it("is idempotent, and merges into an existing entry rather than replacing it", async () => {
    const { disabledAgentOverrides } = await import("../src/main/subagentSettings");
    const once = disabledAgentOverrides({
      subagents: { agentOverrides: { "claude-code": { model: "keep-me" } } },
    }, {});
    const twice = disabledAgentOverrides(structuredClone(once), {});
    expect(twice).toEqual(once);
    const overrides = (once.subagents as Record<string, unknown>).agentOverrides as Record<string, Record<string, unknown>>;
    expect(overrides["claude-code"], "existing keys kept beside disabled").toEqual({ model: "keep-me", disabled: true });
  });
});

// ── The two sets mean different things (2026-08-30) ────────────────────────
describe("the disabled sets stay distinct", () => {
  it("the union is exactly the two sets, with nothing shared", () => {
    expect([...DISABLED_BUILTIN_AGENTS].sort()).toEqual(
      [...new Set([...EXTERNAL_CLI_AGENTS, ...UNSUPPORTED_BUILTIN_AGENTS])].sort(),
    );
    for (const n of UNSUPPORTED_BUILTIN_AGENTS) expect(EXTERNAL_CLI_AGENTS.has(n)).toBe(false);
  });

  it("only the external-CLI set is a bridge refusal", () => {
    // Merging them would silently promote "cannot work here" to "we refuse to
    // launch this", and demote the boundary guarantee to a settings file.
    for (const n of EXTERNAL_CLI_AGENTS) expect(isExternalCliAgent(n)).toBe(true);
    for (const n of UNSUPPORTED_BUILTIN_AGENTS) expect(isExternalCliAgent(n)).toBe(false);
  });

  it("every unsupported name is a builtin upstream actually ships", () => {
    // A typo here disables nothing and would never be noticed.
    const names = readFileSync(
      new URL("../pi-runtime/node_modules/pi-subagents/src/agents/builtin-names.ts", import.meta.url),
      "utf8",
    );
    for (const n of UNSUPPORTED_BUILTIN_AGENTS) expect(names, `${n} is an upstream builtin`).toContain(`"${n}"`);
  });
});

// ── Per-agent enable/disable (2026-08-30) ──────────────────────────────────
//
// The disabled set became a DEFAULT the user can override. Only EXPLICIT choices
// are stored, so `userChoice ?? defaultFor(name)` — the same shape skills use
// (skills/registry.ts `activation?.[skill.id] ?? true`). Seeding the config with
// today's defaults would freeze this round's judgement about `researcher`.
describe("resolveDisabledAgents", () => {
  const load = async () => (await import("../src/main/subagentSettings")).resolveDisabledAgents;

  it("defaults: the six forced, the two unsupported, nothing else", async () => {
    const resolve = await load();
    expect([...resolve({})].sort()).toEqual([...DISABLED_BUILTIN_AGENTS].sort());
  });

  it("a user can enable an unsupported builtin", async () => {
    const resolve = await load();
    const out = resolve({ researcher: true });
    expect(out.has("researcher")).toBe(false);
    expect(out.has("oracle"), "the other default is untouched").toBe(true);
  });

  it("a user can disable an agent that is on by default", async () => {
    const resolve = await load();
    expect(resolve({ scout: false }).has("scout")).toBe(true);
  });

  it("an external-CLI agent stays disabled however hard the config asks", async () => {
    // The boundary guarantee is not a preference. main owns this, so a config
    // file edited by hand cannot re-open it either.
    const resolve = await load();
    for (const n of EXTERNAL_CLI_AGENTS) {
      expect(resolve({ [n]: true }).has(n), `${n} stays disabled`).toBe(true);
    }
  });

  it("an unknown name in the config is inert", async () => {
    const resolve = await load();
    expect(resolve({ "no-such-agent": false }).has("scout")).toBe(false);
  });
});

describe("disabledAgentOverrides writes the user's choice, not just ours", () => {
  const load = async () => (await import("../src/main/subagentSettings")).disabledAgentOverrides;

  it("writes an explicit `false` for an agent the user re-enabled", async () => {
    // Omitting the key is NOT enough: a previous run already wrote
    // `disabled: true` to this file, and only an explicit false clears it.
    const write = await load();
    const first = write({}, {});
    const ov1 = (first.subagents as Record<string, Record<string, Record<string, unknown>>>).agentOverrides;
    expect(ov1["researcher"].disabled).toBe(true);

    const second = write(first, { researcher: true });
    const ov2 = (second.subagents as Record<string, Record<string, Record<string, unknown>>>).agentOverrides;
    expect(ov2["researcher"].disabled, "explicitly re-enabled, not merely absent").toBe(false);
  });

  it("keeps a user's model override across a disable/enable round trip", async () => {
    const write = await load();
    const withModel = { subagents: { agentOverrides: { scout: { model: "openrouter/x" } } } };
    const off = write(withModel, { scout: false });
    const on = write(off, { scout: true });
    const ov = (on.subagents as Record<string, Record<string, Record<string, unknown>>>).agentOverrides;
    expect(ov["scout"]).toEqual({ model: "openrouter/x", disabled: false });
  });

  it("still forces all six external-CLI agents when the set is dynamic", async () => {
    // The regression: the resolved set became a function of user config, and
    // losing the forced six inside it would look perfectly healthy on screen.
    const write = await load();
    const ov = (write({}, { scout: false, researcher: true }).subagents as Record<string, Record<string, Record<string, unknown>>>).agentOverrides;
    for (const n of EXTERNAL_CLI_AGENTS) expect(ov[n].disabled, `${n}`).toBe(true);
  });

  it("preserves Pi's own top-level keys and subagents siblings", async () => {
    const write = await load();
    const out = write({ theme: "dark", subagents: { defaultThinking: "low" } }, { scout: false });
    expect(out.theme).toBe("dark");
    expect((out.subagents as Record<string, unknown>).defaultThinking).toBe("low");
  });
});
