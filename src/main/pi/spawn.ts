import path from "node:path";
import { existsSync } from "node:fs";
import { buildIdentity } from "../appendSystem";

/**
 * Node-capable exec path for Electron-as-node children. On macOS, LaunchServices
 * registers any process whose binary lives in a regular .app bundle as a
 * Foreground app — so ELECTRON_RUN_AS_NODE children spawned from the main
 * Electron binary each get a generic "exec" Dock icon. The bundled Helper apps
 * carry LSUIElement=1 (no Dock presence), so spawn through one instead (same
 * trick as VS Code's extension host). Works in dev (Electron.app) and packaged
 * builds (electron-builder renames helpers after productName).
 */
export function nodeExecPath(): string {
  if (process.platform !== "darwin") return process.execPath;
  const m = process.execPath.match(/^(.*)\/Contents\/MacOS\/([^/]+)$/);
  if (!m) return process.execPath;
  const helper = `${m[1]}/Contents/Frameworks/${m[2]} Helper (Plugin).app/Contents/MacOS/${m[2]} Helper (Plugin)`;
  return existsSync(helper) ? helper : process.execPath;
}

/** The embedded Pi CLI entry.
    `dist/bundle/cli.js`, NOT `dist/cli.js`: Pi moved its own `bin.pi` to the
    bundled runtime at 0.84.3, and by 0.85.0 the modular `dist/cli.js` no longer
    runs at all — it statically imports `dist/experimental/server.js`, which
    imports `@earendil-works/pi-server`, a package Pi declares in NO dependency
    field. `node dist/cli.js --version` dies with ERR_MODULE_NOT_FOUND, which
    takes every Pi-spawning test red at once. Track upstream's `bin.pi`;
    tests/pi-cli-entry.test.ts derives it from the installed package. */
export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
/** pi-subagents extension entry (its package.json `pi.extensions`) — B6. */
export const PI_SUBAGENTS_RELPATH = "node_modules/pi-subagents/src/extension/index.ts";
/** Embedded pi CLI the pi-subagents child spawn must use (no global `pi`; s0.3).
    A shell wrapper, not .bin/pi: the packaged app has no `node` for the shebang,
    so the wrapper routes through the bundled Electron helper (ELECTRON_RUN_AS_NODE)
    and falls back to `node` in dev. */
export const PI_SUBAGENT_BIN_RELPATH = "bin/pi-node.sh";
/** pi-mcp-adapter extension entry (its package.json `pi.extensions`) — MCP support. */
export const PI_MCP_ADAPTER_RELPATH = "node_modules/pi-mcp-adapter/index.ts";

