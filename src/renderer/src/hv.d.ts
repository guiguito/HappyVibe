declare global {
/** §26. Mirrors TerminalInfo in src/main/terminals.ts (separate tsconfig roots). */
interface HvTerminalInfo {
  id: string;
  workspaceId: string;
  /** The foreground command, else the shell name. What the tab strip shows. */
  title: string;
  running: boolean;
  exitCode: number | null;
}
/** §27. Mirrors VoiceStatus in src/main/voice/index.ts. */
interface HvVoiceStatus {
  state: "unactivated" | "downloading" | "ready" | "error";
  bytesDone: number;
  bytesTotal: number;
  error?: string;
  /** What Remove would free. 0 when nothing is on disk. */
  sizeOnDisk: number;
}
/** §27. Mirrors VoiceSettings in src/main/voice/settings.ts. */
interface HvVoiceSettings {
  /** Round 2: functional activation, separate from model readiness. */
  enabled: boolean;
  /** Round 2: whether the chip takes space in the composer row. */
  showInComposer: boolean;
  language: string;
  /** "" means the system default input device. */
  inputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  holdThresholdMs: number;
  maxRecordingMs: number;
}
/** §28. Mirrors BrowserInfo in src/main/browsers.ts (separate tsconfig roots). */
interface HvBrowserInfo {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  /** "blocked" carries blockedHost; "failed" carries error. Never a blank pane. */
  state: "loading" | "ready" | "failed" | "blocked" | "crashed";
  blockedHost?: string;
  error?: string;
  /** Raw Chromium net error, so the pane can offer the right way out (§28 r1). */
  errorCode?: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

// ── §29 Git integration. Mirrors src/main/gitParse.ts and src/main/git.ts. ──

/** The five outcomes of §5. `no-git` is an ordinary state, not an error. */
type HvRepoState =
  | { kind: "no-git" }
  | { kind: "no-repo" }
  | { kind: "repo"; root: string; subdir: string | null; unborn: boolean }
  | { kind: "error"; message: string; fix: string | null };

interface HvGitFileChange {
  path: string;
  origPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  additions: number;
  deletions: number;
}

interface HvGitBranchInfo {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

interface HvDiffHunk {
  header: string;
  lines: string[];
  /** Exactly what `git apply -R` gets — never rebuilt in the renderer. */
  raw: string;
}

interface HvFileDiff {
  path: string;
  origPath?: string;
  binary: boolean;
  hunks: HvDiffHunk[];
  fileHeader: string;
}

interface HvGitStatusPayload {
  state: HvRepoState;
  status?: { branch: HvGitBranchInfo; files: HvGitFileChange[] };
  stashes?: { index: number; message: string }[];
  lastSubject?: string;
}

interface HvLogEntry {
  sha: string;
  subject: string;
  authorDate: string;
}

/** Every git write answers this shape. `busy` = main's idle gate refused. */
interface HvGitWrite {
  ok: boolean;
  error?: string;
  /** Session titles holding the working tree, when the gate refused. */
  busy?: string[];
}

/** "Since your last save" (vs HEAD) or "Against <base branch>" (merge-base). */
type HvGitBaseline = "head" | "base";

/** §26. Mirrors TerminalSettings in src/main/terminalSettings.ts. */
interface HvTerminalSettings {
  style: "workshop" | "paper" | "carbon";
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
  minimumContrastRatio: number;
  shellPath: string | null;
  shellArgs: string[];
  env: Record<string, string>;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickPastes: boolean;
  warnMultilinePaste: boolean;
  confirmCloseRunning: boolean;
  bell: "off" | "visual" | "sound";
  wordSeparator: string;
}
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
  // §7 round 12: `images` are data URLs rebuilt from the session file's image
  // blocks; `imagesDropped` marks one that exceeded the restore payload budget.
  | {
      kind: "user" | "assistant";
      text: string;
      promptTemplate?: { typed: string };
      images?: string[];
      imagesDropped?: boolean;
      /** Round 15: epoch ms from the session file's own message timestamps. */
      ts?: number;
      /** Round 15: assistant only, on a turn's last bubble — how long it took. */
      turnMs?: number;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      result?: string;
      error?: boolean;
      images?: string[];
      imagesDropped?: boolean;
      /** §12/§19: what this delegation cost, re-derived by main from the child's
          own session files. Absent for non-delegation cards. */
      subagentCost?: HvLedgerTotal;
    }
  | { kind: "plan"; planPath: string; status?: string; done?: number; total?: number };

interface HvByokProvider {
  id: string;
  label: string;
  source: "env" | "stored" | null;
  /** One of the cards shown above the "More providers…" search (2026-08-29). */
  featured: boolean;
  /** Models this key unlocks, per Pi's registry — shown on a search row. */
  modelCount: number;
}

/** Mirrors OAUTH_PROVIDERS in src/main/providers.ts (separate tsconfig roots). */
interface HvOAuthProvider {
  id: string;
  label: string;
  /** Honest billing note, e.g. Claude Pro/Max extra usage. */
  caveat?: string;
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
  /** The sub-agent that made this call; absent for the session's own calls. */
  agent?: string;
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
  /** Round 15: the app's own one-shot model calls. Tokens only — see
      src/main/oneShotLog.ts for why there is deliberately no dollar figure. */
  oneShot: { count: number; failed: number; estTokens: number };
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
  /** Round 11: "forget" archives its sessions (restorable), "delete" removes them for good. */
  removeWorkspace(ws: string, mode: "forget" | "delete"): Promise<{ sessions: number }>;
  /** How many sessions removal would affect — for the confirm, before anything is written. */
  workspaceSessionCount(ws: string): Promise<number>;
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
  /** §26: `terminals` answers the two-named-outcomes confirm when this session
   *  started terminals that are still running. Omitted ⇒ keep (the safe way). */
  /** Round 15: `deleted` is true when the session had no content and was
      purged rather than merely ended — the renderer drops the row. */
  closeSession(sessionId: string, terminals?: "stop" | "keep"): Promise<{ deleted: boolean }>;
  deleteSession(sessionId: string, terminals?: "stop" | "keep"): Promise<void>;
  /** §26: the live agent terminals this session owns. Empty ⇒ no confirm. */
  sessionTerminals(sessionId: string): Promise<Array<{ id: string; title: string }>>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  promptSession(
    sessionId: string,
    msg: string,
    behavior?: "steer" | "followUp",
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    /** F3: workspace-relative paths of @file references — content injected main-side. */
    mentions?: string[],
    /** Round 11: paths of the files open in the editor — PATHS ONLY, no content. */
    openFiles?: string[]
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

  // ── §29 Git integration ──────────────────────────────────────────────────
  gitState(workspaceId: string): Promise<HvRepoState & { available: boolean }>;
  gitStatus(workspaceId: string): Promise<HvGitStatusPayload>;
  gitDiff(workspaceId: string, baseline: HvGitBaseline, opts?: { staged?: boolean; path?: string }): Promise<HvFileDiff[]>;
  gitHistory(workspaceId: string, limit: number): Promise<HvLogEntry[]>;
  gitShow(workspaceId: string, sha: string): Promise<HvFileDiff[]>;
  gitBranches(workspaceId: string): Promise<string[]>;
  gitDefaultBranch(workspaceId: string): Promise<string | null>;
  gitDeleteBranch(workspaceId: string, branch: string, force?: boolean): Promise<HvGitWrite & { unmerged?: boolean }>;
  gitCommit(workspaceId: string, message: string, opts: { stagedOnly: boolean; amend: boolean }): Promise<HvGitWrite & { sha?: string }>;
  gitStage(workspaceId: string, relPath: string, stage: boolean): Promise<HvGitWrite>;
  gitSwitch(workspaceId: string, branch: string, opts: { create: boolean; mode: "take" | "stash" }): Promise<HvGitWrite & { wouldConflict?: boolean }>;
  gitFetch(workspaceId: string): Promise<HvGitWrite>;
  gitSync(workspaceId: string): Promise<HvGitWrite & { nonFF?: boolean }>;
  gitPublish(workspaceId: string): Promise<HvGitWrite>;
  gitStash(workspaceId: string, action: "save" | "pop" | "drop", index?: number): Promise<HvGitWrite>;
  gitUndoHunk(workspaceId: string, patch: string, meta: { path: string }): Promise<HvGitWrite & { stale?: boolean }>;
  gitUndoFile(workspaceId: string, relPath: string): Promise<HvGitWrite>;
  gitDiscardUntracked(workspaceId: string, relPath: string): Promise<HvGitWrite>;
  gitInitPreview(workspaceId: string): Promise<{ refused: string | null; branch: string; gitignore: string }>;
  gitInit(workspaceId: string, gitignore: string): Promise<HvGitWrite>;
  gitDetectJunk(workspaceId: string): Promise<string[]>;
  gitAddGitignore(workspaceId: string, lines: string[]): Promise<{ ok: boolean }>;
  gitDraftMessage(workspaceId: string, stagedOnly: boolean): Promise<string | null>;
  /** §5a: asks the OS for git (macOS CLT prompt; elsewhere opens git-scm.com). */
  gitInstallPrompt(): Promise<{ ok: boolean }>;
  /**
   * §29 §7: the forge's prefilled PR form for this branch, or null when there is
   * no button to show — not a repo, no origin, an unrecognised host, sitting on
   * the default branch, or nothing pushed yet. `drafted` is false when the model
   * was unavailable and the commit list was used instead.
   */
  gitPrUrl(workspaceId: string, draft?: boolean): Promise<{ url: string; drafted: boolean } | null>;
  gitMessageModel(): Promise<{ provider: string; modelId: string } | null>;
  setGitMessageModel(m: { provider: string; modelId: string } | null): Promise<{ provider: string; modelId: string } | null>;
  onGitChanged(cb: (p: { workspaceId: string }) => void): () => void;

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
  onPiExit(cb: (info: { sessionId: string; code: number | null; intentional: boolean; stderr?: string }) => void): () => void;
  /** V2.A: provider/model config changed — refetch model lists/tiers. */
  onProvidersChanged(cb: () => void): () => void;
  onSessionsChanged(cb: (sessions: SessionMeta[]) => void): () => void;
  onSessionReloading(cb: (info: { sessionId: string; reason: string }) => void): () => void;
  onUiUnhandled(cb: (info: { sessionId: string; method?: string }) => void): () => void;
  // B3: providers & onboarding
  respondInput(id: string, value: string | null): void;
  getProviders(): Promise<{
    byok: HvByokProvider[];
    /** Sign-in providers. Owned by main (providers.ts) — never re-listed here. */
    oauth: HvOAuthProvider[];
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
  /**
   * §12: a child's task, a bounded transcript window and its final output,
   * fetched on demand. Costs NO model turn, so it is safe to call on expand.
   * Resolves ok:false rather than rejecting — inspection is scoped to the current
   * session's children, so a respawn can legitimately answer foreign_session.
   */
  subagentInspect(sessionId: string, asyncId: string): Promise<
    | { ok: true; reply: { asyncId?: string; task?: string; status?: string; finalOutput?: string;
                           messages?: Array<{ role: string; kind: "text" | "toolCall" | "toolResult"; text: string; name?: string; isError?: boolean }> } }
    | { ok: false; error: string; code?: string }
  >;
  /** Live status pushes for detached runs (currentTool, activityState, …). */
  onSubagentStatus(cb: (i: { sessionId: string; runId: string; status: Record<string, unknown>; cost?: HvLedgerTotal }) => void): () => void;
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
  builtinsGet(): Promise<{ plan: boolean; askUser: boolean; planAppend: string; terminal: boolean; intent: boolean; browser: boolean }>;
  builtinsSet(t: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean; intent?: boolean; browser?: boolean }): Promise<void>;
  /** Read-only display of a built-in tool's real, unmodified prompt (currently "plan" only). */
  builtinPrompt(name: string): Promise<{ text: string }>;

  /** Extended prompt-cache retention (PI_CACHE_RETENTION=long). Global, applied
      at the next spawn — live sessions keep the retention they started with. */
  getLongCache(): Promise<boolean>;
  /** Round 11: is the open-files list sent with prompts? Global, default on. */
  getOpenFilesContext(): Promise<boolean>;
  setOpenFilesContext(on: boolean): Promise<void>;
  setLongCache(on: boolean): Promise<void>;

  /** Round 8: keyboard-shortcut overrides (action id → canonical binding). */
  getShortcuts(): Promise<Record<string, string>>;
  setShortcuts(map: Record<string, string>): Promise<void>;

  // §26 Terminals (additive). No permission surface anywhere here: permissions
  // gate the agent, not the human. Part 2 is where the gate comes back.
  termCreate(workspaceId: string, cols?: number, rows?: number): Promise<HvTerminalInfo>;
  termInput(id: string, data: string): Promise<void>;
  termResize(id: string, cols: number, rows: number): Promise<void>;
  /** Closing a terminal tab kills its PTY — a terminal tab IS its terminal. */
  termClose(id: string): Promise<void>;
  /** §7 round 12: rename a terminal tab. "" returns it to following its process. */
  termRename(id: string, title: string): Promise<void>;
  termList(workspaceId?: string): Promise<HvTerminalInfo[]>;
  /** addon-serialize output from main's headless mirror: repaints after ⌘R. */
  termSnapshot(id: string): Promise<string | null>;
  /** §26 part 2: the rendered grid as plain text (the card's collapsed tail). */
  termText(id: string, lines?: number): Promise<string | null>;
  /** The foreground command, or null at an idle prompt. Drives the close confirm. */
  termForeground(id: string): Promise<string | null>;
  /** Raw PTY bytes. Goes straight to term.write() — never through React state. */
  onTermData(cb: (p: { id: string; data: string }) => void): () => void;
  onTermExit(cb: (p: { id: string; code: number }) => void): () => void;
  onTermTitle(cb: (p: { id: string; title: string }) => void): () => void;
  // §28 Embedded browser. Panes are owned by main (they outlive a reload); the
  // renderer measures a placeholder and main moves the composited view.
  browserCreate(workspaceId: string): Promise<HvBrowserInfo>;
  browserBounds(id: string, b: { x: number; y: number; width: number; height: number }): Promise<void>;
  /** Hiding is how the permission modal wins z-order over a composited view. */
  browserVisible(id: string, visible: boolean): Promise<void>;
  /** User-initiated: typing a URL IS consent (§28), so this never prompts. */
  browserNavigate(id: string, url: string): Promise<void>;
  /** The Allow button on a pane the egress gate refused. */
  browserAllowBlocked(id: string): Promise<void>;
  browserBack(id: string): Promise<void>;
  browserForward(id: string): Promise<void>;
  browserReload(id: string): Promise<void>;
  browserClose(id: string): Promise<void>;
  browserList(workspaceId?: string): Promise<HvBrowserInfo[]>;
  browserGet(id: string): Promise<HvBrowserInfo | null>;
  /** What makes the persistent partition reversible (All Tools → Browser). */
  browserClearData(): Promise<void>;
  /** §28 picker: resolves with the element the user clicked, or null if cancelled. */
  /** §28 r1: the element AND a still of the page, captured before the view hides. */
  browserPick(id: string): Promise<{
    element: { selector: string; outerHTML: string; label: string; rect?: { x: number; y: number; width: number; height: number } };
    imageBase64: string | null;
  } | null>;
  browserPickCancel(id: string): Promise<void>;
  onBrowserState(cb: (info: HvBrowserInfo) => void): () => void;
  onBrowserClosed(cb: (p: { id: string }) => void): () => void;
  getTerminalSettings(): Promise<HvTerminalSettings>;
  setTerminalSettings(s: Partial<HvTerminalSettings>): Promise<HvTerminalSettings>;
  /** §26: the centre-area tab layout, stored opaquely — the renderer validates
      and prunes it on restore (layoutPersist.ts). */
  getLayout(): Promise<Record<string, unknown>>;
  setLayout(l: Record<string, unknown>): Promise<void>;

  // ── §27 Voice input ──────────────────────────────────────────────
  voiceStatus(): Promise<HvVoiceStatus>;
  /** Starts the download and returns immediately — it must not block the app. */
  voiceDownload(): Promise<HvVoiceStatus>;
  voiceCancelDownload(): Promise<HvVoiceStatus>;
  voiceRemoveModel(): Promise<HvVoiceStatus>;
  getVoiceSettings(): Promise<HvVoiceSettings>;
  setVoiceSettings(s: Partial<HvVoiceSettings>): Promise<HvVoiceSettings>;
  /** §8.3: check this BEFORE getUserMedia. A denied mic on macOS still hands
      back a "live" track that produces nothing but zeros. */
  voiceMicStatus(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
  voiceAskMic(): Promise<boolean>;
  voiceOpenMicSettings(): Promise<void>;
  /** Int16 PCM at 16 kHz mono in, transcript out. Nothing is logged (§11). */
  voiceTranscribe(pcm: Int16Array): Promise<string>;
  onVoiceStatusChanged(cb: (s: HvVoiceStatus) => void): () => void;

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
  /** §25 round 12: enable this plugin's installed skills and prompts in place. */
  pluginEnableInstalled(
    plugin: string,
  ): Promise<{ ok: true; skills: number; commands: number } | { ok: false; error: string }>;

  // MCP server config (additive). Changes apply to new sessions.
  mcpGet(workspaceId?: string): Promise<{ global: McpFileLike; workspace: McpFileLike | null }>;
  mcpSetServer(
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
    cfg: Record<string, unknown> | null,
  ): Promise<McpFileLike>;
  mcpStatus(): Promise<McpServerStatusLike[]>;
  /** Sweeps REMOTE servers (credential read + probe). Latched once per app run unless forced. */
  mcpSweepRemote(force?: boolean): Promise<McpServerStatusLike[]>;
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
