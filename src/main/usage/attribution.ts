/**
 * §39 D16 — is this an upgrade rather than a new install? Decided ONCE, at
 * analytics' init, because Inlet keeps an installation's FIRST attribution:
 * a later setAttribution would miss `app_installed`.
 *
 * The marker is analytics' own `analytics-state.json` (the SDK's FileStore
 * writes `<key>.json` under `<userData>/inlet`), NOT `installation-id.json`:
 * from inlet-sdk 0.4.0 the config module writes that one, possibly first.
 * Electron-free and fs-only, so vitest can drive it with temp dirs.
 */
import fs from "node:fs";
import path from "node:path";

const readJson = (f: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const nonEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0;

export function hasPriorUse(userData: string, agentDir: string): boolean {
  const ws = readJson(path.join(userData, "workspaces.json"));
  const cfg = readJson(path.join(userData, "config.json")) as { keys?: unknown; customEndpoints?: unknown; apiKey?: unknown } | null;
  const auth = readJson(path.join(agentDir, "auth.json"));
  return nonEmpty(ws) || nonEmpty(cfg?.keys) || nonEmpty(cfg?.customEndpoints) || !!cfg?.apiKey || nonEmpty(auth);
}

export function existingUserAttribution(inletDir: string, priorUse: boolean): "existing_user" | undefined {
  if (!priorUse) return undefined;
  return fs.existsSync(path.join(inletDir, "analytics-state.json")) ? undefined : "existing_user";
}
