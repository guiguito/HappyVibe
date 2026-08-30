import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BYOK_PROVIDERS, buildProviderEnv, keySource, type ByokProvider, type KeySource } from "./providers";
import { customEndpointEnv, type CustomEndpoint } from "./modelsJson";
import { mcpSecretEnvVar } from "./mcpSecretName";
import { resolveBypass as resolveBypassPure } from "./bypass";
import { OFFICIAL_MARKETPLACE } from "./plugins/officialMarketplace";
import { mergeTerminalSettings, type TerminalSettings } from "./terminalSettings";
import { mergeVoiceSettings, type VoiceSettings } from "./voice/settings";
import { disabledAgentOverrides } from "./subagentSettings";
import { EXTERNAL_CLI_AGENTS, UNSUPPORTED_BUILTIN_AGENTS } from "../../pi-runtime/extensions/hv-rules";

const file = () => path.join(app.getPath("userData"), "config.json");

interface ConfigFile {
  /** legacy single-key format (pre-B3) — migrated to keys.deepseek on read */
  apiKey?: string;
  /** per-provider safeStorage-encrypted keys, base64 */
  keys?: Partial<Record<ByokProvider, string>>;
  defaultModel?: { provider: string; modelId: string };
  /** B7: user has seen (or dismissed) the onboarding wow-flow. */
  onboardingSeen?: boolean;
  /**
   * §30: the app version whose changelog the user has read. `undefined` means
   * never recorded — which is a fresh install AND an existing install meeting
   * this feature for the first time. Neither has been *updated*, so both must
   * show no dot; the renderer seeds it silently rather than treating absence
   * as "all of it is new".
   */
  lastSeenVersion?: string;
  /** Round 3 #14: persistent "bypass all permissions" — global default + per-
      workspace override (tri-state: absent = inherit global). */
  bypassAll?: boolean;
  /** Round 11: set only when the user turns OFF open-files context (default on). */
  openFilesContextOff?: boolean;
  workspaceBypass?: Record<string, boolean>;
  /** §14 Skills: external skill dirs linked in place (e.g. ~/.claude/skills).
      Scanned for skills that still go through review-before-active. */
  linkedSkillDirs?: string[];
  /** §24 Commands: external prompt-template dirs linked in place (e.g.
      ~/.claude/commands). Same review-before-active gate as linkedSkillDirs. */
  linkedPromptTemplateDirs?: string[];
  /** §16 (2026-07-30): user-defined OpenAI-compatible endpoints. */
  customEndpoints?: CustomEndpoint[];
  /** safeStorage-encrypted keys for those endpoints, base64, by endpoint id. */
  customKeys?: Record<string, string>;
  /** §13 round 6: global on/off for built-in custom tools (plan mode, ask_user,
      and §26's grouped Terminal entry). Global only — no per-workspace tier.
      Absent key = on (fail-open default). */
  builtinTools?: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean; intent?: boolean; browser?: boolean };
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
  /** §25: plugin marketplaces the user has listed. Absent = the one built-in
      (the official Anthropic list). The resolver supports N; V1 ships one. */
  marketplaces?: Array<{ id: string; url: string }>;
  /** §26: terminal settings. GLOBAL only — every field is appearance or
      personal habit, and the one per-workspace candidate (the shell) belongs
      in a project's own dotfiles where every other tool will read it too.
      Stored as a partial; mergeTerminalSettings supplies and range-checks the
      rest, because this file is hand-editable and a fontSize of 0 would
      otherwise reach xterm's constructor. */
  terminal?: Partial<TerminalSettings>;
  /** §27: voice input settings. GLOBAL only, same reasoning as `terminal` —
      every field is a personal habit or a property of this machine's
      microphone. Stored as a partial; mergeVoiceSettings supplies and
      range-checks the rest, and in particular refuses an unsupported
      language, because out-of-set input produces confident garbage. */
  voice?: Partial<VoiceSettings>;
  /** §26: the centre-area tab layout, per workspace. Persisted so a renderer
      reload restores chats, files, terminals and pane sizes alike — which is
      also what makes a terminal survive ⌘R, since main never stopped owning
      the PTY. Written opaquely; the renderer owns validation and pruning
      (layoutPersist.ts), exactly as it owns the shortcut merge below. */
  layout?: Record<string, unknown>;
  /** §29: the shipped git permission rules have been written into
      permission-rules.json once. They are suggestions, not policy, so this flag
      is what makes a DELETED one stay deleted — without it every launch would
      resurrect a rule the user removed on purpose. */
  gitRulesSeeded?: boolean;
  /** §29 (2b): model for "Write it for me". Absent = the same cheap-flash
      resolution the session-title generator uses. Global only — it is a cost
      preference about a one-shot call, not a property of any workspace. */
  /** §19 (2026-08-30): the three model calls the app makes without a session. */
  assistantTasks?: Partial<Record<AssistantTaskId, Partial<AssistantTask>>>;
  /**
   * §12 (2026-08-30): per-agent on/off, SPARSE — only names the user actually
   * toggled. Resolution is `userChoice ?? default` (subagentSettings.ts), so
   * changing our defaults still reaches anyone who never expressed an opinion.
   */
  agentsEnabled?: Record<string, boolean>;
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