export interface PiSpawnOptions {
  /** Global default model (config.ts); falls back to the spike default. */
  model?: { provider: string; modelId: string } | null;
  /** §16 round 16: session → global, resolved by resolveThinking. Passed
   *  UNCONDITIONALLY when it resolves, which is what stops Pi's own
   *  settings.json default (`defaultThinkingLevel`) being consulted at all —
   *  the same reason --provider/--model never had this bug. */
  thinking?: string | null;
  /** App-owned Pi agent dir → PI_CODING_AGENT_DIR (auth.json, models.json). */
  agentDir?: string;
  /** Provider API-key env vars (providers.ts buildProviderEnv). */
  providerEnv?: Record<string, string>;
  /** Absolute path to an existing Pi session file to resume (opaque blob from our index). */
  resumeFile?: string;
  /** Permission rules JSON → HV_RULES_FILE (B4; bridge loads at startup, reloads on /hv-rules-reload). */
  rulesFile?: string;
  /** Round 3 #14: persistent "bypass all permissions" resolved for this session
      (workspace ?? global). true → HV_BYPASS=1 → bridge starts in dangerous mode. */
  bypass?: boolean;
  /** §12 FR7: where the child guard appends its per-run decision JSONL →
      HV_CHILD_AUDIT_DIR. Inherited by every child (all three of pi-subagents'
      spawn sites pass `{...process.env}`), so the guard needs nothing else.
      Main owns the directory and reads it path-confined. */
  childAuditDir?: string;
  /** §13 round 6: global on/off for built-in custom tools (plan mode, ask_user,
      and §26's grouped Terminal entry), resolved at spawn → HV_BUILTINS (same
      pattern as HV_BYPASS). The keys are listed EXPLICITLY below, so a new
      toggle that is not added there never reaches the bridge. */
  builtinTools?: { plan: boolean; askUser: boolean; planAppend: string; terminal: boolean; intent: boolean; browser: boolean; web: boolean; document: boolean; memory: boolean; memoryAppend: string };
  /** §33: the global memory scope's directory → HV_MEMORY_GLOBAL_DIR. Absent when the Memory
      built-in is off (and always for the utility client), and then the bridge registers no
      memory tool and injects nothing — off costs 0. */
  memoryGlobalDir?: string;
  /** §33: this workspace's memory directory → HV_MEMORY_WORKSPACE_DIR. ABSENT means "workspace
      memory is off here" (the per-workspace toggle, or no workspace at all) and the bridge must
      then omit the workspace block entirely rather than render an empty one. Never an empty
      string — an empty env var is a value, and `if (dir)` would read it as off anyway, but the
      absence is what the spawn test pins. */
  memoryWorkspaceDir?: string;
  /** §14 Skills: absolute skill-dir paths this session is allowed to load
      (approved ∩ enabled ∩ active-for-workspace). Enforced with `--no-skills`
      (kills Pi's own discovery — Pi never sees an unapproved skill) plus one
      `--skill <dir>` per entry (additive even with --no-skills). Always
      `--no-skills`, even when empty, so discovery is off by default. */
  skills?: string[];
  /** §24 Commands: absolute FILE paths (one per approved command) this session
      is allowed to load as prompt templates. Enforced with `--no-prompt-templates`
      (which already ships unconditionally — Pi never sees an unapproved command)
      plus one `--prompt-template <file>` per entry, additive exactly like
      `--skill` is with `--no-skills`. Per FILE, never per directory: a directory
      would silently approve whatever lands in it later (PRD §24). */
  promptTemplates?: string[];
  /** §14: per-session skills manifest JSON → HV_SKILLS_FILE (the bridge serves
      use_skill and detects raw SKILL.md reads from it). */
  skillsFile?: string;
  /** §19: where pi-subagents keeps its cached model exclusions, so main can read
   *  them and surface a silent model substitution (modelExclusions.ts). */
  modelExclusionsFile?: string;
  /** Extended prompt-cache retention → PI_CACHE_RETENTION=long, pi-ai's only
      knob for it (pi docs/usage.md; anthropic.js resolveCacheRetention). Buys a
      1h cache TTL on Anthropic/Bedrock and `prompt_cache_retention:"24h"` on
      OpenAI, instead of the 5min/in-memory default. Global setting, resolved at
      spawn — same pattern as HV_BYPASS. */
  longCache?: boolean;
  /** HappyVibe's own session id, which becomes HV_SUBAGENT_OWNER for
      extensions/hv-owner-seed.ts to claim pi-subagents' completion-owner id
      (0.51 / upstream #1225). Without it a RESPAWNED parent — hibernation wake,
      MCP live-reload, app relaunch — is refused its own detached delegation's
      result, silently. Stable across respawn by construction, which is the whole
      requirement. Absent for the utility client, which never delegates. */
  sessionId?: string;
  /**
   * §16 round 21: the global APPEND_SYSTEM.md, passed EXPLICITLY.
   *
   * `--append-system-prompt` REPLACES Pi's own discovery of this file rather
   * than adding to it (resource-loader.js only discovers `if (!appendSources)`),
   * so once we pass the identity we must pass the user's file too or their
   * additions silently vanish. Absent or non-existent ⇒ not passed at all: a
   * missing path is appended as LITERAL TEXT (resolvePromptInput returns a
   * non-path input verbatim), which would put a filesystem path in the prompt.
   *
   * Consequence, accepted as an improvement (PRD §16 round 21): passing the
   * flag also stops Pi discovering a WORKSPACE `.pi/APPEND_SYSTEM.md`. That
   * file used to REPLACE the global additions with nothing in the UI saying so;
   * it now has no effect, so a cloned repo cannot rewrite the system prompt.
   */
  appendFile?: string;
}

