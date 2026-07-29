import path from "node:path";
import { existsSync } from "node:fs";

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

export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
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
  /** §13 round 6: global on/off for built-in custom tools (plan mode, ask_user),
      resolved at spawn → HV_BUILTINS (same pattern as HV_BYPASS). */
  builtinTools?: { plan: boolean; askUser: boolean };
  /** §14 Skills: absolute skill-dir paths this session is allowed to load
      (approved ∩ enabled ∩ active-for-workspace). Enforced with `--no-skills`
      (kills Pi's own discovery — Pi never sees an unapproved skill) plus one
      `--skill <dir>` per entry (additive even with --no-skills). Always
      `--no-skills`, even when empty, so discovery is off by default. */
  skills?: string[];
  /** §14: per-session skills manifest JSON → HV_SKILLS_FILE (the bridge serves
      use_skill and detects raw SKILL.md reads from it). */
  skillsFile?: string;
}

/**
 * Builds the spawn spec for the Pi CLI process.
 * @param runtimeDir - absolute path to the pi-runtime directory (resolved by
 *   the caller, e.g. from runtimeDir.ts in the main process, or hardcoded in
 *   tests). Keeping this param explicit ensures spawn.ts has NO electron import
 *   and remains importable by Vitest.
 */
export function resolvePiSpawn(workspace: string, sessionDir: string, runtimeDir: string, opts: PiSpawnOptions = {}) {
  const model = opts.model ?? { provider: "deepseek", modelId: "deepseek-v4-flash" };
  return {
    execPath: nodeExecPath(),
    args: [
      path.join(runtimeDir, PI_CLI_RELPATH),
      "--mode", "rpc",
      // Resume = Pi's own `--session <path>`: main.js resolves a path arg via
      // resolveSessionPath → openSessionOrExit, reopening the JSONL in place.
      ...(opts.resumeFile ? ["--session", opts.resumeFile] : []),
      // The HappyVibe bridge is the SOLE permission path in RPC mode.
      // @gotgenes/pi-permission-system was removed from the spawn after Gate V6
      // proved it is TUI-only (both its prompt paths gate on ctx.hasUI, which is
      // false in --mode rpc; its non-UI fallback silently denies). It stays
      // vendored in pi-runtime only for tests/permission-coexistence.test.ts,
      // which documents that finding. See docs/validation/v6.md.
      "-e", path.join(runtimeDir, "extensions/happyvibe-bridge.ts"),
      // B6: pi-subagents (RPC-validated, s0.3). Loaded as a second -e extension
      // per its package.json `pi.extensions` entry; the subagent tool it
      // registers is a normal tool_call, so the bridge's permission gate applies.
      "-e", path.join(runtimeDir, PI_SUBAGENTS_RELPATH),
      // MCP: pi-mcp-adapter registers the `mcp` proxy tool via registerTool,
      // so the bridge's permission gate applies (docs/validation/m1.md).
      // Config: PI_CODING_AGENT_DIR/mcp.json (global) + <cwd>/.mcp.json (workspace).
      "-e", path.join(runtimeDir, PI_MCP_ADAPTER_RELPATH),
      // §14 Skills: disable Pi's own discovery (so no unapproved skill ever
      // loads) and add back exactly the approved+active ones. --skill is
      // additive even with --no-skills (verified against pinned Pi 0.80.10).
      "--no-skills",
      ...(opts.skills ?? []).flatMap((s) => ["--skill", s]),
      "--session-dir", sessionDir,
      "--provider", model.provider,
      "--model", model.modelId,
    ],
    env: {
      // Env is passed through wholesale and inherited by pi-subagents child
      // spawns. The child runs bin/pi-node.sh: packaged → bundled Electron
      // helper as node (ELECTRON_RUN_AS_NODE); dev → `node` off PATH.
      // See docs/validation/s0.3.md "Subagent spawn cost".
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...(opts.providerEnv ?? {}),
      ...(opts.agentDir ? { PI_CODING_AGENT_DIR: opts.agentDir } : {}),
      ...(opts.rulesFile ? { HV_RULES_FILE: opts.rulesFile } : {}),
      ...(opts.bypass ? { HV_BYPASS: "1" } : {}),
      ...(opts.builtinTools
        ? { HV_BUILTINS: JSON.stringify({ plan: opts.builtinTools.plan, askUser: opts.builtinTools.askUser, planAppend: "" }) }
        : {}),
      ...(opts.skillsFile ? { HV_SKILLS_FILE: opts.skillsFile } : {}),
      // B6: pi-subagents defaults to `pi` on PATH for child spawns and fails
      // ENOENT in the packaged app; point it at the embedded bin (s0.3 HARD REQ).
      PI_SUBAGENT_PI_BINARY: path.join(runtimeDir, PI_SUBAGENT_BIN_RELPATH),
    } as Record<string, string>,
    cwd: workspace,
  };
}
