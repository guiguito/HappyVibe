import path from "node:path";

export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";

// Dev: <repo>/pi-runtime. Packaged: <resources>/pi-runtime (wired in Task 14).
export function piRuntimeDir(): string {
  const packaged = process.env.NODE_ENV === "production" && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return packaged ? path.join(packaged as string, "pi-runtime") : path.join(process.cwd(), "pi-runtime");
}

export function resolvePiSpawn(workspace: string, sessionDir: string, apiKey: string) {
  const runtime = piRuntimeDir();
  return {
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--session-dir", sessionDir,
      "--provider", "deepseek",
      "--model", "deepseek-v4-flash",
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: apiKey } as Record<string, string>,
    cwd: workspace,
  };
}