/**
 * Builds the spawn spec for the Pi CLI process.
 * @param runtimeDir - absolute path to the pi-runtime directory (resolved by
 *   the caller, e.g. from runtimeDir.ts in the main process, or hardcoded in
 *   tests). Keeping this param explicit ensures spawn.ts has NO electron import
 *   and remains importable by Vitest.
 */
export function resolvePiSpawn(workspace: string, sessionDir: string, runtimeDir: string, opts: PiSpawnOptions = {}) {
  // §16 finding 7, CLOSED 2026-08-29: no model resolved means NO model flags.
  // This used to pin the session to a hardcoded deepseek/deepseek-v4-flash — a
  // provider the user may never have configured, and increasingly likely to be
  // wrong now that the catalog offers 29 of them. Pi's CLI accepts the flags as
  // optional (`if (parsed.model)`, dist/main.js buildSessionOptions).
  //
  // The 2026-07-30 A/B of omitting them was inconclusive, and this change does
  // not depend on settling it: a CHAT session with no model is refused before
  // it ever gets here (ipc.ts), so the flagless path is not how a real turn
  // runs. It exists for the utility client, which drives /hv-login before any
  // provider is configured and never runs a model turn at all.
  const model = opts.model ?? null;
  return {
    execPath: nodeExecPath(),
    args: [
      path.join(runtimeDir, PI_CLI_RELPATH),
      "--mode", "rpc",
      // Resume = Pi's own `--session <path>`: main.js resolves a path arg via
      // resolveSessionPath → openSessionOrExit, reopening the JSONL in place.
      ...(opts.resumeFile ? ["--session", opts.resumeFile] : []),
      // B6: pi-subagents (RPC-validated, s0.3). Loaded as an -e extension per
      // its package.json `pi.extensions` entry; the subagent tool it registers
      // is a normal tool_call, so the bridge's permission gate applies.
      // Claims pi-subagents' completion-owner id before it can mint a random
      // one — see extensions/hv-owner-seed.ts for why that matters. MUST precede
      // pi-subagents, which mints the id inside its own registration, and Pi
      // loads -e extensions strictly sequentially in argv order. It registers no
      // tools and no tool_call handler, so it does not touch the gate-is-last
      // invariant documented below. Pinned by tests/mcp-spawn.test.ts.
      "-e", path.join(runtimeDir, "extensions/hv-owner-seed.ts"),
      "-e", path.join(runtimeDir, PI_SUBAGENTS_RELPATH),
      // MCP: pi-mcp-adapter registers the `mcp` proxy tool via registerTool,
      // so the bridge's permission gate applies (docs/validation/m1.md).
      // Config: PI_CODING_AGENT_DIR/mcp.json (global) + <cwd>/.mcp.json (workspace).
      "-e", path.join(runtimeDir, PI_MCP_ADAPTER_RELPATH),
      // The HappyVibe bridge is the SOLE permission path in RPC mode.
      // @gotgenes/pi-permission-system was removed from the spawn after Gate V6
      // proved it is TUI-only (both its prompt paths gate on ctx.hasUI, which is
      // false in --mode rpc; its non-UI fallback silently denies), and UNVENDORED
      // entirely on 2026-08-02: it was 2.4 MB shipped into every .app plus a paid
      // live test, all to keep re-proving a frozen package still behaves as
      // docs/validation/v6.md already records. Do not add it back to satisfy a
      // test — v6.md IS the record. Re-vendor only to re-run V6 against a NEW
      // version, which is a deliberate decision, not a regression guard.
      //
      // LOAD ORDER IS LOAD-BEARING — the bridge MUST be the LAST -e extension.
      // Pi runs tool_call handlers in extension load order (runner.js
      // emitToolCall) and `event.input` is mutable: "Later tool_call handlers
      // see earlier mutations. No re-validation is performed after mutation."
      // (pi-coding-agent dist/core/extensions/types.d.ts:678). If the gate ran
      // before a handler that rewrites input, the user would approve the args
      // we displayed while different args executed. Last = the gate prompts on
      // final input. Pinned by tests/mcp-spawn.test.ts.
      //
      // Two consequences of being last, both accepted:
      //  - An earlier handler returning {block:true} short-circuits, so its
      //    refusal gets no hv.audit envelope. An unaudited refusal is strictly
      //    safer than an unaudited execution.
      //  - getAllRegisteredTools is first-registration-per-name-wins
      //    (runner.js), so a tool-name collision would now resolve to the other
      //    extension. None exists today: the bridge registers ask_user,
      //    use_skill and plan_*; the others subagent, wait, intercom,
      //    subagent_supervisor and mcp.
      "-e", path.join(runtimeDir, "extensions/happyvibe-bridge.ts"),
      // §14 Skills: disable Pi's own discovery (so no unapproved skill ever
      // loads) and add back exactly the approved+active ones. --skill is
      // additive even with --no-skills (verified against pinned Pi 0.80.10).
      "--no-skills",
      ...(opts.skills ?? []).flatMap((s) => ["--skill", s]),
      // The other two auto-discovery tiers, gated for the same reason. The agent's
      // `bash` tool is NOT path-confined (every fs writer is; bash isn't), so one
      // approved bash command can write <agentDir>/extensions/x.ts — a bare .ts is
      // enough, no manifest — and that file then loads with FULL extension
      // privileges on every future session, registering tool_call handlers on the
      // same surface the permission gate uses. The user approved "run a bash
      // command", not "install a permanent extension". Same for prompts/*.md,
      // which become slash commands. Themes are inert JSON in RPC (we render our
      // own UI) — gated anyway so <agentDir> is uniformly deny-by-default.
      //
      // All three are additive, like --no-skills: explicit -e / --prompt-template
      // / --theme still load (resource-loader.js:267/294/311). HappyVibe's three
      // extensions all arrive via -e, so the bridge, MCP and subagents are
      // untouched — and /hv-* commands are registerCommand (source "extension"),
      // not prompt templates. Pinned by tests/resource-gate-contract.test.ts: if a
      // pin bump made --no-extensions absolute, the app would silently lose its
      // whole permission layer at spawn.
      "--no-extensions",
      "--no-prompt-templates",
      // §24 Commands: add back exactly the approved+active ones, by FILE.
      ...(opts.promptTemplates ?? []).flatMap((f) => ["--prompt-template", f]),
      "--no-themes",
      // §16 round 21: identity first, the user's own additions LAST — Pi joins
      // the sources with "\n\n" in argv order, so last wins on a conflict.
      // A1 (2026-09-10): built here rather than imported as a constant — the
      // paragraph explains `intent`, so it must follow that switch.
      "--append-system-prompt", buildIdentity({ intent: opts.builtinTools?.intent ?? true }),
      ...(opts.appendFile && existsSync(opts.appendFile) ? ["--append-system-prompt", opts.appendFile] : []),
      "--session-dir", sessionDir,
      ...(model ? ["--provider", model.provider, "--model", model.modelId] : []),
      ...(opts.thinking ? ["--thinking", opts.thinking] : []),
    ],
    env: {
      // Env is passed through wholesale and inherited by pi-subagents child
      // spawns. The child runs bin/pi-node.sh: packaged → bundled Electron
      // helper as node (ELECTRON_RUN_AS_NODE); dev → `node` off PATH.
      // See docs/validation/s0.3.md "Subagent spawn cost".
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      // Same reason as the PTY's (terminalSettings.resolveSpawn): a dev server
      // the agent starts with `bash` must not throw the page at the system
      // browser. Inherited by pi-subagents children, so a delegated `npm run
      // dev` behaves too. The agent has browser_open for the pane it wants.
      BROWSER: "none",
      ...(opts.providerEnv ?? {}),
      ...(opts.agentDir ? { PI_CODING_AGENT_DIR: opts.agentDir } : {}),
      ...(opts.rulesFile ? { HV_RULES_FILE: opts.rulesFile } : {}),
      ...(opts.bypass ? { HV_BYPASS: "1" } : {}),
      ...(opts.childAuditDir ? { HV_CHILD_AUDIT_DIR: opts.childAuditDir } : {}),
      // pi-subagents tells every child to write its output to
      // `<sessionDir>/subagent-artifacts/outputs/<runId>/context.md` and calls
      // that path "authoritative for this run. Ignore any other output path".
      // It is outside the workspace, so hv-child-guard's confinement refused it
      // and the child burned a turn recovering (measured in the running app).
      // Handed over explicitly rather than derived inside the guard: main owns
      // this location, already sweeps it on session delete, and a guard that
      // guessed it would be guessing about a permission boundary. Absent ⇒ no
      // exemption, which is the confined behaviour, so it fails SAFE.
      HV_ARTIFACTS_DIR: path.join(sessionDir, "subagent-artifacts"),
      ...(opts.builtinTools
        ? { HV_BUILTINS: JSON.stringify({
            plan: opts.builtinTools.plan,
            askUser: opts.builtinTools.askUser,
            planAppend: opts.builtinTools.planAppend,
            terminal: opts.builtinTools.terminal,
            intent: opts.builtinTools.intent,
            browser: opts.builtinTools.browser,
            web: opts.builtinTools.web,
            document: opts.builtinTools.document,
            memory: opts.builtinTools.memory,
            memoryAppend: opts.builtinTools.memoryAppend,
          }) }
        : {}),
      ...(opts.skillsFile ? { HV_SKILLS_FILE: opts.skillsFile } : {}),
      // §33: the two memory scopes. Explicit keys, like every other one here — a scope main
      // does not name is a scope the bridge cannot read, which is exactly the off behaviour.
      ...(opts.memoryGlobalDir ? { HV_MEMORY_GLOBAL_DIR: opts.memoryGlobalDir } : {}),
      ...(opts.memoryWorkspaceDir ? { HV_MEMORY_WORKSPACE_DIR: opts.memoryWorkspaceDir } : {}),
      ...(opts.longCache ? { PI_CACHE_RETENTION: "long" } : {}),
      // 0.51 / #1225: a respawned session must still own its detached runs.
      ...(opts.sessionId ? { HV_SUBAGENT_OWNER: `hv-${opts.sessionId}` } : {}),
      // B6: pi-subagents defaults to `pi` on PATH for child spawns and fails
      // ENOENT in the packaged app; point it at the embedded bin (s0.3 HARD REQ).
      PI_SUBAGENT_PI_BINARY: path.join(runtimeDir, PI_SUBAGENT_BIN_RELPATH),
      // §19 (2026-08-29): pi-subagents 0.57 caches "this model failed" verdicts and
      // silently skips the model afterwards. Main surfaces them as audit rows, so it
      // needs to READ that store — and its default location is an internal
      // `os.tmpdir()/pi-subagents-<scopeId>` derivation. Re-deriving an upstream
      // storage path is what the MCP keychain drift punished, so we hand upstream a
      // path we chose instead (its own documented env hook).
      ...(opts.modelExclusionsFile ? { PI_MODEL_EXCLUSIONS_PATH: opts.modelExclusionsFile } : {}),
    } as Record<string, string>,
    cwd: workspace,
  };
}
