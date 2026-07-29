import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { BYOK_PROVIDERS, buildProviderEnv, keySource, type ByokProvider, type KeySource } from "./providers";
import { resolveBypass as resolveBypassPure } from "./bypass";

const file = () => path.join(app.getPath("userData"), "config.json");

interface ConfigFile {
  /** legacy single-key format (pre-B3) — migrated to keys.deepseek on read */
  apiKey?: string;
  /** per-provider safeStorage-encrypted keys, base64 */
  keys?: Partial<Record<ByokProvider, string>>;
  defaultModel?: { provider: string; modelId: string };
  /** B7: user has seen (or dismissed) the onboarding wow-flow. */
  onboardingSeen?: boolean;
  /** Round 3 #14: persistent "bypass all permissions" — global default + per-
      workspace override (tri-state: absent = inherit global). */
  bypassAll?: boolean;
  workspaceBypass?: Record<string, boolean>;
  /** §14 Skills: external skill dirs linked in place (e.g. ~/.claude/skills).
      Scanned for skills that still go through review-before-active. */
  linkedSkillDirs?: string[];
  /** §13 round 6: global on/off for built-in custom tools (plan mode, ask_user).
      Global only — no per-workspace tier. Absent key = on (fail-open default). */
  builtinTools?: { plan?: boolean; askUser?: boolean };
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

// Round 3 #14: persistent "bypass all permissions".
export function getGlobalBypass(): boolean {
  return load().bypassAll ?? false;
}

export function setGlobalBypass(on: boolean): void {
  const cfg = load();
  if (on) cfg.bypassAll = true;
  else delete cfg.bypassAll;
  save(cfg);
}

/** Per-workspace override, tri-state: null = unset (inherit global). */
export function getWorkspaceBypass(workspace: string): boolean | null {
  return load().workspaceBypass?.[workspace] ?? null;
}

export function setWorkspaceBypass(workspace: string, on: boolean | null): void {
  const cfg = load();
  cfg.workspaceBypass ??= {};
  if (on === null) delete cfg.workspaceBypass[workspace];
  else cfg.workspaceBypass[workspace] = on;
  if (Object.keys(cfg.workspaceBypass).length === 0) delete cfg.workspaceBypass;
  save(cfg);
}

/** Resolved bypass for a session: workspace override ?? global ?? off. */
export function resolveBypass(workspace: string | null | undefined): boolean {
  const cfg = load();
  return resolveBypassPure(cfg.bypassAll ?? false, workspace ? cfg.workspaceBypass?.[workspace] : undefined);
}

// §13 round 6: global on/off for built-in custom tools. Both default true
// (fail-open — same convention as HV_BYPASS's persistent setting).
export function getBuiltinTools(): { plan: boolean; askUser: boolean } {
  const t = load().builtinTools;
  return { plan: t?.plan ?? true, askUser: t?.askUser ?? true };
}

export function setBuiltinTools(t: { plan?: boolean; askUser?: boolean }): void {
  const cfg = load();
  cfg.builtinTools = { ...cfg.builtinTools, ...t };
  save(cfg);
}

// §14 Skills: linked external skill dirs (referenced in place, not copied).
export function getLinkedSkillDirs(): string[] {
  return load().linkedSkillDirs ?? [];
}

export function setLinkedSkillDirs(dirs: string[]): void {
  const cfg = load();
  const clean = [...new Set(dirs.filter((d) => typeof d === "string" && d.trim()))];
  if (clean.length) cfg.linkedSkillDirs = clean;
  else delete cfg.linkedSkillDirs;
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
  // v5: a builtin we USED to ship (e.g. summarizer — compaction is Pi-native)
  // is gone from the bundle. Remove the copy we installed IF the user hasn't
  // edited it; an edited copy is now theirs (a custom agent) — leave it, just
  // stop tracking it as a builtin.
  const bundled = new Set(files);
  for (const name of Object.keys(stamps)) {
    if (bundled.has(name)) continue;
    const target = path.join(dest, name);
    const stamp = stamps[name];
    if (fs.existsSync(target) && Math.abs(fs.statSync(target).mtimeMs - stamp.installedMtime) <= 1) {
      fs.rmSync(target, { force: true });
    }
    delete stamps[name];
    changed = true;
  }
  if (changed) fs.writeFileSync(stampFile, JSON.stringify(stamps));
}

/**
 * Enable async-by-default subagent delegations (PRD §12, 2026-07-17). pi-subagents
 * reads `<PI_CODING_AGENT_DIR>/extensions/subagent/config.json` at spawn; with
 * `asyncByDefault` a delegation returns immediately (detached runner) so the
 * user keeps chatting. `completionBatch.enabled:false` → one completion notify
 * per run, which the renderer maps 1:1 to a run card. The dir is app-owned, so
 * we merge-write (preserve any keys a future version adds). Idempotent.
 */
export function writeSubagentConfig(): void {
  const file = path.join(agentDir(), "extensions", "subagent", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* absent or corrupt — start fresh */
  }
  config.asyncByDefault = true;
  config.completionBatch = { ...(config.completionBatch as object | undefined), enabled: false };
  // pi-subagents' agent-to-agent "intercom" result relay defaults to "always",
  // but HappyVibe delivers results via the independent async-complete →
  // subagent-notify path and never acks intercom — leaving it on just logs
  // "intercom delivery was not acknowledged" on every run. Off = quiet, no loss.
  config.intercomBridge = { ...(config.intercomBridge as object | undefined), mode: "off" };
  fs.writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`);
}