// §30: the changelog dot's flag. Same chain as onboardingSeen above, holding a
// string instead of a boolean — "have you read THIS version's notes" is not a
// yes/no that survives the next release.
export function getLastSeenVersion(): string | null {
  return load().lastSeenVersion ?? null;
}

export function setLastSeenVersion(version: string): void {
  const cfg = load();
  cfg.lastSeenVersion = version;
  save(cfg);
}

// §29: seed-once flag for the shipped git rules — see gitRules.ts for why the
// flag rather than a marker on the rules themselves.
export function getGitRulesSeeded(): boolean {
  return load().gitRulesSeeded ?? false;
}

export function setGitRulesSeeded(seeded: boolean): void {
  const cfg = load();
  cfg.gitRulesSeeded = seeded;
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
export function getBuiltinTools(): { plan: boolean; askUser: boolean; planAppend: string; terminal: boolean; intent: boolean; browser: boolean } {
  const t = load().builtinTools;
  const plan = t?.plan ?? true;
  // Plan mode's prompt tells the model to resolve decisions with ask_user, so
  // the bridge force-couples them (hv-builtins parseBuiltins). Apply
  // the SAME clamp here or the settings row would read "off" for a tool that is
  // in fact registered — the UI must not disagree with the runtime.
  // §26's terminal group has no such coupling: the three tools depend on each
  // other and on nothing else, which is why they are one entry.
  // §13 round 12: `intent` is a cost/taste switch with no coupling — the
  // permission prompt never showed the model's sentence, so nothing safety-
  // bearing depends on it.
  // §28's browser group has no coupling either — ten tools that depend on each
  // other and on nothing else, which is why they are one entry.
  return { plan, askUser: plan ? true : (t?.askUser ?? true), planAppend: t?.planAppend ?? "", terminal: t?.terminal ?? true, intent: t?.intent ?? true, browser: t?.browser ?? true };
}

export function setBuiltinTools(t: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean; intent?: boolean; browser?: boolean }): void {
  const cfg = load();
  cfg.builtinTools = { ...cfg.builtinTools, ...t };
  save(cfg);
}

/**
 * §19 (2026-08-30) — the three model calls the app makes WITHOUT a session:
 * the session title (titles.ts), the commit message and the PR draft
 * (gitMessage.ts). Deliberately the same shape as getBuiltinTools above — one
 * global record, a merging setter, fail-OPEN defaults — because it is the same
 * idea one surface over, and a second shape would be a second thing to be wrong.
 *
 * Fail open: a task the user has never touched RUNS. A default of off would be
 * a model call configured and never delivered, with nothing explaining it.
 *
 * This replaces `gitMessageModel`, which was ONE setting the commit-message and
 * PR rows would have silently shared. It was built end to end in main and never
 * given a renderer caller, so no user has one on disk — hence no migration and
 * no legacy read. The ids are deliberately the same three strings as
 * OneShotKind (oneShotLog.ts): one vocabulary, so a settings row and an audit
 * row can never disagree about which task they mean.
 */
