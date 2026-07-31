import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("hv", {
  // WS8: absolute OS path of a dragged File (Electron ≥32; replaces File.path).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getApiKey: () => ipcRenderer.invoke("hv:get-api-key"),
  setApiKey: (k: string) => ipcRenderer.invoke("hv:set-api-key", k),
  pickFolder: () => ipcRenderer.invoke("hv:pick-folder"),
  getStats: (sessionId?: string) => ipcRenderer.invoke("hv:get-stats", sessionId),
  getSessionCalls: (sessionId: string) => ipcRenderer.invoke("hv:get-session-calls", sessionId),
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
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    mentions?: string[]
  ) => ipcRenderer.invoke("hv:prompt-session", sessionId, msg, behavior, images, mentions),
  abortSession: (sessionId: string) => ipcRenderer.invoke("hv:abort-session", sessionId),

  // ── W2.1: per-session model override + image attach (additive) ──
  setSessionModel: (sessionId: string, m: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:set-session-model", sessionId, m),
  pickImage: () => ipcRenderer.invoke("hv:pick-image"),

  // ── W2.2: file tree + editor + card path actions (additive) ─────
  fsList: (workspaceId: string, relDir: string) => ipcRenderer.invoke("hv:fs-list", workspaceId, relDir),
  fsListRecursive: (workspaceId: string) => ipcRenderer.invoke("hv:fs-list-recursive", workspaceId),
  fsRead: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-read", workspaceId, relPath),
  fsWrite: (workspaceId: string, relPath: string, content: string) =>
    ipcRenderer.invoke("hv:fs-write", workspaceId, relPath, content),
  fsMtime: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-mtime", workspaceId, relPath),
  revealPath: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:reveal-path", workspaceId, relPath),
  fsStat: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-stat", workspaceId, relPath),
  fsTrash: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-trash", workspaceId, relPath),
  fsCreateFile: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-create-file", workspaceId, relPath),
  fsCreateDir: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:fs-create-dir", workspaceId, relPath),
  fsMove: (workspaceId: string, srcRel: string, destDirRel: string) => ipcRenderer.invoke("hv:fs-move", workspaceId, srcRel, destDirRel),
  fsImport: (workspaceId: string, destDirRel: string, srcAbsPaths: string[]) => ipcRenderer.invoke("hv:fs-import", workspaceId, destDirRel, srcAbsPaths),
  watchWorkspace: (workspaceId: string) => ipcRenderer.invoke("hv:watch-workspace", workspaceId),
  unwatchWorkspace: (workspaceId: string) => ipcRenderer.invoke("hv:unwatch-workspace", workspaceId),
  onFsChanged: (cb: (p: { workspaceId: string; relDirs: string[] }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { workspaceId: string; relDirs: string[] });
    ipcRenderer.on("hv:fs-changed", h);
    return () => ipcRenderer.removeListener("hv:fs-changed", h);
  },

  // ── §23 Plan Mode (additive) ────────────────────────────────────
  // Enter/leave plan mode; implement / discard / status are human-only
  // transitions (the model has no way to invoke them). hv.plan mode notifies
  // arrive through onUiRequest; live checklist progress via onPlanChanged.
  planSet: (sessionId: string, enabled: boolean) => ipcRenderer.invoke("hv:plan-set", sessionId, enabled),
  planImplement: (sessionId: string, relPath: string, model?: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:plan-implement", sessionId, relPath, model ?? null),
  planDiscard: (sessionId: string) => ipcRenderer.invoke("hv:plan-discard", sessionId),
  planStatus: (sessionId: string, relPath: string, status: string) =>
    ipcRenderer.invoke("hv:plan-status", sessionId, relPath, status),
  planRevert: (sessionId: string) => ipcRenderer.invoke("hv:plan-revert", sessionId),
  onPlanChanged: (
    cb: (p: { workspaceId: string; path: string; status: string; done: number; total: number }) => void,
  ): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { workspaceId: string; path: string; status: string; done: number; total: number });
    ipcRenderer.on("hv:plan-changed", h);
    return () => ipcRenderer.removeListener("hv:plan-changed", h);
  },

  // ── B2: AGENTS.md (additive) ────────────────────────────────────
  readAgentsMd: (workspaceId: string) => ipcRenderer.invoke("hv:read-agents-md", workspaceId),
  writeAgentsMd: (workspaceId: string, content: string) =>
    ipcRenderer.invoke("hv:write-agents-md", workspaceId, content),
  writeAgentsMdFiles: (workspaceId: string, files: Record<string, string>) =>
    ipcRenderer.invoke("hv:write-agents-md-files", workspaceId, files),
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
  getCustomEndpoints: () => ipcRenderer.invoke("hv:get-custom-endpoints"),
  saveCustomEndpoint: (endpoint: unknown, key?: string) =>
    ipcRenderer.invoke("hv:save-custom-endpoint", endpoint, key),
  removeCustomEndpoint: (id: string) => ipcRenderer.invoke("hv:remove-custom-endpoint", id),
  fetchEndpointModels: (baseUrl: string, key?: string) =>
    ipcRenderer.invoke("hv:fetch-endpoint-models", baseUrl, key),
  listModels: () => ipcRenderer.invoke("hv:list-models"),
  setDefaultModel: (provider: string, modelId: string) => ipcRenderer.invoke("hv:set-default-model", provider, modelId),
  hasAnyProvider: () => ipcRenderer.invoke("hv:has-any-provider"),
  openExternal: (url: string) => ipcRenderer.invoke("hv:open-external", url),

  // ── B4: permissions v1 (additive) ───────────────────────────────
  getRules: () => ipcRenderer.invoke("hv:get-rules"),
  setRules: (rules: unknown) => ipcRenderer.invoke("hv:set-rules", rules),
  addPermissionRule: (workspace: string | null, tool: string) =>
    ipcRenderer.invoke("hv:add-permission-rule", workspace, tool),
  getGlobalBypass: () => ipcRenderer.invoke("hv:get-global-bypass"),
  setGlobalBypass: (on: boolean) => ipcRenderer.invoke("hv:set-global-bypass", on),
  getWorkspaceBypass: (workspace: string) => ipcRenderer.invoke("hv:get-workspace-bypass", workspace),
  setWorkspaceBypass: (workspace: string, on: boolean | null) =>
    ipcRenderer.invoke("hv:set-workspace-bypass", workspace, on),
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

  // §9 rewind file rollback (human-only; no model-reachable path).
  rewindPreview: (sessionId: string, toolCallIds: string[]) =>
    ipcRenderer.invoke("hv:rewind-preview", sessionId, toolCallIds),
  rewindRestore: (sessionId: string, toolCallIds: string[]) =>
    ipcRenderer.invoke("hv:rewind-restore", sessionId, toolCallIds),

  // ── B6: agents & tools (additive) ────────────────────────────────
  // list* fire /hv-agents / /hv-tools; results arrive as hv.agents / hv.tools
  // notifies through onUiRequest (parsed by the renderer).
  listAgents: (sessionId?: string) => ipcRenderer.invoke("hv:list-agents", sessionId),
  listTools: (sessionId?: string) => ipcRenderer.invoke("hv:list-tools", sessionId),
  // Async subagents: stop button + live status. Lifecycle (started/complete/
  // control/active) arrives as hv.subagent notifies through onUiRequest.
  subagentInterrupt: (sessionId: string, runId: string) => ipcRenderer.invoke("hv:subagent-interrupt", sessionId, runId),
  onSubagentStatus: (cb: (i: { sessionId: string; runId: string; status: Record<string, unknown> }) => void): (() => void) => {
    const listener = (_e: unknown, i: { sessionId: string; runId: string; status: Record<string, unknown> }): void => cb(i);
    ipcRenderer.on("hv:subagent-status", listener);
    return () => ipcRenderer.removeListener("hv:subagent-status", listener);
  },
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

  // ── §13 round 6: configurable built-in custom tools (additive) ────
  builtinsGet: () => ipcRenderer.invoke("hv:builtins-get"),
  builtinsSet: (t: { plan?: boolean; askUser?: boolean; planAppend?: string }) =>
    ipcRenderer.invoke("hv:builtins-set", t),
  builtinPrompt: (name: string) => ipcRenderer.invoke("hv:builtin-prompt", name),

  // Extended prompt-cache retention (PI_CACHE_RETENTION=long) — next spawn.
  getLongCache: () => ipcRenderer.invoke("hv:get-long-cache"),
  setLongCache: (on: boolean) => ipcRenderer.invoke("hv:set-long-cache", on),

  // ── §14 Skills (additive) ────────────────────────────────────────
  // list returns {global, workspace}; approve/enable/activate apply live via
  // respawn-resume. Invocation cards arrive as hv.skill notifies through
  // onUiRequest; on-disk / config changes push hv:skills-changed.
  skillsList: (workspaceId?: string) => ipcRenderer.invoke("hv:skills-list", workspaceId),
  skillsRead: (id: string) => ipcRenderer.invoke("hv:skills-read", id),
  skillsApprove: (id: string) => ipcRenderer.invoke("hv:skills-approve", id),
  skillsSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("hv:skills-set-enabled", id, enabled),
  skillsSetActive: (workspaceId: string, id: string, on: boolean | null) =>
    ipcRenderer.invoke("hv:skills-set-active", workspaceId, id, on),
  skillsGetLinked: () => ipcRenderer.invoke("hv:skills-get-linked"),
  skillsSetLinked: (dirs: string[]) => ipcRenderer.invoke("hv:skills-set-linked", dirs),
  skillsAddLinked: () => ipcRenderer.invoke("hv:skills-add-linked"),
  skillsImportLocal: () => ipcRenderer.invoke("hv:skills-import-local"),
  skillsImportGit: (url: string) => ipcRenderer.invoke("hv:skills-import-git", url),
  skillsImportSelect: (token: string, ids: string[], scope: "global" | "workspace", workspaceId: string | null) =>
    ipcRenderer.invoke("hv:skills-import-select", token, ids, scope, workspaceId),
  skillsNewSkill: (sessionId: string) => ipcRenderer.invoke("hv:skills-new-skill", sessionId),
  skillsPromote: (id: string) => ipcRenderer.invoke("hv:skills-promote", id),
  skillsDelete: (skillId: string, workspaceId: string | null) => ipcRenderer.invoke("hv:skills-delete", skillId, workspaceId),
  skillsSession: (sessionId: string) => ipcRenderer.invoke("hv:skills-session", sessionId),
  listCommands: (sessionId: string) => ipcRenderer.invoke("hv:list-commands", sessionId),
  onSkillsChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("hv:skills-changed", listener);
    return () => ipcRenderer.removeListener("hv:skills-changed", listener);
  },

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
  // §13 round 8: curated catalog — install by KEY (main owns the catalog and the
  // secrets, so a renderer bug cannot write an arbitrary server), plus the
  // node/npx preflight that badges stdio entries before the click.
  mcpInstallCatalog: (
    catalogKey: string,
    scope: "global" | "workspace",
    workspaceId: string | null,
    values: Record<string, string>,
  ) =>
    ipcRenderer.invoke("hv:mcp-install-catalog", catalogKey, scope, workspaceId, values) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  nodeAvailable: () => ipcRenderer.invoke("hv:node-available") as Promise<boolean>,
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
