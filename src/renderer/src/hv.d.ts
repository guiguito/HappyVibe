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

interface SimpleMessage {
  role: "user" | "assistant";
  text: string;
}

interface HvByokProvider {
  id: string;
  label: string;
  source: "env" | "stored" | null;
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
  cost: number;
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

interface HvApi {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  getStats(sessionId?: string): Promise<unknown>;
  respondPermission(id: string, choice: string): void;

  listWorkspaces(): Promise<string[]>;
  addWorkspace(): Promise<string | null>;
  removeWorkspace(ws: string): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  createSession(workspaceId: string): Promise<SessionMeta>;
  openSession(sessionId: string): Promise<{ meta: SessionMeta; messages: SimpleMessage[] | null }>;
  closeSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  archiveSession(sessionId: string, archived: boolean): Promise<void>;
  promptSession(
    sessionId: string,
    msg: string,
    behavior?: "steer" | "followUp",
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  // W2.1: per-session model override + image attach
  setSessionModel(sessionId: string, m: { provider: string; modelId: string } | null): Promise<{ live: boolean }>;
  pickImage(): Promise<{ data: string; mimeType: string; name: string } | null>;

  // B2: AGENTS.md
  readAgentsMd(workspaceId: string): Promise<string | null>;
  writeAgentsMd(workspaceId: string, content: string): Promise<void>;
  proposeAgentsMd(workspaceId: string): Promise<string | null>;
  // W2.3 missing-file flow
  hasClaudeMd(workspaceId: string): Promise<boolean>;
  copyClaudeMd(workspaceId: string): Promise<string>;

  onPiEvent(cb: (e: Record<string, unknown>) => void): () => void;
  onUiRequest(
    cb: (r: { id: string; sessionId?: string; method?: string; title?: string; message?: string; options?: string[] }) => void
  ): () => void;
  onPiExit(cb: (info: { sessionId: string; code: number | null; intentional: boolean }) => void): () => void;
  onSessionsChanged(cb: (sessions: SessionMeta[]) => void): () => void;
  // B3: providers & onboarding
  respondInput(id: string, value: string | null): void;
  getProviders(): Promise<{ byok: HvByokProvider[]; defaultModel: { provider: string; modelId: string } | null }>;
  setProviderKey(provider: string, key: string): Promise<void>;
  removeProviderKey(provider: string): Promise<void>;
  authLogin(provider: string): Promise<void>;
  authLoginCancel(provider: string): Promise<void>;
  authLogout(provider: string): Promise<void>;
  authStatus(): Promise<void>;
  detectOllama(): Promise<{ running: boolean; models: string[] }>;
  listModels(): Promise<HvModel[]>;
  setDefaultModel(provider: string, modelId: string): Promise<void>;
  hasAnyProvider(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  // B4: permissions v1
  getRules(): Promise<HvRulesFile>;
  setRules(rules: HvRulesFile): Promise<HvRulesFile>;
  evalRules(workspaceId: string, tool: string, input: Record<string, unknown>): Promise<HvVerdict>;
  readAudit(filter?: { sessionId?: string; workspaceId?: string }): Promise<HvAuditEvent[]>;
  setBadgeCount(n: number): void;
  // B5: context visibility
  contextSnapshot(sessionId: string): Promise<void>;
  contextRemove(sessionId: string, keys: string[]): Promise<void>;
  contextRestore(sessionId: string, keys: string[]): Promise<void>;
  compactSession(sessionId: string): Promise<void>;
  // B6: agents & tools
  listAgents(sessionId?: string): Promise<void>;
  listTools(sessionId?: string): Promise<void>;
  readAgent(filePath: string): Promise<{ body: string; model?: string }>;
  writeAgent(filePath: string, edit: { body?: string; model?: string | null }): Promise<void>;
  duplicateAgent(filePath: string): Promise<string>;

  // W1.4: system prompt + workspace settings
  sysPromptSnapshot(sessionId?: string): Promise<void>;
  getGlobalAppend(): Promise<string | null>;
  setGlobalAppend(content: string): Promise<void>;
  getWorkspaceAppend(workspaceId: string): Promise<string | null>;
  setWorkspaceAppend(workspaceId: string, content: string): Promise<void>;
  getWorkspaceModel(workspaceId: string): Promise<{ provider: string; modelId: string } | null>;
  setWorkspaceModel(workspaceId: string, m: { provider: string; modelId: string } | null): Promise<void>;

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
