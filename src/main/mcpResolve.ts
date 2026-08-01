/**
 * Resolve `${VAR}` / `$env:VAR` placeholders in an MCP server config so MAIN can
 * probe a catalog server that stores its key encrypted (§13 round 8).
 *
 * The Pi runtime never needs this — pi-mcp-adapter interpolates at spawn from
 * the env providerEnv() injects. But main's own probe runs in the Electron
 * process, which has no HV_MCP_* vars, so it would send the literal placeholder
 * and read back a 401.
 *
 * Deliberately mirrors the adapter's contract rather than inventing one:
 * `${VAR}` and `$env:VAR`, applied to `env` and `headers` values ONLY, and an
 * unknown variable resolves to the empty string. Pinned on the adapter side by
 * tests/mcp-adapter-interpolation.test.ts — if that contract moves, this moves
 * with it or the probe silently disagrees with the runtime.
 *
 * Electron-free and non-mutating.
 */
import type { McpServerConfig } from "./mcp";

function interpolate(value: string, env: Record<string, string>): string {
  return value
    .replace(/\$\{(\w+)\}/g, (_, n: string) => env[n] ?? "")
    .replace(/\$env:(\w+)/g, (_, n: string) => env[n] ?? "");
}

function interpolateRecord(
  rec: Record<string, string> | undefined,
  env: Record<string, string>,
): Record<string, string> | undefined {
  if (!rec) return rec;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = interpolate(v, env);
  return out;
}

export function resolveMcpConfig(
  cfg: McpServerConfig,
  env: Record<string, string>,
): McpServerConfig {
  const next: McpServerConfig = { ...cfg };
  // url/command/args are deliberately left alone — the adapter does not
  // interpolate them, so resolving here would let a config work in the probe
  // and fail at runtime.
  if (cfg.env) next.env = interpolateRecord(cfg.env, env);
  if (cfg.headers) next.headers = interpolateRecord(cfg.headers, env);
  return next;
}
