import path from "node:path";

export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";

/**
 * Builds the spawn spec for the Pi CLI process.
 * @param runtimeDir - absolute path to the pi-runtime directory (resolved by
 *   the caller, e.g. from runtimeDir.ts in the main process, or hardcoded in
 *   tests). Keeping this param explicit ensures spawn.ts has NO electron import
 *   and remains importable by Vitest.
 */
export function resolvePiSpawn(workspace: string, sessionDir: string, apiKey: string, runtimeDir: string) {
  return {
    execPath: process.execPath,
    args: [
      path.join(runtimeDir, PI_CLI_RELPATH),
      "--mode", "rpc",
      "-e", path.join(runtimeDir, "extensions/happyvibe-bridge.ts"),
      "-e", path.join(runtimeDir, "node_modules/@gotgenes/pi-permission-system/src/index.ts"),
      "--session-dir", sessionDir,
      "--provider", "deepseek",
      "--model", "deepseek-v4-flash",
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: apiKey } as Record<string, string>,
    cwd: workspace,
  };
}
