import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BYOK_PROVIDERS, buildProviderEnv, keySource, type ByokProvider, type KeySource } from "./providers";
import { customEndpointEnv, type CustomEndpoint } from "./modelsJson";
import { mcpSecretEnvVar } from "./mcpSecretName";
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
  /** §16 (2026-07-30): user-defined OpenAI-compatible endpoints. */
  customEndpoints?: CustomEndpoint[];
  /** safeStorage-encrypted keys for those endpoints, base64, by endpoint id. */
  customKeys?: Record<string, string>;
  /** §13 round 6: global on/off for built-in custom tools (plan mode, ask_user).
      Global only — no per-workspace tier. Absent key = on (fail-open default). */
  builtinTools?: { plan?: boolean; askUser?: boolean; planAppend?: string };
  /** Extended prompt-cache retention (PI_CACHE_RETENTION=long). Global only,
      absent = off — the default is cheaper for short-gap sessions, see
      getLongCache. */
  longCache?: boolean;
  /** §13 round 8: safeStorage-encrypted secrets for catalog-installed MCP
      servers, base64, keyed "<serverKey>:<inputId>". mcp.json holds only a
      ${HV_MCP_…} placeholder — the workspace tier writes .mcp.json at the repo
      root, so a plaintext key there would land in git history. */
  mcpSecrets?: Record<string, string>;
  /** Round 8: user-remapped keyboard shortcuts, action id → canonical binding
      ("Mod-Shift-e"). An absent id means that action keeps its default. */
  shortcuts?: Record<string, string>;
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

export function listCustomEndpoints(): CustomEndpoint[] {
  return load().customEndpoints ?? [];
}

function storedCustomKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = load().customKeys ?? {};
  for (const id of Object.keys(keys)) {
    const k = decrypt(keys[id]);
    if (k) out[id] = k;
  }
  return out;
}

/** Upsert by id. `key` omitted leaves any existing key untouched. */
export function saveCustomEndpoint(e: CustomEndpoint, key?: string): void {
  const cfg = load();
  const rest = (cfg.customEndpoints ?? []).filter((x) => x.id !== e.id);
  cfg.customEndpoints = [...rest, e];
  if (key) cfg.customKeys = { ...cfg.customKeys, [e.id]: safeStorage.encryptString(key).toString("base64") };
  save(cfg);
}

export function removeCustomEndpoint(id: string): void {
  const cfg = load();
  cfg.customEndpoints = (cfg.customEndpoints ?? []).filter((x) => x.id !== id);
  if (cfg.customKeys) delete cfg.customKeys[id];
  save(cfg);
}

/** True once a key is stored — the UI shows "key saved" without reading it. */
export function customKeyStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of Object.keys(storedCustomKeys())) out[id] = true;
  return out;
}

// §13 round 8: secrets for catalog-installed MCP servers. mcp.json references
// them as ${HV_MCP_…}; the real values ride the spawn env, same as BYOK keys.
export function setMcpSecret(serverKey: string, inputId: string, value: string): void {
  const cfg = load();
  cfg.mcpSecrets = {
    ...cfg.mcpSecrets,
    [`${serverKey}:${inputId}`]: safeStorage.encryptString(value).toString("base64"),
  };
  save(cfg);
}

/** Drop every secret belonging to a server (called when it is removed). */
export function removeMcpSecrets(serverKey: string): void {
  const cfg = load();
  if (!cfg.mcpSecrets) return;
  for (const k of Object.keys(cfg.mcpSecrets)) {
    if (k.startsWith(`${serverKey}:`)) delete cfg.mcpSecrets[k];
  }
  save(cfg);
}

function mcpSecretEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [composite, enc] of Object.entries(load().mcpSecrets ?? {})) {
    const [serverKey, inputId] = composite.split(":");
    const value = decrypt(enc);
    if (value) out[mcpSecretEnvVar(serverKey, inputId)] = value;
  }
  return out;
}

/** True per "<serverKey>:<inputId>" once stored — the UI shows "key saved". */
export function mcpSecretStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(load().mcpSecrets ?? {})) out[k] = true;
  return out;
}

