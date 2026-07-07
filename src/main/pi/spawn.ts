import path from "node:path";

export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";
/** pi-subagents extension entry (its package.json `pi.extensions`) — B6. */
export const PI_SUBAGENTS_RELPATH = "node_modules/pi-subagents/src/extension/index.ts";
/** Embedded pi CLI the pi-subagents child spawn must use (no global `pi`; s0.3). */
export const PI_SUBAGENT_BIN_RELPATH = "node_modules/.bin/pi";

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
    execPath: process.execPath,
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
      "--session-dir", sessionDir,
      "--provider", model.provider,
      "--model", model.modelId,
    ],
    env: {
      // Env is passed through wholesale (incl. ELECTRON_RUN_AS_NODE) and inherited
      // by pi-subagents child spawns. Trimming it is NOT a subagent-speed lever:
      // the child spawns `.bin/pi` (a `#!/usr/bin/env node` shebang) directly, so
      // it runs as plain `node` off PATH, not Electron — ELECTRON_RUN_AS_NODE has
      // no effect on it. See docs/validation/s0.3.md "Subagent spawn cost".
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...(opts.providerEnv ?? {}),
      ...(opts.agentDir ? { PI_CODING_AGENT_DIR: opts.agentDir } : {}),
      ...(opts.rulesFile ? { HV_RULES_FILE: opts.rulesFile } : {}),
      // B6: pi-subagents defaults to `pi` on PATH for child spawns and fails
      // ENOENT in the packaged app; point it at the embedded bin (s0.3 HARD REQ).
      PI_SUBAGENT_PI_BINARY: path.join(runtimeDir, PI_SUBAGENT_BIN_RELPATH),
    } as Record<string, string>,
    cwd: workspace,
  };
}
