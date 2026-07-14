import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hv", {
  getApiKey: () => ipcRenderer.invoke("hv:get-api-key"),
  setApiKey: (k: string) => ipcRenderer.invoke("hv:set-api-key", k),
  pickFolder: () => ipcRenderer.invoke("hv:pick-folder"),
  getStats: (sessionId?: string) => ipcRenderer.invoke("hv:get-stats", sessionId),
  respondPermission: (id: string, choice: string) => ipcRenderer.send("hv:respond-permission", id, choice),

  // ── B1: workspaces & multi-session ─────────────────────────────
  listWorkspaces: () => ipcRenderer.invoke("hv:list-workspaces"),
  addWorkspace: () => ipcRenderer.invoke("hv:add-workspace"),
  removeWorkspace: (ws: string) => ipcRenderer.invoke("hv:remove-workspace", ws),
  listSessions: () => ipcRenderer.invoke("hv:list-sessions"),
  createSession: (workspaceId: string) => ipcRenderer.invoke("hv:create-session", workspaceId),
  openSession: (sessionId: string) => ipcRenderer.invoke("hv:open-session", sessionId),
  closeSession: (sessionId: string) => ipcRenderer.invoke("hv:close-session", sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke("hv:delete-session", sessionId),
  renameSession: (sessionId: string, title: string) => ipcRenderer.invoke("hv:rename-session", sessionId, title),
  archiveSession: (sessionId: string, archived: boolean) =>
    ipcRenderer.invoke("hv:archive-session", sessionId, archived),
  promptSession: (
    sessionId: string,
    msg: string,
    behavior?: "steer" | "followUp",
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ) => ipcRenderer.invoke("hv:prompt-session", sessionId, msg, behavior, images),
  abortSession: (sessionId: string) => ipcRenderer.invoke("hv:abort-session", sessionId),

  // ── W2.1: per-session model override + image attach (additive) ──
  setSessionModel: (sessionId: string, m: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:set-session-model", sessionId, m),
  pickImage: () => ipcRenderer.invoke("hv:pick-image"),

  // ── W2.2: file tree + editor + card path actions (additive) ─────
  fsList: (workspaceId: string, relDir: string) => ipcRenderer.invoke("hv:fs-list", workspaceId, relDir),
  fsRead: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-read", workspaceId, relPath),
  fsWrite: (workspaceId: string, relPath: string, content: string) =>
    ipcRenderer.invoke("hv:fs-write", workspaceId, relPath, content),
  fsMtime: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-mtime", workspaceId, relPath),
  revealPath: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:reveal-path", workspaceId, relPath),

  // ── B2: AGENTS.md (additive) ────────────────────────────────────
  readAgentsMd: (workspaceId: string) => ipcRenderer.invoke("hv:read-agents-md", workspaceId),
  writeAgentsMd: (workspaceId: string, content: string) =>
    ipcRenderer.invoke("hv:write-agents-md", workspaceId, content),
  proposeAgentsMd: (workspaceId: string) => ipcRenderer.invoke("hv:propose-agents-md", workspaceId),
  // W2.3 missing-file flow (additive)
  hasClaudeMd: (workspaceId: string) => ipcRenderer.invoke("hv:has-claude-md", workspaceId),
  copyClaudeMd: (workspaceId: string) => ipcRenderer.invoke("hv:copy-claude-md", workspaceId),

  // ── B3: providers & onboarding (additive; existing signatures unchanged) ──
  respondInput: (id: string, value: string | null) => ipcRenderer.send("hv:respond-input", id, value),
  getProviders: () => ipcRenderer.invoke("hv:get-providers"),
  setProviderKey: (provider: string, key: string) => ipcRenderer.invoke("hv:set-provider-key", provider, key),
  removeProviderKey: (provider: string) => ipcRenderer.invoke("hv:remove-provider-key", provider),
  authLogin: (provider: string) => ipcRenderer.invoke("hv:auth-login", provider),
  authLoginCancel: (provider: string) => ipcRenderer.invoke("hv:auth-login-cancel", provider),
  authLogout: (provider: string) => ipcRenderer.invoke("hv:auth-logout", provider),
  authStatus: () => ipcRenderer.invoke("hv:auth-status"),
  detectOllama: () => ipcRenderer.invoke("hv:detect-ollama"),
  listModels: () => ipcRenderer.invoke("hv:list-models"),
  setDefaultModel: (provider: string, modelId: string) => ipcRenderer.invoke("hv:set-default-model", provider, modelId),
  hasAnyProvider: () => ipcRenderer.invoke("hv:has-any-provider"),
  openExternal: (url: string) => ipcRenderer.invoke("hv:open-external", url),

  // ── B4: permissions v1 (additive) ───────────────────────────────
  getRules: () => ipcRenderer.invoke("hv:get-rules"),
  setRules: (rules: unknown) => ipcRenderer.invoke("hv:set-rules", rules),
  addPermissionRule: (workspace: string | null, tool: string) =>
    ipcRenderer.invoke("hv:add-permission-rule", workspace, tool),
  evalRules: (workspaceId: string, tool: string, input: Record<string, unknown>) =>
    ipcRenderer.invoke("hv:eval-rules", workspaceId, tool, input),
  readAudit: (filter?: { sessionId?: string; workspaceId?: string }) => ipcRenderer.invoke("hv:read-audit", filter),
  setBadgeCount: (n: number) => ipcRenderer.send("hv:set-badge-count", n),

  // ── B7: local analytics + onboarding (additive) ──────────────────
  getAnalytics: (filter?: { workspaceId?: string; sinceTs?: string }) =>
    ipcRenderer.invoke("hv:get-analytics", filter),
  getOnboardingSeen: () => ipcRenderer.invoke("hv:get-onboarding-seen"),
  setOnboardingSeen: (seen: boolean) => ipcRenderer.invoke("hv:set-onboarding-seen", seen),

  // ── B5: context visibility (additive) ────────────────────────────
  // Snapshot/remove/restore fire /hv-context* commands; results arrive as
  // hv.context notifies through onUiRequest (parsed by the renderer).
  contextSnapshot: (sessionId: string) => ipcRenderer.invoke("hv:context-snapshot", sessionId),
  contextRemove: (sessionId: string, keys: string[]) => ipcRenderer.invoke("hv:context-remove", sessionId, keys),
  contextRestore: (sessionId: string, keys: string[]) => ipcRenderer.invoke("hv:context-restore", sessionId, keys),
  compactSession: (sessionId: string) => ipcRenderer.invoke("hv:compact-session", sessionId),

  // ── B6: agents & tools (additive) ────────────────────────────────
  // list* fire /hv-agents / /hv-tools; results arrive as hv.agents / hv.tools
  // notifies through onUiRequest (parsed by the renderer).
  listAgents: (sessionId?: string) => ipcRenderer.invoke("hv:list-agents", sessionId),
  listTools: (sessionId?: string) => ipcRenderer.invoke("hv:list-tools", sessionId),
  readAgent: (filePath: string) => ipcRenderer.invoke("hv:read-agent", filePath),
  writeAgent: (filePath: string, edit: { body?: string; model?: string | null }) =>
    ipcRenderer.invoke("hv:write-agent", filePath, edit),
  duplicateAgent: (filePath: string) => ipcRenderer.invoke("hv:duplicate-agent", filePath),

  // ── W1.4: system prompt + workspace settings (additive) ──────────
  // sysPromptSnapshot fires /hv-sysprompt; the result arrives as an
  // hv.sysprompt notify through onUiRequest (parsed by the renderer).
  sysPromptSnapshot: (sessionId?: string) => ipcRenderer.invoke("hv:sysprompt-snapshot", sessionId),
  getGlobalAppend: () => ipcRenderer.invoke("hv:get-global-append"),
  setGlobalAppend: (content: string) => ipcRenderer.invoke("hv:set-global-append", content),
  getWorkspaceAppend: (workspaceId: string) => ipcRenderer.invoke("hv:get-workspace-append", workspaceId),
  setWorkspaceAppend: (workspaceId: string, content: string) =>
    ipcRenderer.invoke("hv:set-workspace-append", workspaceId, content),
  getWorkspaceModel: (workspaceId: string) => ipcRenderer.invoke("hv:get-workspace-model", workspaceId),
  setWorkspaceModel: (workspaceId: string, m: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:set-workspace-model", workspaceId, m),

  // ── MCP server config (additive). Changes apply to new sessions. ──
  mcpGet: (workspaceId?: string) => ipcRenderer.invoke("hv:mcp-get", workspaceId),
  mcpSetServer: (scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: unknown) =>
    ipcRenderer.invoke("hv:mcp-set-server", scope, workspaceId, name, cfg),
  mcpStatus: () => ipcRenderer.invoke("hv:mcp-status"),
  mcpCheck: (scope: "global" | "workspace", workspaceId: string | null, name?: string) =>
    ipcRenderer.invoke("hv:mcp-check", scope, workspaceId, name),
  mcpAuthenticate: (scope: "global" | "workspace", workspaceId: string | null, name: string) =>
    ipcRenderer.invoke("hv:mcp-authenticate", scope, workspaceId, name),
  mcpLogout: (name: string) => ipcRenderer.invoke("hv:mcp-logout", name),
  onMcpStatusChanged: (cb: (s: unknown[]) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, s: unknown): void => cb(s as unknown[]);
    ipcRenderer.on("hv:mcp-status-changed", h);
    return () => ipcRenderer.removeListener("hv:mcp-status-changed", h);
  },

  // Each on* returns an unsubscribe function. Without it, React StrictMode's
  // dev double-mount registers listeners twice and every stream delta renders
  // twice ("the the heading heading ...").
  onPiEvent: (cb: (e: Record<string, unknown>) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as Record<string, unknown>);
    ipcRenderer.on("hv:pi-event", listener);
    return () => ipcRenderer.removeListener("hv:pi-event", listener);
  },
  // V2.A: provider/model config changed (keys, OAuth, default/workspace model).
  onProvidersChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("hv:providers-changed", listener);
    return () => ipcRenderer.removeListener("hv:providers-changed", listener);
  },
  onUiRequest: (
    cb: (r: { id: string; sessionId?: string; method?: string; title?: string; message?: string; options?: string[] }) => void
  ): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void =>
      cb(p as { id: string; sessionId?: string; method?: string; title?: string; message?: string; options?: string[] });
    ipcRenderer.on("hv:ui-request", listener);
    return () => ipcRenderer.removeListener("hv:ui-request", listener);
  },
  onPiExit: (cb: (i: { sessionId: string; code: number | null; intentional: boolean }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void =>
      cb(p as { sessionId: string; code: number | null; intentional: boolean });
    ipcRenderer.on("hv:pi-exit", listener);
    return () => ipcRenderer.removeListener("hv:pi-exit", listener);
  },
  onSessionsChanged: (cb: (sessions: unknown[]) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as unknown[]);
    ipcRenderer.on("hv:sessions-changed", listener);
    return () => ipcRenderer.removeListener("hv:sessions-changed", listener);
  },
  onSessionReloading: (cb: (i: { sessionId: string; reason: string }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void =>
      cb(p as { sessionId: string; reason: string });
    ipcRenderer.on("hv:session-reloading", listener);
    return () => ipcRenderer.removeListener("hv:session-reloading", listener);
  },
});
