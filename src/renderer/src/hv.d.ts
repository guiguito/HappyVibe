declare global {
/** Mirrors SessionMeta in src/main/store.ts (separate tsconfig roots — kept in sync by hand). */
interface SessionMeta {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  piSessionFile?: string;
  /** W1.3: hibernated to make room; opens transparently (Pi --session resume). */
  hibernated?: boolean;
  /** W2.1: per-session model override (session → workspace → global). */
  model?: { provider: string; modelId: string };
  titleSource: "fallback" | "model" | "user";
}

/** Round-4: reopened sessions restore tool cards too (intent + result live in
    the session file), not just user/assistant text. */
type RestoreItem =
  // §24: `command` is set by main when this user message was a prompt-template
  // expansion (paired by hash against the logged command.invoked event), so a
  // reopened session redraws the card instead of a wall of expanded prompt.
  | { kind: "user" | "assistant"; text: string; promptTemplate?: { typed: string } }
  | { kind: "tool"; toolCallId: string; toolName: string; args: unknown; result?: string; error?: boolean }
  | { kind: "plan"; planPath: string; status?: string; done?: number; total?: number };

interface HvByokProvider {
  id: string;
  label: string;
  source: "env" | "stored" | null;
}

/** §16 (2026-07-30): a user-defined OpenAI-compatible endpoint. Mirrors
 *  CustomEndpoint in src/main/modelsJson.ts. */
interface HvCustomEndpoint {
  id: string;
  /** models.json provider key — `hv-<id>`, namespaced away from Pi's built-ins. */
  providerKey: string;
  label: string;
  baseUrl: string;
  preset: "ollama" | "vllm" | "lmstudio" | "llamacpp" | "other";
  auth: { kind: "env" } | { kind: "placeholder"; value: string };
  /** priceIn/priceOut are USD per MILLION tokens; unset = unpriced (cost unknown). */
  models: { id: string; contextWindow?: number; priceIn?: number; priceOut?: number; priceCacheRead?: number }[];
}

/** Mirrors ApiCall in src/main/calls.ts (from hv:get-session-calls). */
interface HvApiCall {
  ts: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Pi's cost estimate. Owed only when `billing` is "metered". */
  cost: number;
  /** metered = per-token; plan = flat subscription (cost NOT owed); unknown = no rate. */
  billing: "metered" | "plan" | "unknown";
}

/** Mirrors LedgerTotal in src/main/calls.ts. */
interface HvLedgerTotal {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD estimate for METERED calls only. */
  cost: number;
  metered: number;
  /** Calls covered by a subscription — named, not silently priced. */
  plan: number;
  /** Calls whose price is unknown — surfaced, never silently summed as $0. */
  unknown: number;
}

interface HvModel {
  provider: string;
  id: string;
  name: string;
  /** B5: model context window, for the estimated-gauge fallback. */
  contextWindow?: number;
  /** W2.1: accepted input kinds (e.g. ["text","image"]) — gates image attach. */
  input?: string[];
}

/** MCP server config file shape (renderer-local; do not import from src/main). */
interface McpFileLike {
  mcpServers: Record<string, Record<string, unknown>>;
}

/** B6 — mirrors AgentDef in pi-runtime/extensions/hv-agents.ts (from the hv.agents notify). */
interface HvAgent {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  source: "builtin" | "project";
  path: string;
}

/** B6 — a built-in LLM tool (from the hv.tools notify; permission joined renderer-side). */
interface HvTool {
  name: string;
  description: string;
  source: string;
}

/** §14 — mirrors SkillView in src/main/skills/view.ts (from hv:skills-list). */
interface HvSkillView {
  id: string;
  name: string;
  description: string;
  source: "managed" | "workspace" | "linked" | "bundled";
  status: "active" | "disabled" | "needs-review" | "error";
  scriptCount: number;
  disableModelInvocation: boolean;
  estTokens: { card: number; body: number };
  changed: boolean;
  provenance?: { source: string; sourceUrl?: string; ref?: string; commitSha?: string; importedAt?: string };
}

/** §14 — per-workspace activation checklist entry. */
interface HvSkillChecklistItem {
  id: string;
  name: string;
  source: "managed" | "workspace" | "linked" | "bundled";
  scope: "global" | "workspace";
  active: boolean;
}

interface HvSkillsList {
  global: HvSkillView[];
  workspace: { skills: HvSkillView[]; checklist: HvSkillChecklistItem[] } | null;
}

/** §14 — a scan result from a local-folder or git-URL import (pick which to import). */
interface HvSkillImportScan {
  token: string | null;
  skills: Array<{ id: string; name: string; description: string; scriptCount: number }>;
  error?: string;
}

/** §14 — the inspector payload (hv:skills-read): current content + approved snapshot for the diff. */
interface HvSkillDetail {
  name: string;
  description: string;
  source: "managed" | "workspace" | "linked" | "bundled";
  /** linked skills only: the configured root that unlinking would drop… */
  linkedRoot?: string;
  /** …and how many OTHER skills come from that same root. */
  linkedSiblings?: number;
  files: string[];
  scriptCount: number;
  estTokens: { card: number; body: number };
  status: "active" | "disabled" | "needs-review" | "error";
  provenance: { source: string; sourceUrl?: string; ref?: string; commitSha?: string; importedAt?: string } | null;
  current: string;
  approved: string | null;
}

/** §25 — one row in the plugin store. Every row is a plugin that was VERIFIED at
 *  release time by the app's own classifier and can actually be installed, so
 *  there is no `accepted`/`reason` pair: unsupported plugins are not listed at
 *  all. Mirrors PluginCatalogEntry in src/main/plugins/catalog.generated.ts. */
interface HvPluginCard {
  name: string;
  description: string;
  category?: string;
  homepage?: string;
  /** Branch or tag, display only. */
  ref?: string;
  /** The commit it was verified at, and the one install fetches. */
  sha: string | null;
  /** simple-icons class; absent → BrandMark renders a monogram. */
  brand?: string;
  /** Counts from the verification pass, so a card needs no download. */
  counts: { skills: number; commands: number; servers: number };
}

/** §25 — everything the confirm dialog must show BEFORE anything is written. */
interface HvPluginScan {
  ok: true;
  token: string;
  name: string;
  description: string;
  accepted: boolean;
  reason?: string;
  sha: string | null;
  ref?: string;
  skills: Array<{
    dir: string;
    name: string;
    description: string;
    scriptCount: number;
    /** "reject" cannot be installed — it would run and fail silently. */
    screen: "ok" | "reject" | "warn";
    screenReason?: string;
    /** How many ${CLAUDE_PLUGIN_ROOT} refs install would rewrite. */
    pluginRootRefs: number;
  }>;
  commands: Array<{ file: string; name: string; description: string }>;
  mcpServers: string[];
  /** Dropped thing ⇢ count, for the disclosure banner. Empty ⇒ no banner. */
  dropped: Record<string, number>;
}

/** §24 — mirrors PromptTemplateView in src/main/commands/view.ts (from hv:prompt-templates-list). */
interface HvPromptTemplateView {
  /** Absolute path to the .md file — the approval key AND the --prompt-template arg. */
  id: string;
  name: string;
  description: string;
  argumentHint?: string;
  source: "managed" | "workspace" | "linked" | "bundled";
  /** "shadowed" = the name collides with a bridge /hv-* command, so Pi can never reach it. */
  status: "active" | "disabled" | "needs-review" | "shadowed";
  /** Body uses CC's inline !`cmd` injection, which Pi passes through literally — a risk pill, never a block. */
  hasBashInjection: boolean;
  /** Paid only on invocation: a command never enters the system prompt. */
  estTokens: { body: number };
  changed: boolean;
  provenance?: { source: string; sourceUrl?: string; ref?: string; commitSha?: string; importedAt?: string };
}

interface HvPromptTemplatesList {
  global: HvPromptTemplateView[];
  /** `commands` = this workspace's two roots; `checklist` = every approved+enabled command, global included. */
  workspace: { templates: HvPromptTemplateView[]; checklist: HvPromptTemplateView[] } | null;
}

/** §24 — a scan result from a local-folder or git-URL import (pick which to import). */
interface HvPromptTemplateImportScan {
  token: string | null;
  templates: Array<{ id: string; name: string; description: string; argumentHint?: string; hasBashInjection: boolean }>;
  error?: string;
}

/** §24 — the inspector payload (hv:prompt-templates-read). `current`/`approved` are both TEMPLATE BODIES. */
interface HvPromptTemplateDetail {
  name: string;
  description: string;
  argumentHint?: string;
  source: "managed" | "workspace" | "linked" | "bundled";
  linkedRoot?: string;
  linkedSiblings?: number;
  hasBashInjection: boolean;
  estTokens: { body: number };
  status: "active" | "disabled" | "needs-review" | "shadowed";
  provenance: { source: string; sourceUrl?: string; ref?: string; commitSha?: string; importedAt?: string } | null;
  current: string;
  approved: string | null;
}

/** Mirrors Rule/RulesFile/Verdict in pi-runtime/extensions/hv-rules.ts (separate tsconfig roots). */
interface HvRule {
  layer: "tool" | "path" | "command";
  pattern: string;
  action: "allow" | "ask" | "deny";
}

interface HvRulesFile {
  global: HvRule[];
  workspaces: Record<string, HvRule[]>;
}

interface HvVerdict {
  action: "allow" | "ask" | "deny";
  source: "rule" | "safe-default" | "default";
  rule?: HvRule & { scope: "global" | "workspace" };
}

/** W2.2 — mirrors FsEntry/ReadResult in src/main/files.ts (separate tsconfig roots). */
interface HvFsEntry {
  name: string;
  kind: "dir" | "file";
}

type HvReadResult =
  | { kind: "text"; content: string; mtimeMs: number }
  | { kind: "too-large"; size: number }
  | { kind: "binary" };

/** Mirrors LogEvent in src/main/log.ts. */
interface HvAuditEvent {
  ts: string;
  type: string;
  sessionId?: string;
  workspaceId?: string;
  data?: Record<string, unknown>;
}

/** B7 — mirrors Analytics in src/main/analytics.ts (from hv:get-analytics). */
interface HvBreakdown {
  key: string;
  sessions: number;
  tokens: number;
  cost: number;
}

interface HvAnalytics {
  totalSessions: number;
  openSessions: number;
  crashes: number;
  tokens: { input: number; output: number };
  /** Metered dollars only — plan spend is excluded (§19). */
  cost: number;
  /** Some spend could not be priced; render `$X+?`, never a total that looks whole. */
  costUnknown: boolean;
  duration: { avgMs: number | null; medianMs: number | null; count: number };
  sessionsPerDay: Array<{ date: string; count: number }>;
  perWorkspace: HvBreakdown[];
  perModel: HvBreakdown[];
  permissions: {
    total: number;
    byDecision: Record<string, number>;
    bySource: Record<string, number>;
  };
}

/** MCP per-server runtime status (renderer-local; do not import from src/main). */
interface McpServerStatusLike {
  name: string;
  scope: "global" | "workspace";
  workspaceId: string | null;
  state: "connected" | "needs-auth" | "failed" | "checking";
  toolCount: number;
  tools?: { name: string; description?: string }[];
  error?: string;
  lastChecked: number;
}

interface HvApi {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  getStats(sessionId?: string): Promise<unknown>;
  /** Billed API calls (oldest first) + their total. Main sums it so the renderer
   *  never re-implements ledgerTotal. Mirrors src/main/calls.ts. */
  getSessionCalls(sessionId: string): Promise<{ calls: HvApiCall[]; total: HvLedgerTotal }>;
  respondPermission(id: string, choice: string): void;

  listWorkspaces(): Promise<string[]>;
  addWorkspace(): Promise<string | null>;
  removeWorkspace(ws: string): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  createSession(workspaceId: string): Promise<SessionMeta>;
  openSession(sessionId: string): Promise<{
    meta: SessionMeta;
    messages: RestoreItem[] | null;
    /** §9: non-null when the session was compacted — the transcript stops at a boundary bubble. */
    compaction: { count: number; reason: string | null } | null;
    /** §23: the session's active plan, so the pill survives a renderer reload. */
    plan: { path: string; status: string; done: number; total: number } | null;
  }>;
  /** §9: the pre-compaction history, display only — never re-entered into context. */
  loadEarlier(sessionId: string): Promise<RestoreItem[]>;
  closeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  promptSession(
    sessionId: string,
    msg: string,
    behavior?: "steer" | "followUp",
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    /** F3: workspace-relative paths of @file references — content injected main-side. */
    mentions?: string[]
  ): Promise<{ warnings: string[] }>;
  abortSession(sessionId: string): Promise<void>;
  // W2.1: per-session model override + image attach
  setSessionModel(sessionId: string, m: { provider: string; modelId: string } | null): Promise<{ live: boolean }>;
  pickImage(): Promise<{ data: string; mimeType: string; name: string } | null>;

  // W2.2: file tree + editor + card path actions
  fsList(workspaceId: string, relDir: string): Promise<HvFsEntry[]>;
  /** F3: recursive listing for @-mention autocomplete (capped). */
  fsListRecursive(workspaceId: string): Promise<Array<{ rel: string; kind: "dir" | "file" }>>;
  fsRead(workspaceId: string, relPath: string): Promise<HvReadResult>;
  fsWrite(workspaceId: string, relPath: string, content: string): Promise<number>;
  fsMtime(workspaceId: string, relPath: string): Promise<number | null>;
  revealPath(workspaceId: string, relPath: string): Promise<void>;
  /** Round 4 #7: file-tree Details / Delete-to-Trash (workspace-confined). */
  fsStat(workspaceId: string, relPath: string): Promise<{ kind: "dir" | "file"; size: number; mtimeMs: number }>;
  fsTrash(workspaceId: string, relPath: string): Promise<void>;
  /** WS8: file-tree mutations (confined; throw on clobber). */
  fsCreateFile(workspaceId: string, relPath: string): Promise<void>;
  fsCreateDir(workspaceId: string, relPath: string): Promise<void>;
  fsMove(workspaceId: string, srcRel: string, destDirRel: string): Promise<string>;
  fsImport(workspaceId: string, destDirRel: string, srcAbsPaths: string[]): Promise<string[]>;
  /** WS8: native fs watching — auto-refresh the tree. */
  watchWorkspace(workspaceId: string): Promise<void>;
  unwatchWorkspace(workspaceId: string): Promise<void>;
  onFsChanged(cb: (p: { workspaceId: string; relDirs: string[] }) => void): () => void;
  // §23 Plan Mode
  planSet(sessionId: string, enabled: boolean): Promise<void>;
  planImplement(sessionId: string, relPath: string, model?: { provider: string; modelId: string } | null): Promise<void>;
  planDiscard(sessionId: string): Promise<void>;
  planStatus(sessionId: string, relPath: string, status: string): Promise<void>;
  /** §23 round 7: roll the workspace back to the Implement baseline. */
  planRevert(sessionId: string): Promise<{
    restored: string[]; deleted: string[]; stale: string[]; notCaptured: string[];
  } | null>;
  /** `sessionId` is set only on the respawn push, where it attaches the plan to a session. */
  onPlanChanged(cb: (p: { sessionId?: string; workspaceId: string; path: string; status: string; done: number; total: number }) => void): () => void;
  getPathForFile(file: File): string;

  // B2: AGENTS.md
  readAgentsMd(workspaceId: string): Promise<string | null>;
  writeAgentsMd(workspaceId: string, content: string): Promise<void>;
  /** WS5: write the agents-md-maker structured draft (root + nested). Returns written rel paths. */
  writeAgentsMdFiles(workspaceId: string, files: Record<string, string>): Promise<string[]>;
  proposeAgentsMd(workspaceId: string): Promise<string | null>;
  // W2.3 missing-file flow
  hasClaudeMd(workspaceId: string): Promise<boolean>;
  copyClaudeMd(workspaceId: string): Promise<string>;

  onPiEvent(cb: (e: Record<string, unknown>) => void): () => void;
  onUiRequest(
    cb: (r: { id: string; sessionId?: string; method?: string; title?: string; message?: string; options?: string[] }) => void
  ): () => void;
  onPiExit(cb: (info: { sessionId: string; code: number | null; intentional: boolean }) => void): () => void;
  /** V2.A: provider/model config changed — refetch model lists/tiers. */
  onProvidersChanged(cb: () => void): () => void;
  onSessionsChanged(cb: (sessions: SessionMeta[]) => void): () => void;
  onSessionReloading(cb: (info: { sessionId: string; reason: string }) => void): () => void;
  onUiUnhandled(cb: (info: { sessionId: string; method?: string }) => void): () => void;
  // B3: providers & onboarding
  respondInput(id: string, value: string | null): void;
  getProviders(): Promise<{
    byok: HvByokProvider[];
    defaultModel: { provider: string; modelId: string } | null;
    /** §16: the provider set BOTH main and the renderer filter model refs with. */
    knownProviders: string[];
  }>;
  setProviderKey(provider: string, key: string): Promise<void>;
  removeProviderKey(provider: string): Promise<void>;
  authLogin(provider: string): Promise<void>;
  authLoginCancel(provider: string): Promise<void>;
  authLogout(provider: string): Promise<void>;
  authStatus(): Promise<void>;
  /** Round 11: last-known provider auth status, held in main (survives page unmounts). */
  authState(): Promise<Record<string, { configured: boolean; source?: string; label?: string }>>;
  onAuthStateChanged(cb: (s: Record<string, { configured: boolean; source?: string; label?: string }>) => void): () => void;
  detectOllama(): Promise<{ running: boolean; models: string[] }>;
  /** §16 (2026-07-30): user-defined OpenAI-compatible endpoints. */
  getCustomEndpoints(): Promise<{ endpoints: HvCustomEndpoint[]; keyStatus: Record<string, boolean> }>;
  /** Main derives providerKey and auth — the renderer only sends the draft. */
  saveCustomEndpoint(
    draft: Pick<HvCustomEndpoint, "id" | "label" | "baseUrl" | "preset" | "models">,
    key?: string,
  ): Promise<void>;
  removeCustomEndpoint(id: string): Promise<void>;
  fetchEndpointModels(baseUrl: string, key?: string): Promise<{ ok: boolean; models: string[]; error?: string }>;
  listModels(): Promise<HvModel[]>;
  setDefaultModel(provider: string, modelId: string): Promise<void>;
  hasAnyProvider(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  // B4: permissions v1
  getRules(): Promise<HvRulesFile>;
  setRules(rules: HvRulesFile): Promise<HvRulesFile>;
  /** Round 3 #13: append a tool-layer allow rule (workspace path, or null = global). */
  addPermissionRule(workspace: string | null, tool: string): Promise<HvRulesFile>;
  /** Round 3 #14: persistent "bypass all permissions". */
  getGlobalBypass(): Promise<boolean>;
  setGlobalBypass(on: boolean): Promise<void>;
  /** null = unset (inherit global). */
  getWorkspaceBypass(workspace: string): Promise<boolean | null>;
  setWorkspaceBypass(workspace: string, on: boolean | null): Promise<void>;
  evalRules(workspaceId: string, tool: string, input: Record<string, unknown>): Promise<HvVerdict>;
  readAudit(filter?: { sessionId?: string; workspaceId?: string }): Promise<HvAuditEvent[]>;
  setBadgeCount(n: number): void;
  // B5: context visibility
  contextSnapshot(sessionId: string): Promise<void>;
  contextRemove(sessionId: string, keys: string[]): Promise<void>;
  contextRestore(sessionId: string, keys: string[]): Promise<void>;
  compactSession(sessionId: string): Promise<void>;
  // §9 rewind file rollback
  rewindPreview(sessionId: string, toolCallIds: string[]): Promise<{
    willRestore: string[]; willDelete: string[]; stale: string[];
  } | null>;
  rewindRestore(sessionId: string, toolCallIds: string[]): Promise<{
    restored: string[]; deleted: string[]; stale: string[]; notCaptured: string[];
  } | null>;
  // B6: agents & tools
  listAgents(sessionId?: string): Promise<void>;
  listTools(sessionId?: string): Promise<void>;
  /** Async subagents: interrupt a running detached run (stop button). */
  subagentInterrupt(sessionId: string, runId: string): Promise<void>;
  /** Live status pushes for detached runs (currentTool, activityState, …). */
  onSubagentStatus(cb: (i: { sessionId: string; runId: string; status: Record<string, unknown> }) => void): () => void;
  readAgent(filePath: string): Promise<{ body: string; model?: string }>;
  writeAgent(filePath: string, edit: { body?: string; model?: string | null }): Promise<void>;
  duplicateAgent(filePath: string): Promise<string>;

  // W1.4: system prompt + workspace settings
  sysPromptSnapshot(sessionId?: string): Promise<void>;
  getGlobalAppend(): Promise<string | null>;
  setGlobalAppend(content: string): Promise<void>;
  getWorkspaceModel(workspaceId: string): Promise<{ provider: string; modelId: string } | null>;
  setWorkspaceModel(workspaceId: string, m: { provider: string; modelId: string } | null): Promise<void>;

  // §13 round 6: configurable built-in custom tools (plan mode, ask_user)
  builtinsGet(): Promise<{ plan: boolean; askUser: boolean; planAppend: string }>;
  builtinsSet(t: { plan?: boolean; askUser?: boolean; planAppend?: string }): Promise<void>;
  /** Read-only display of a built-in tool's real, unmodified prompt (currently "plan" only). */
  builtinPrompt(name: string): Promise<{ text: string }>;

  /** Extended prompt-cache retention (PI_CACHE_RETENTION=long). Global, applied
      at the next spawn — live sessions keep the retention they started with. */
  getLongCache(): Promise<boolean>;
  setLongCache(on: boolean): Promise<void>;

  /** Round 8: keyboard-shortcut overrides (action id → canonical binding). */
  getShortcuts(): Promise<Record<string, string>>;
  setShortcuts(map: Record<string, string>): Promise<void>;

  // §14 Skills (additive)
  skillsList(workspaceId?: string): Promise<HvSkillsList>;
  skillsRead(id: string): Promise<HvSkillDetail>;
  skillsApprove(id: string): Promise<void>;
  skillsSetEnabled(id: string, enabled: boolean): Promise<void>;
  skillsSetActive(workspaceId: string, id: string, on: boolean | null): Promise<void>;
  skillsGetLinked(): Promise<string[]>;
  skillsSetLinked(dirs: string[]): Promise<void>;
  skillsAddLinked(): Promise<string[]>;
  skillsImportLocal(): Promise<HvSkillImportScan | null>;
  skillsImportGit(url: string): Promise<HvSkillImportScan>;
  skillsImportSelect(token: string, ids: string[], scope: "global" | "workspace", workspaceId: string | null): Promise<string[]>;
  skillsNewSkill(sessionId: string): Promise<{ ok: boolean; error?: string }>;
  skillsPromote(id: string): Promise<string>;
  skillsDelete(
    skillId: string,
    workspaceId: string | null,
  ): Promise<{ ok: true; kind: "delete" | "unlink" } | { ok: false; error: string }>;
  /** §14 round 6: the skills Pi actually loaded for this session (from the manifest). */
  skillsSession(sessionId: string): Promise<Array<{ name: string; scope: "global" | "workspace" }>>;
  /** §14 round 6: Pi's slash commands (pure get_commands query) — skills are
      source:"skill", prompt templates source:"prompt". §24: main joins Pi's list
      against its own scan by NAME to add description/argumentHint, which
      get_commands does not carry. */
  listCommands(sessionId: string): Promise<Array<{ name: string; source: string; description?: string; argumentHint?: string }>>;
  onSkillsChanged(cb: () => void): () => void;

  // §24 Commands (prompt templates) — the §14 surface, channel for channel.
  promptTemplatesList(workspaceId?: string): Promise<HvPromptTemplatesList>;
  promptTemplatesRead(id: string): Promise<HvPromptTemplateDetail>;
  promptTemplatesApprove(id: string): Promise<void>;
  promptTemplatesSetEnabled(id: string, enabled: boolean): Promise<void>;
  promptTemplatesSetActive(workspaceId: string, id: string, on: boolean | null): Promise<void>;
  promptTemplatesGetLinked(): Promise<string[]>;
  promptTemplatesSetLinked(dirs: string[]): Promise<void>;
  /** With a dir: link it straight away (the ~/.claude/commands suggestion). Without: open the picker. */
  promptTemplatesAddLinked(dir?: string): Promise<string[]>;
  promptTemplatesImportLocal(): Promise<HvPromptTemplateImportScan | null>;
  promptTemplatesImportGit(url: string): Promise<HvPromptTemplateImportScan>;
  /** `reserved` = the batch was refused because that name is a bridge command (PRD §24). */
  promptTemplatesImportSelect(
    token: string,
    ids: string[],
    scope: "global" | "workspace",
    workspaceId: string | null,
  ): Promise<{ imported: string[]; reserved?: string; error?: string }>;
  promptTemplatesDelete(
    id: string,
    workspaceId: string | null,
  ): Promise<{ ok: true; action: "delete" | "unlink" } | { ok: false; error: string }>;
  promptTemplatesPromote(id: string): Promise<string>;
  onPromptTemplatesChanged(cb: () => void): () => void;

  // §25 plugin marketplaces.
  pluginMarketplaces(): Promise<Array<{ id: string; url: string }>>;
  pluginAddMarketplace(
    url: string,
  ): Promise<{ ok: true; id: string; entries: number } | { ok: false; error: string }>;
  pluginRemoveMarketplace(id: string): Promise<Array<{ id: string; url: string }>>;
  /** The embedded, verified store. No network — everything listed installs. */
  pluginList(): Promise<{ ok: true; name: string; generatedAt: string; plugins: HvPluginCard[] }>;
  pluginScan(
    marketplaceId: string,
    name: string,
  ): Promise<HvPluginScan | { ok: false; error: string }>;
  pluginInstall(
    token: string,
    sel: { skillDirs: string[]; commandFiles: string[]; mcpKeys: string[] },
  ): Promise<
    | { ok: true; skills: string[]; substituted: number; commands: string[]; servers: string[] }
    | { ok: false; error: string }
  >;
  /** Derived from the same provenance/origin links Remove uses, so the list
   *  cannot disagree with what removing would actually take away. */
  pluginInstalled(): Promise<
    Array<{ plugin: string; marketplace?: string; skills: string[]; commands: string[]; servers: string[] }>
  >;
  pluginRemove(
    plugin: string,
  ): Promise<
    | { ok: true; skills: string[]; commands: string[]; servers: string[] }
    | { ok: false; error: string }
  >;

  // MCP server config (additive). Changes apply to new sessions.
  mcpGet(workspaceId?: string): Promise<{ global: McpFileLike; workspace: McpFileLike | null }>;
  mcpSetServer(
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
    cfg: Record<string, unknown> | null,
  ): Promise<McpFileLike>;
  mcpStatus(): Promise<McpServerStatusLike[]>;
  mcpCheck(scope: "global" | "workspace", workspaceId: string | null, name?: string): Promise<void>;
  mcpAuthenticate(
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
  ): Promise<{ ok: true; tools: { name: string; description?: string }[] } | { ok: false; error: string }>;
  mcpLogout(name: string): Promise<void>;
  onMcpStatusChanged(cb: (s: McpServerStatusLike[]) => void): () => void;
  // §13 round 8: curated catalog. Install by KEY — main owns the catalog and the
  // secrets, so the renderer never sends a config object.
  mcpInstallCatalog(
    catalogKey: string,
    scope: "global" | "workspace",
    workspaceId: string | null,
    values: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Is a node/npx runtime on PATH? Badges the catalog's stdio entries. */
  nodeAvailable(): Promise<boolean>;
  /** Connect → authenticate-if-needed → tools, in one call. */
  mcpConnectFlow(
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
  ): Promise<{ ok: true; tools: { name: string; description?: string }[] } | { ok: false; error: string }>;

  // B7: local analytics + onboarding
  getAnalytics(filter?: { workspaceId?: string; sinceTs?: string }): Promise<HvAnalytics>;
  getOnboardingSeen(): Promise<boolean>;
  setOnboardingSeen(seen: boolean): Promise<void>;
}

  interface Window {
    hv: HvApi;
  }
}

export {};
