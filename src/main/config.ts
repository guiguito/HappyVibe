import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { BYOK_PROVIDERS, buildProviderEnv, keySource, type ByokProvider, type KeySource } from "./providers";

const file = () => path.join(app.getPath("userData"), "config.json");

interface ConfigFile {
  /** legacy single-key format (pre-B3) — migrated to keys.deepseek on read */
  apiKey?: string;
  /** per-provider safeStorage-encrypted keys, base64 */
  keys?: Partial<Record<ByokProvider, string>>;
  defaultModel?: { provider: string; modelId: string };
  /** B7: user has seen (or dismissed) the onboarding wow-flow. */
  onboardingSeen?: boolean;
}

function load(): ConfigFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as ConfigFile;
    if (raw.apiKey && !raw.keys?.deepseek) {
      raw.keys = { ...raw.keys, deepseek: raw.apiKey };
      delete raw.apiKey;
    }
    return raw;
  } catch {
    return {};
  }
}

function save(cfg: ConfigFile): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg));
}

function decrypt(b64: string | undefined): string | null {
  if (!b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}

function storedKeys(): Partial<Record<ByokProvider, string>> {
  const out: Partial<Record<ByokProvider, string>> = {};
  const keys = load().keys ?? {};
  for (const id of Object.keys(BYOK_PROVIDERS) as ByokProvider[]) {
    const k = decrypt(keys[id]);
    if (k) out[id] = k;
  }
  return out;
}

export function setProviderKey(provider: ByokProvider, key: string): void {
  const cfg = load();
  cfg.keys = { ...cfg.keys, [provider]: safeStorage.encryptString(key).toString("base64") };
  save(cfg);
}

export function removeProviderKey(provider: ByokProvider): void {
  const cfg = load();
  if (cfg.keys) delete cfg.keys[provider];
  save(cfg);
}

/** "env" (.env dev convenience) | "stored" (safeStorage) | null, per provider. */
export function providerKeyStatus(): Record<ByokProvider, KeySource> {
  const stored = storedKeys();
  const out = {} as Record<ByokProvider, KeySource>;
  for (const id of Object.keys(BYOK_PROVIDERS) as ByokProvider[]) out[id] = keySource(id, stored);
  return out;
}

/** Env vars injected on Pi spawn for every configured BYOK provider. */
export function providerEnv(): Record<string, string> {
  return buildProviderEnv(storedKeys());
}

export function getDefaultModel(): { provider: string; modelId: string } | null {
  return load().defaultModel ?? null;
}

export function setDefaultModel(m: { provider: string; modelId: string } | null): void {
  const cfg = load();
  if (m) cfg.defaultModel = m;
  else delete cfg.defaultModel;
  save(cfg);
}

// B7: onboarding wow-flow seen flag.
export function getOnboardingSeen(): boolean {
  return load().onboardingSeen ?? false;
}

export function setOnboardingSeen(seen: boolean): void {
  const cfg = load();
  cfg.onboardingSeen = seen;
  save(cfg);
}

// Legacy shims — existing window.hv.getApiKey/setApiKey surface (DeepSeek).
export function getApiKey(): string | null {
  return providerEnv().DEEPSEEK_API_KEY ?? null;
}

export function setApiKey(key: string): void {
  setProviderKey("deepseek", key);
}

export function sessionDir(): string {
  const d = path.join(app.getPath("userData"), "sessions");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * App-owned Pi agent dir (PI_CODING_AGENT_DIR on spawn). HappyVibe is a
 * curated distribution: its auth.json / models.json live here, never in the
 * user's real ~/.pi. Pi owns the files (plaintext auth.json — documented).
 */
export function agentDir(): string {
  const d = path.join(app.getPath("userData"), "pi-agent");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Permission rules file (B4) — handed to the bridge as HV_RULES_FILE on spawn. */
export function rulesFile(): string {
  return path.join(app.getPath("userData"), "permission-rules.json");
}

/**
 * Built-in agent dir (B6). pi-subagents discovers agents from
 * `<PI_CODING_AGENT_DIR>/agents/*.md` — since agentDir() is PI_CODING_AGENT_DIR,
 * our built-ins live in agentDir()/agents. Also where duplicates/edits land.
 */
export function builtinAgentsDir(): string {
  const d = path.join(agentDir(), "agents");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Install the bundled built-in agents (pi-runtime/agents/*.md) into the
 * app-owned agent dir at startup. Idempotent and NON-clobbering:
 *  - target absent            → install
 *  - bundle version unchanged → skip (already installed)
 *  - bundle bumped + user has NOT edited (target mtime == our recorded install
 *    mtime) → reinstall; if the user edited it, keep their version.
 * Per-file bundle version + our install mtime are tracked in
 * installed-agents.json so a bundle bump ships fixes without clobbering edits.
 */
export function installBuiltinAgents(bundleDir: string): void {
  const dest = builtinAgentsDir();
  const stampFile = path.join(agentDir(), "installed-agents.json");
  let stamps: Record<string, { version: number; installedMtime: number }> = {};
  try {
    stamps = JSON.parse(fs.readFileSync(stampFile, "utf8")) as typeof stamps;
  } catch {
    /* first run */
  }
  let files: string[];
  try {
    files = fs.readdirSync(bundleDir).filter((n) => n.endsWith(".md"));
  } catch {
    return; // no bundle (shouldn't happen) — nothing to install
  }
  let changed = false;
  for (const name of files) {
    const src = path.join(bundleDir, name);
    const version = fs.statSync(src).mtimeMs;
    const target = path.join(dest, name);
    const stamp = stamps[name];
    const exists = fs.existsSync(target);
    if (exists && stamp?.version === version) continue; // up to date
    // Bundle bumped but the user edited the file → keep theirs.
    if (exists && stamp && Math.abs(fs.statSync(target).mtimeMs - stamp.installedMtime) > 1) continue;
    fs.copyFileSync(src, target);
    stamps[name] = { version, installedMtime: fs.statSync(target).mtimeMs };
    changed = true;
  }
  if (changed) fs.writeFileSync(stampFile, JSON.stringify(stamps));
}