export type AssistantTaskId = "title" | "commit-message" | "pr-draft";

export interface AssistantTask {
  enabled: boolean;
  /** null = "Same as your default model" — resolveSpawnModel's normal tiers. */
  model: { provider: string; modelId: string } | null;
  /** Appended AFTER the built-in prompt, never replacing it (PRD §13 round 6). */
  append: string;
}

export const ASSISTANT_TASK_IDS: readonly AssistantTaskId[] = ["title", "commit-message", "pr-draft"];

export function getAssistantTasks(): Record<AssistantTaskId, AssistantTask> {
  const stored = load().assistantTasks ?? {};
  return Object.fromEntries(
    ASSISTANT_TASK_IDS.map((id) => {
      const t = stored[id];
      return [id, { enabled: t?.enabled ?? true, model: t?.model ?? null, append: t?.append ?? "" }];
    }),
  ) as Record<AssistantTaskId, AssistantTask>;
}

export function setAssistantTask(id: AssistantTaskId, patch: Partial<AssistantTask>): void {
  // The renderer is a trust boundary like any other — a typo must not grow a
  // fourth task that nothing reads and nothing shows.
  if (!ASSISTANT_TASK_IDS.includes(id)) return;
  const cfg = load();
  cfg.assistantTasks = { ...cfg.assistantTasks, [id]: { ...cfg.assistantTasks?.[id], ...patch } };
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

/**
 * Round 11: tell the agent which files the user has open (paths only).
 *
 * ON by default, and global rather than per-workspace: "which files am I looking
 * at" is a property of how the user works, not of a project, so the tri-state a
 * workspace tier implies would buy nothing. Stored inverted (only the OFF state
 * is written) so the default needs no migration.
 */
export function getOpenFilesContext(): boolean {
  return !load().openFilesContextOff;
}

export function setOpenFilesContext(on: boolean): void {
  const cfg = load();
  if (on) delete cfg.openFilesContextOff;
  else cfg.openFilesContextOff = true;
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

/** §26: terminal settings, always complete and always in range — the merge is
    what stands between a hand-edited config.json and xterm's constructor. */
export function getTerminalSettings(): TerminalSettings {
  return mergeTerminalSettings(load().terminal);
}

export function setTerminalSettings(settings: Partial<TerminalSettings>): TerminalSettings {
  const cfg = load();
  cfg.terminal = mergeTerminalSettings(settings);
  save(cfg);
  return cfg.terminal as TerminalSettings;
}

/** §27: voice settings, always complete and always in range — same contract. */
export function getVoiceSettings(): VoiceSettings {
  return mergeVoiceSettings(load().voice);
}

export function setVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  const cfg = load();
  cfg.voice = mergeVoiceSettings(settings);
  save(cfg);
  return cfg.voice as VoiceSettings;
}

/** §26: the tab layout, stored opaquely. The renderer validates and prunes it
    on restore (layoutPersist.ts), so main never has to know what a tab is —
    the same division of labour as getShortcuts above. */
export function getLayout(): Record<string, unknown> {
  return load().layout ?? {};
}

export function setLayout(layout: Record<string, unknown>): void {
  const cfg = load();
  if (Object.keys(layout).length > 0) cfg.layout = layout;
  else delete cfg.layout;
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

// §24 Commands: linked external prompt dirs (referenced in place, not copied —
// ~/.claude/commands is typically git-tracked and owned by another tool).
export function getLinkedPromptTemplateDirs(): string[] {
  return load().linkedPromptTemplateDirs ?? [];
}

export function setLinkedPromptTemplateDirs(dirs: string[]): void {
  const cfg = load();
  const clean = [...new Set(dirs.filter((d) => typeof d === "string" && d.trim()))];
  if (clean.length) cfg.linkedPromptTemplateDirs = clean;
  else delete cfg.linkedPromptTemplateDirs;
  save(cfg);
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

/** §27 — downloaded model weights (voice today, anything heavy later). */
export function modelCacheDir(): string {
  const d = path.join(app.getPath("userData"), "models");
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
 * §12 FR7: where the child guard appends its per-run decision JSONL
 * (HV_CHILD_AUDIT_DIR). Under userData because MAIN owns it — the guard writes,
 * main drains and deletes, and `subagentAudit.ts` confines every read to this
 * root rather than trusting the env var it travelled through.
 */
export function childAuditRoot(): string {
  const d = path.join(app.getPath("userData"), "subagent-audit");
  fs.mkdirSync(d, { recursive: true });
  return d;
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
 * per run, which the renderer maps 1:1 to a run card. `waitTool.enabled:false`
 * (>=0.50) stops upstream steering the model into a turn-blocking wait. The dir
 * is app-owned but the file's schema is upstream's, so we merge-write (preserve
 * any keys a future version adds). Idempotent. Pinned by tests/subagent-config.test.ts.
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
  // PRD §12 (2026-08-17): pi-subagents >=0.50 can disable its own wait tool, and a
  // blocking wait is never right here — results always arrive as their own turn.
  // The WAIT_TOOLS name guard (hv-rules.ts) stays on top of this: a config key a
  // future version renames fails SILENT, a renamed tool name fails the contract
  // test loudly. Per-task blocking discretion lives at dispatch (`async:false`).
  config.waitTool = { ...(config.waitTool as object | undefined), enabled: false };
  // PRD §12 (2026-08-19): pi-subagents 0.51 added this, and it decides whether a
  // child starts fresh or FORKS the parent's session. Upstream's default is
  // already "fresh" (fork-context.ts), which is what §12's isolation contract has
  // always assumed — so this states a value rather than changing one. Stated
  // because a future flip to "fork" would hand every sub-agent the parent's
  // entire transcript, with no user-visible symptom and no failing test to
  // announce it. tests/subagent-config.test.ts pins both halves: our key, and
  // that upstream still agrees.
  config.defaultSubagentContext = "fresh";
  // PRD §12/§19 (2026-08-29): pi-subagents 0.57 caches "this model failed" verdicts
  // and silently skips the model on every later delegation. The default TTL is 24
  // HOURS and the cache is per-UID in a temp dir, so one flaky child ("Subagent
  // produced no output") stops that model being used across every session and
  // workspace for a day — with the only signal a console.warn the app never shows.
  // Observed on a real install: qwen3.8-flash excluded for 24h while the chat kept
  // showing it as the session model.
  //
  // Five minutes absorbs a genuine cold start, which is what the mechanism is FOR,
  // without letting one blip cost a day. Setting the key explicitly also shortens
  // entries already on disk (upstream passes `shortenExisting` when the value is
  // configured), so a stale 24h exclusion self-heals at the next start rather than
  // needing the file deleted. The bridge reports any live exclusion as an audit
  // row — shortening the window is not the same as telling the user.
  config.modelExclusions = { ...(config.modelExclusions as object | undefined), defaultTtlMs: 5 * 60_000 };
  // PRD §12 (2026-08-21) — FR12 was IMPLEMENTED, MEASURED AND DROPPED. We
  // deliberately write NO `permissions` key. Do not add one back.
  //
  // The idea was a redundant native floor beneath the ceiling and the child
  // guard. It cannot work, because this file is written ONCE at startup while a
  // boundary is approved per delegation, so any rule here is unconditional —
  // and `permissionDecision` has no boundary awareness to give it.
  //
  // That makes it either redundant or harmful, never useful:
  //  - when a tool is OUTSIDE the approved boundary, the capability ceiling has
  //    already removed it from the child's --tools, so there is nothing to deny;
  //  - when a tool is INSIDE it, this silently overrides the approval.
  //
  // Measured, not reasoned: with `permissions: {rules:{write:"deny"}}` armed, a
  // child whose boundary included `write` and whose rules explicitly ALLOWED it
  // had its guard row say "allow" and the file was still never created. The modal
  // would promise "It can change things with: write", the user would grant it,
  // and the write would fail silently — a worse lie than no boundary at all,
  // because the user believes they granted something.
  //
  // Pinned by an absence test in tests/subagent-config.test.ts and, end to end,
  // by "an APPROVED write actually succeeds" in tests/child-guard-bridge.test.ts.
  fs.writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`);
}

/**
 * §25: the plugin marketplaces the user has listed.
 *
 * The resolver, schema and UI support N marketplaces; V1 ships exactly ONE
 * listed — the official Anthropic directory, which ships in every Claude Code
 * install and so is the list users arrive already expecting. Pre-listing the
 * other surveyed marketplaces would spend day-one trust on repos we do not
 * control. Adding another is a user action; the app lists nothing on the user's
 * behalf, the same posture as §24's decision to stop auto-scanning
 * `.claude/commands`.
 */
// Defined in an electron-free module so the release-time catalog generator can
// import the URL without pulling in the app; re-exported so callers here and in
// ipc.ts are unchanged.
/**
 * Keep upstream's external-CLI builtin agents out of the injected roster.
 *
 * PRD §12 (2026-08-28): pi-subagents 0.58 ships 13 builtin agents, six of them
 * `runner: external-cli`. This is HYGIENE only — the ENFORCEMENT is
 * `isExternalCliAgent` in hv-rules.ts, checked by the bridge, because a
 * PROJECT-scope `.pi/settings.json` override beats this user-scope file
 * outright. With the six disabled here the model is never told they exist, so it
 * cannot spend a turn proposing one and being refused.
 *
 * The merge logic is pure and lives in subagentSettings.ts so vitest can reach
 * it; this function is only the file I/O. Note the target is PI's own settings
 * file, which is why the read-merge-write shape is load-bearing rather than
 * tidy: HappyVibe is merely the first thing in the app to write it.
 */
export function writeSubagentSettings(): void {
  const file = path.join(agentDir(), "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* absent or corrupt — start fresh */
  }
  fs.writeFileSync(file, `${JSON.stringify(disabledAgentOverrides(settings, load().agentsEnabled ?? {}), null, 2)}\n`);
}

/**
 * Record the user's choice for one agent and re-derive upstream's settings file.
 *
 * An EXTERNAL_CLI agent is refused here rather than in the renderer — main owns
 * the rules, and `resolveDisabledAgents` forces them anyway, so this is the
 * honest error rather than a silent no-op.
 */
export function setAgentEnabled(name: string, enabled: boolean): void {
  if (EXTERNAL_CLI_AGENTS.has(name)) throw new Error(`'${name}' cannot be enabled: HappyVibe's boundary cannot govern an external CLI agent.`);
  if (UNSUPPORTED_BUILTIN_AGENTS.has(name)) throw new Error(`'${name}' cannot be enabled: it cannot do its job in this runtime.`);
  const cfg = load();
  cfg.agentsEnabled = { ...(cfg.agentsEnabled ?? {}), [name]: enabled };
  save(cfg);
  writeSubagentSettings();
}

export { OFFICIAL_MARKETPLACE };

export function listMarketplaces(): Array<{ id: string; url: string }> {
  return load().marketplaces ?? [OFFICIAL_MARKETPLACE];
}

/** Add (or replace by id) a marketplace. Seeds the built-in first, so removing
 *  the official one and adding another does not silently resurrect it. */
export function addMarketplace(entry: { id: string; url: string }): Array<{ id: string; url: string }> {
  const cfg = load();
  const cur = cfg.marketplaces ?? [OFFICIAL_MARKETPLACE];
  cfg.marketplaces = [...cur.filter((m) => m.id !== entry.id), entry];
  save(cfg);
  return cfg.marketplaces;
}

export function removeMarketplace(id: string): Array<{ id: string; url: string }> {
  const cfg = load();
  const cur = cfg.marketplaces ?? [OFFICIAL_MARKETPLACE];
  cfg.marketplaces = cur.filter((m) => m.id !== id);
  save(cfg);
  return cfg.marketplaces;
}