/** Env vars injected on Pi spawn: curated BYOK keys + custom endpoint keys + MCP secrets. */
export function providerEnv(): Record<string, string> {
  return {
    ...buildProviderEnv(storedKeys()),
    ...customEndpointEnv(listCustomEndpoints(), storedCustomKeys()),
    ...mcpSecretEnv(),
  };
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
export function getBuiltinTools(): { plan: boolean; askUser: boolean; planAppend: string } {
  const t = load().builtinTools;
  const plan = t?.plan ?? true;
  // Plan mode's prompt and its applyPlanTools required-list both depend on
  // ask_user, so the bridge force-couples them (hv-builtins parseBuiltins). Apply
  // the SAME clamp here or the settings row would read "off" for a tool that is
  // in fact registered — the UI must not disagree with the runtime.
  return { plan, askUser: plan ? true : (t?.askUser ?? true), planAppend: t?.planAppend ?? "" };
}

export function setBuiltinTools(t: { plan?: boolean; askUser?: boolean; planAppend?: string }): void {
  const cfg = load();
  cfg.builtinTools = { ...cfg.builtinTools, ...t };
  save(cfg);
}

/**
 * Extended prompt-cache retention. OFF by default because it is not a free win
 * on Anthropic: a 1h cache write is billed at 2× the input rate instead of
 * 1.25×, so it only pays off when the gap between turns regularly exceeds the
 * 5min default TTL. On OpenAI the same flag sets `prompt_cache_retention:"24h"`,
 * which carries no write premium. Applied at spawn (PI_CACHE_RETENTION), so it
 * reaches live sessions only when they next respawn.
 */
export function getLongCache(): boolean {
  return load().longCache ?? false;
}

export function setLongCache(on: boolean): void {
  const cfg = load();
  if (on) cfg.longCache = true;
  else delete cfg.longCache;
  save(cfg);
}

/** Round 8: shortcut overrides. Stored whole — the renderer owns the merge with
    the defaults (shortcuts.ts resolveBindings), so main never has to know the
    action list, and a renamed action can't strand a binding here. */
export function getShortcuts(): Record<string, string> {
  return load().shortcuts ?? {};
}

export function setShortcuts(map: Record<string, string>): void {
  const cfg = load();
  cfg.shortcuts = map;
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

/** §9 rewind file rollback — content-addressed snapshot store, one dir per session. */
export function snapshotDir(): string {
  const d = path.join(app.getPath("userData"), "snapshots");
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
 *  - target absent                     → install
 *  - target already == bundle           → skip
 *  - target == what WE installed        → reinstall (ships the bundle fix)
 *  - target != what we installed        → the user's; keep theirs
 *
 * Identity is a CONTENT HASH, not mtime. mtime failed in both directions and did
 * so silently: anything that restamped a file without changing it (a second
 * install pass racing the post-copy stat, a copy, a sync tool) read as an edit and
 * froze that agent forever — observed in the wild, an installed agent stuck
 * several bundle versions behind while byte-identical to a shipped copy — and
 * conversely a real edit landing within the 1ms tolerance (or on a
 * coarse-timestamp filesystem) read as unedited and got CLOBBERED. A hash answers
 * "did the user change this?" exactly. It is also stable across clones and
 * packaging, which an mtime "version" never was.
 *
 * Legacy `{version, installedMtime}` stamps can't prove authorship, so they are
 * repaired towards the bundle with a one-time `.bak` beside the file — fixing the
 * frozen-agent case without ever destroying content.
 */
/** sha256 of a file's bytes; null when it can't be read (absent, unreadable). */
function fileHash(p: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
}

export function installBuiltinAgents(bundleDir: string): void {
  const dest = builtinAgentsDir();
  const stampFile = path.join(agentDir(), "installed-agents.json");
  /** `installedHash` is the current scheme; `installedMtime` is a legacy stamp. */
  type Stamp = { version?: string | number; installedHash?: string; installedMtime?: number };
  let stamps: Record<string, Stamp> = {};
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
    const version = fileHash(src);
    if (!version) continue; // unreadable bundle entry — leave the install alone
    const target = path.join(dest, name);
    const stamp = stamps[name];
    const targetHash = fileHash(target);

    const install = (): void => {
      fs.copyFileSync(src, target);
      // Post-copy the target IS the bundle, so its hash is `version` by construction
      // — no second stat to race with a concurrent writer.
      stamps[name] = { version, installedHash: version };
      changed = true;
    };

    if (targetHash === null) { install(); continue; } // absent (or unreadable)
    if (targetHash === version) {
      // Already the bundle's content; make sure the stamp says so.
      if (stamp?.installedHash !== version) { stamps[name] = { version, installedHash: version }; changed = true; }
      continue;
    }
    if (stamp?.installedHash) {
      if (targetHash !== stamp.installedHash) continue; // diverged from OUR copy → theirs, keep it
    } else {
      // No stamp, or a legacy mtime stamp: authorship is unknowable. Prefer the
      // bundle (a frozen agent is the bug) but never lose what was there.
      try {
        fs.copyFileSync(target, `${target}.bak`);
      } catch {
        continue; // can't secure a backup → do not overwrite
      }
    }
    install();
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
    // Only remove a copy we can PROVE is ours and untouched. A legacy stamp can't
    // prove it, so leave the file (it becomes theirs) and just stop tracking it —
    // the conservative direction, since the alternative is deleting user content.
    const targetHash = fileHash(target);
    if (targetHash !== null && stamp.installedHash && targetHash === stamp.installedHash) {
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
