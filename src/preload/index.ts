import { contextBridge, ipcRenderer, webUtils } from "electron";

/** §27. Structural mirrors of src/main/voice — preload sits in the NODE
    tsconfig, which does not see the renderer's hv.d.ts globals. */
interface VoiceStatusDTO {
  state: "unactivated" | "downloading" | "ready" | "error";
  bytesDone: number;
  bytesTotal: number;
  error?: string;
  sizeOnDisk: number;
}
interface VoiceSettingsDTO {
  /** Round 2: functional activation, separate from model readiness. */
  enabled: boolean;
  /** Round 2: whether the chip takes space in the composer row. */
  showInComposer: boolean;
  language: string;
  inputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  holdThresholdMs: number;
  maxRecordingMs: number;
}

contextBridge.exposeInMainWorld("hv", {
  // WS8: absolute OS path of a dragged File (Electron ≥32; replaces File.path).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  getStats: (sessionId?: string) => ipcRenderer.invoke("hv:get-stats", sessionId),
  getSessionCalls: (sessionId: string) => ipcRenderer.invoke("hv:get-session-calls", sessionId),
  respondPermission: (id: string, choice: string) => ipcRenderer.send("hv:respond-permission", id, choice),

  // ── B1: workspaces & multi-session ─────────────────────────────
  listWorkspaces: () => ipcRenderer.invoke("hv:list-workspaces"),
  addWorkspace: () => ipcRenderer.invoke("hv:add-workspace"),
  createWorkspaceFolder: (name: string) => ipcRenderer.invoke("hv:create-workspace-folder", name),
  // Round 11: "forget" archives its sessions, "delete" removes them permanently.
  removeWorkspace: (ws: string, mode: "forget" | "delete") =>
    ipcRenderer.invoke("hv:remove-workspace", ws, mode),
  workspaceSessionCount: (ws: string) => ipcRenderer.invoke("hv:workspace-session-count", ws),
  listSessions: () => ipcRenderer.invoke("hv:list-sessions"),
  createSession: (workspaceId: string) => ipcRenderer.invoke("hv:create-session", workspaceId),
  openSession: (sessionId: string) => ipcRenderer.invoke("hv:open-session", sessionId),
  loadEarlier: (sessionId: string) => ipcRenderer.invoke("hv:load-earlier", sessionId),
  closeSession: (sessionId: string, terminals?: "stop" | "keep") =>
    ipcRenderer.invoke("hv:close-session", sessionId, terminals),
  deleteSession: (sessionId: string, terminals?: "stop" | "keep") =>
    ipcRenderer.invoke("hv:delete-session", sessionId, terminals),
  sessionTerminals: (sessionId: string) => ipcRenderer.invoke("hv:session-terminals", sessionId),
  renameSession: (sessionId: string, title: string) => ipcRenderer.invoke("hv:rename-session", sessionId, title),
  archiveSession: (sessionId: string, archived: boolean) =>
    ipcRenderer.invoke("hv:archive-session", sessionId, archived),
  promptSession: (
    sessionId: string,
    msg: string,
    behavior?: "steer" | "followUp",
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    mentions?: string[],
    // Round 11: workspace-relative paths of the files open in the editor.
    openFiles?: string[],
    // §31: absolute paths of attached documents — main converts and injects them.
    documents?: string[]
  ) => ipcRenderer.invoke("hv:prompt-session", sessionId, msg, behavior, images, mentions, openFiles, documents),
  abortSession: (sessionId: string) => ipcRenderer.invoke("hv:abort-session", sessionId),

  // ── W2.1: per-session model override + image attach (additive) ──
  setSessionModel: (sessionId: string, m: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:set-session-model", sessionId, m),
  pickImage: () => ipcRenderer.invoke("hv:pick-image"),
  // §31: the picker converts at pick time, so the chip can show the cost.
  pickDocument: () => ipcRenderer.invoke("hv:pick-document"),
  describeDocument: (absPath: string, sessionId?: string) =>
    ipcRenderer.invoke("hv:describe-document", absPath, sessionId),
  revealDocument: (absPath: string) => ipcRenderer.invoke("hv:reveal-document", absPath),
  documentsAvailable: () => ipcRenderer.invoke("hv:documents-available"),

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

  // ── §29 Git integration ─────────────────────────────────────────
  // Reads are plain invokes; every WRITE returns either its own result or
  // `{ ok:false, busy:[titles] }` from main's idle gate — the renderer never
  // decides whether an action is safe.
  gitState: (workspaceId: string) => ipcRenderer.invoke("hv:git-state", workspaceId),
  gitStatus: (workspaceId: string) => ipcRenderer.invoke("hv:git-status", workspaceId),
  gitDiff: (workspaceId: string, baseline: "head" | "base", opts?: { staged?: boolean; path?: string }) =>
    ipcRenderer.invoke("hv:git-diff", workspaceId, baseline, opts),
  gitHistory: (workspaceId: string, limit: number) => ipcRenderer.invoke("hv:git-history", workspaceId, limit),
  gitShow: (workspaceId: string, sha: string) => ipcRenderer.invoke("hv:git-show", workspaceId, sha),
  gitBranches: (workspaceId: string) => ipcRenderer.invoke("hv:git-branches", workspaceId),
  gitDefaultBranch: (workspaceId: string) => ipcRenderer.invoke("hv:git-default-branch", workspaceId),
  gitDeleteBranch: (workspaceId: string, branch: string, force?: boolean) =>
    ipcRenderer.invoke("hv:git-delete-branch", workspaceId, branch, force),
  gitCommit: (workspaceId: string, message: string, opts: { stagedOnly: boolean; amend: boolean }) =>
    ipcRenderer.invoke("hv:git-commit", workspaceId, message, opts),
  gitStage: (workspaceId: string, relPath: string, stage: boolean) =>
    ipcRenderer.invoke("hv:git-stage", workspaceId, relPath, stage),
  gitSwitch: (workspaceId: string, branch: string, opts: { create: boolean; mode: "take" | "stash" }) =>
    ipcRenderer.invoke("hv:git-switch", workspaceId, branch, opts),
  gitFetch: (workspaceId: string) => ipcRenderer.invoke("hv:git-fetch", workspaceId),
  gitSync: (workspaceId: string) => ipcRenderer.invoke("hv:git-sync", workspaceId),
  gitPublish: (workspaceId: string) => ipcRenderer.invoke("hv:git-publish", workspaceId),
  gitStash: (workspaceId: string, action: "save" | "pop" | "drop", index?: number) =>
    ipcRenderer.invoke("hv:git-stash", workspaceId, action, index),
  gitUndoHunk: (workspaceId: string, patch: string, meta: { path: string }) =>
    ipcRenderer.invoke("hv:git-undo-hunk", workspaceId, patch, meta),
  gitUndoFile: (workspaceId: string, relPath: string) => ipcRenderer.invoke("hv:git-undo-file", workspaceId, relPath),
  gitDiscardUntracked: (workspaceId: string, relPath: string) =>
    ipcRenderer.invoke("hv:git-discard-untracked", workspaceId, relPath),
  gitInitPreview: (workspaceId: string) => ipcRenderer.invoke("hv:git-init-preview", workspaceId),
  gitInit: (workspaceId: string, gitignore: string) => ipcRenderer.invoke("hv:git-init", workspaceId, gitignore),
  gitDetectJunk: (workspaceId: string) => ipcRenderer.invoke("hv:git-detect-junk", workspaceId),
  gitAddGitignore: (workspaceId: string, lines: string[]) => ipcRenderer.invoke("hv:git-add-gitignore", workspaceId, lines),
  gitDraftMessage: (workspaceId: string, stagedOnly: boolean) =>
    ipcRenderer.invoke("hv:git-draft-message", workspaceId, stagedOnly),
  gitInstallPrompt: () => ipcRenderer.invoke("hv:git-install-prompt"),
  gitPrUrl: (workspaceId: string, draft?: boolean) => ipcRenderer.invoke("hv:git-pr-url", workspaceId, draft),
  onGitChanged: (cb: (p: { workspaceId: string }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { workspaceId: string });
    ipcRenderer.on("hv:git-changed", h);
    return () => ipcRenderer.removeListener("hv:git-changed", h);
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
  // Round 11: the status main already holds, so a page mounting after a sign-in
  // does not depend on a notify that already fired.
  authState: () => ipcRenderer.invoke("hv:auth-state"),
  onAuthStateChanged: (cb: (s: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, s: unknown): void => cb(s);
    ipcRenderer.on("hv:auth-state-changed", h);
    return () => ipcRenderer.removeListener("hv:auth-state-changed", h);
  },
  detectOllama: () => ipcRenderer.invoke("hv:detect-ollama"),
  detectLocalRunners: () => ipcRenderer.invoke("hv:detect-local-runners"),
  getCustomEndpoints: () => ipcRenderer.invoke("hv:get-custom-endpoints"),
  saveCustomEndpoint: (endpoint: unknown, key?: string) =>
    ipcRenderer.invoke("hv:save-custom-endpoint", endpoint, key),
  removeCustomEndpoint: (id: string) => ipcRenderer.invoke("hv:remove-custom-endpoint", id),
  fetchEndpointModels: (baseUrl: string, key?: string) =>
    ipcRenderer.invoke("hv:fetch-endpoint-models", baseUrl, key),
  listModels: () => ipcRenderer.invoke("hv:list-models"),
  setDefaultModel: (provider: string, modelId: string) => ipcRenderer.invoke("hv:set-default-model", provider, modelId),
  // §16 round 16: thinking effort — global default + per-session override.
  setSessionThinking: (sessionId: string, level: string | null) =>
    ipcRenderer.invoke("hv:set-session-thinking", sessionId, level),
  setDefaultThinking: (level: string | null) => ipcRenderer.invoke("hv:set-default-thinking", level),
  getDefaultThinking: () => ipcRenderer.invoke("hv:get-default-thinking"),
  getThinkingLevels: (sessionId?: string) => ipcRenderer.invoke("hv:get-thinking-levels", sessionId),
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
  // §30: the changelog dot's flag.

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
  subagentStopChild: (sessionId: string, runId: string, childId: string) => ipcRenderer.invoke("hv:subagent-stop-child", sessionId, runId, childId),
  subagentThinking: (transcriptPath: string) => ipcRenderer.invoke("hv:subagent-thinking", transcriptPath),
  // §12: pull a child's transcript on demand (no model turn).
  subagentInspect: (sessionId: string, asyncId: string) => ipcRenderer.invoke("hv:subagent-inspect", sessionId, asyncId),
  onSubagentStatus: (cb: (i: { sessionId: string; runId: string; status: Record<string, unknown>; cost?: Record<string, number> }) => void): (() => void) => {
    const listener = (_e: unknown, i: { sessionId: string; runId: string; status: Record<string, unknown>; cost?: Record<string, number> }): void => cb(i);
    ipcRenderer.on("hv:subagent-status", listener);
    return () => ipcRenderer.removeListener("hv:subagent-status", listener);
  },
  readAgent: (filePath: string) => ipcRenderer.invoke("hv:read-agent", filePath),
  writeAgent: (filePath: string, edit: { body?: string; model?: string | null }) =>
    ipcRenderer.invoke("hv:write-agent", filePath, edit),
  duplicateAgent: (filePath: string) => ipcRenderer.invoke("hv:duplicate-agent", filePath),
  setAgentEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke("hv:set-agent-enabled", name, enabled),

  // ── W1.4: system prompt + workspace settings (additive) ──────────
  // sysPromptSnapshot fires /hv-sysprompt; the result arrives as an
  // hv.sysprompt notify through onUiRequest (parsed by the renderer).
  sysPromptSnapshot: (sessionId?: string) => ipcRenderer.invoke("hv:sysprompt-snapshot", sessionId),
  getGlobalAppend: () => ipcRenderer.invoke("hv:get-global-append"),
  setGlobalAppend: (content: string) => ipcRenderer.invoke("hv:set-global-append", content),
  getWorkspaceModel: (workspaceId: string) => ipcRenderer.invoke("hv:get-workspace-model", workspaceId),
  setWorkspaceModel: (workspaceId: string, m: { provider: string; modelId: string } | null) =>
    ipcRenderer.invoke("hv:set-workspace-model", workspaceId, m),

  // ── §13 round 6: configurable built-in custom tools (additive) ────
  builtinsGet: () => ipcRenderer.invoke("hv:builtins-get"),
  builtinsSet: (t: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean; intent?: boolean; browser?: boolean; web?: boolean }) =>
    ipcRenderer.invoke("hv:builtins-set", t),
  builtinPrompt: (name: string) => ipcRenderer.invoke("hv:builtin-prompt", name),
  // ── §32: the web service the web tools call (read per call, no respawn) ────
  webServiceGet: () => ipcRenderer.invoke("hv:web-service-get"),
  webServiceSet: (p: { mode: "default" | "custom"; baseUrl?: string; key?: string | null }) =>
    ipcRenderer.invoke("hv:web-service-set", p),
  webServiceTest: (p: { baseUrl?: string; key?: string }) => ipcRenderer.invoke("hv:web-service-test", p),
  // §19: the three model calls the app makes without a session.
  assistantTasksGet: () => ipcRenderer.invoke("hv:assistant-tasks-get"),
  assistantTaskSet: (id: string, patch: unknown) => ipcRenderer.invoke("hv:assistant-task-set", id, patch),
  assistantTaskPrompt: (id: string) => ipcRenderer.invoke("hv:assistant-task-prompt", id),

  // Extended prompt-cache retention (PI_CACHE_RETENTION=long) — next spawn.
  getLongCache: () => ipcRenderer.invoke("hv:get-long-cache"),
  getOpenFilesContext: () => ipcRenderer.invoke("hv:get-open-files-context"),
  setOpenFilesContext: (on: boolean) => ipcRenderer.invoke("hv:set-open-files-context", on),
  setLongCache: (on: boolean) => ipcRenderer.invoke("hv:set-long-cache", on),
  getShortcuts: () => ipcRenderer.invoke("hv:get-shortcuts"),
  setShortcuts: (map: Record<string, string>) => ipcRenderer.invoke("hv:set-shortcuts", map),

  // ── §26 Terminals (additive) ─────────────────────────────────────
  // PTYs live in main; this is the whole surface a view needs. termData is a
  // raw byte stream and goes straight into xterm — never through React state.
  termCreate: (workspaceId: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke("hv:term-create", workspaceId, cols, rows),
  termInput: (id: string, data: string) => ipcRenderer.invoke("hv:term-input", id, data),
  termResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke("hv:term-resize", id, cols, rows),
  termClose: (id: string) => ipcRenderer.invoke("hv:term-close", id),
  termRename: (id: string, title: string) => ipcRenderer.invoke("hv:term-rename", id, title),
  termList: (workspaceId?: string) => ipcRenderer.invoke("hv:term-list", workspaceId),
  /** addon-serialize output: what repaints a tab after a reload. */
  termSnapshot: (id: string) => ipcRenderer.invoke("hv:term-snapshot", id),
  termText: (id: string, lines?: number) => ipcRenderer.invoke("hv:term-text", id, lines),
  /** The foreground command, or null at an idle prompt — the close confirm. */
  termForeground: (id: string) => ipcRenderer.invoke("hv:term-foreground", id),
  onTermData: (cb: (p: { id: string; data: string }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { id: string; data: string });
    ipcRenderer.on("hv:term-data", h);
    return () => ipcRenderer.removeListener("hv:term-data", h);
  },
  onTermExit: (cb: (p: { id: string; code: number }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { id: string; code: number });
    ipcRenderer.on("hv:term-exit", h);
    return () => ipcRenderer.removeListener("hv:term-exit", h);
  },
  onTermTitle: (cb: (p: { id: string; title: string }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { id: string; title: string });
    ipcRenderer.on("hv:term-title", h);
    return () => ipcRenderer.removeListener("hv:term-title", h);
  },
  // §28 Embedded browser. Bounds/visibility are the price of WebContentsView:
  // the view composites over the DOM, so the renderer measures and main moves.
  browserCreate: (workspaceId: string) => ipcRenderer.invoke("hv:browser-create", workspaceId),
  browserBounds: (id: string, b: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("hv:browser-bounds", id, b),
  browserVisible: (id: string, visible: boolean) => ipcRenderer.invoke("hv:browser-visible", id, visible),
  browserNavigate: (id: string, url: string) => ipcRenderer.invoke("hv:browser-navigate", id, url),
  browserAllowBlocked: (id: string) => ipcRenderer.invoke("hv:browser-allow-blocked", id),
  browserBack: (id: string) => ipcRenderer.invoke("hv:browser-back", id),
  browserForward: (id: string) => ipcRenderer.invoke("hv:browser-forward", id),
  browserReload: (id: string) => ipcRenderer.invoke("hv:browser-reload", id),
  browserClose: (id: string) => ipcRenderer.invoke("hv:browser-close", id),
  browserList: (workspaceId?: string) => ipcRenderer.invoke("hv:browser-list", workspaceId),
  browserGet: (id: string) => ipcRenderer.invoke("hv:browser-get", id),
  browserClearData: () => ipcRenderer.invoke("hv:browser-clear-data"),
  browserPick: (id: string) => ipcRenderer.invoke("hv:browser-pick", id),
  browserPickCancel: (id: string) => ipcRenderer.invoke("hv:browser-pick-cancel", id),
  onBrowserState: (cb: (info: unknown) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p);
    ipcRenderer.on("hv:browser-state", h);
    return () => ipcRenderer.removeListener("hv:browser-state", h);
  },
  onBrowserClosed: (cb: (p: { id: string }) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { id: string });
    ipcRenderer.on("hv:browser-closed", h);
    return () => ipcRenderer.removeListener("hv:browser-closed", h);
  },
  getTerminalSettings: () => ipcRenderer.invoke("hv:get-terminal-settings"),
  setTerminalSettings: (s: Record<string, unknown>) => ipcRenderer.invoke("hv:set-terminal-settings", s),
  getLayout: () => ipcRenderer.invoke("hv:get-layout"),
  setLayout: (l: Record<string, unknown>) => ipcRenderer.invoke("hv:set-layout", l),

  // ── §27 Voice input ──────────────────────────────────────────────
  // The model download and inference both live in main; the renderer only
  // captures audio and receives text. No transcript is ever logged (§11).
  voiceStatus: () => ipcRenderer.invoke("hv:voice-status") as Promise<VoiceStatusDTO>,
  voiceDownload: () => ipcRenderer.invoke("hv:voice-download") as Promise<VoiceStatusDTO>,
  voiceCancelDownload: () => ipcRenderer.invoke("hv:voice-cancel-download") as Promise<VoiceStatusDTO>,
  voiceRemoveModel: () => ipcRenderer.invoke("hv:voice-remove-model") as Promise<VoiceStatusDTO>,
  getVoiceSettings: () => ipcRenderer.invoke("hv:get-voice-settings") as Promise<VoiceSettingsDTO>,
  setVoiceSettings: (s: Record<string, unknown>) =>
    ipcRenderer.invoke("hv:set-voice-settings", s) as Promise<VoiceSettingsDTO>,
  // §8.3: ALWAYS check this before getUserMedia — on macOS a denied mic still
  // yields a "live" track that produces nothing but zeros.
  voiceMicStatus: () => ipcRenderer.invoke("hv:voice-mic-status") as Promise<string>,
  voiceAskMic: () => ipcRenderer.invoke("hv:voice-ask-mic") as Promise<boolean>,
  voiceOpenMicSettings: () => ipcRenderer.invoke("hv:voice-open-mic-settings") as Promise<void>,
  voiceTranscribe: (pcm: Int16Array) =>
    ipcRenderer.invoke("hv:voice-transcribe", pcm) as Promise<string>,
  onVoiceStatusChanged: (cb: (s: VoiceStatusDTO) => void): (() => void) => {
    const h = (_e: Electron.IpcRendererEvent, s: unknown): void => cb(s as VoiceStatusDTO);
    ipcRenderer.on("hv:voice-status-changed", h);
    return () => ipcRenderer.removeListener("hv:voice-status-changed", h);
  },

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

  // ── §24 Commands (prompt templates) ──────────────────────────────
  // The skills surface, channel for channel: list/read/approve/enable/activate,
  // linked dirs, two-phase import, delete/promote. Changes apply live via
  // respawn-resume; on-disk / config changes push hv:prompt-templates-changed.
  promptTemplatesList: (workspaceId?: string) => ipcRenderer.invoke("hv:prompt-templates-list", workspaceId),
  promptTemplatesRead: (id: string) => ipcRenderer.invoke("hv:prompt-templates-read", id),
  promptTemplatesApprove: (id: string) => ipcRenderer.invoke("hv:prompt-templates-approve", id),
  promptTemplatesSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("hv:prompt-templates-set-enabled", id, enabled),
  promptTemplatesSetActive: (workspaceId: string, id: string, on: boolean | null) =>
    ipcRenderer.invoke("hv:prompt-templates-set-active", workspaceId, id, on),
  promptTemplatesGetLinked: () => ipcRenderer.invoke("hv:prompt-templates-get-linked"),
  promptTemplatesSetLinked: (dirs: string[]) => ipcRenderer.invoke("hv:prompt-templates-set-linked", dirs),
  promptTemplatesAddLinked: (dir?: string) => ipcRenderer.invoke("hv:prompt-templates-add-linked", dir),
  promptTemplatesImportLocal: () => ipcRenderer.invoke("hv:prompt-templates-import-local"),
  promptTemplatesImportGit: (url: string) => ipcRenderer.invoke("hv:prompt-templates-import-git", url),
  promptTemplatesImportSelect: (token: string, ids: string[], scope: "global" | "workspace", workspaceId: string | null) =>
    ipcRenderer.invoke("hv:prompt-templates-import-select", token, ids, scope, workspaceId),
  promptTemplatesDelete: (id: string, workspaceId: string | null) => ipcRenderer.invoke("hv:prompt-templates-delete", id, workspaceId),
  // §25 plugin marketplaces.
  pluginMarketplaces: () => ipcRenderer.invoke("hv:plugins-marketplaces"),
  pluginAddMarketplace: (url: string) => ipcRenderer.invoke("hv:plugins-add-marketplace", url),
  pluginRemoveMarketplace: (id: string) => ipcRenderer.invoke("hv:plugins-remove-marketplace", id),
  pluginList: () => ipcRenderer.invoke("hv:plugins-list"),
  pluginScan: (marketplaceId: string, name: string) => ipcRenderer.invoke("hv:plugins-scan", marketplaceId, name),
  pluginInstall: (token: string, sel: { skillDirs: string[]; commandFiles: string[]; mcpKeys: string[] }) =>
    ipcRenderer.invoke("hv:plugins-install", token, sel),
  pluginInstalled: () => ipcRenderer.invoke("hv:plugins-installed"),
  pluginRemove: (plugin: string) => ipcRenderer.invoke("hv:plugins-remove", plugin),
  pluginEnableInstalled: (plugin: string) => ipcRenderer.invoke("hv:plugins-enable-installed", plugin),
  promptTemplatesPromote: (id: string) => ipcRenderer.invoke("hv:prompt-templates-promote", id),
  /** Does ~/.claude/commands exist? Drives the one-click link suggestion. */
  onPromptTemplatesChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("hv:prompt-templates-changed", listener);
    return () => ipcRenderer.removeListener("hv:prompt-templates-changed", listener);
  },

  // ── MCP server config (additive). Changes apply to new sessions. ──
  mcpGet: (workspaceId?: string) => ipcRenderer.invoke("hv:mcp-get", workspaceId),
  mcpSetServer: (scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: unknown) =>
    ipcRenderer.invoke("hv:mcp-set-server", scope, workspaceId, name, cfg),
  mcpStatus: () => ipcRenderer.invoke("hv:mcp-status"),
  /** Remote servers are swept here, not at boot — a credential read can raise a keychain prompt. */
  mcpSweepRemote: (force?: boolean) => ipcRenderer.invoke("hv:mcp-sweep-remote", force),
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
  // Connect → authenticate-if-needed → tools, in one call.
  mcpConnectFlow: (scope: "global" | "workspace", workspaceId: string | null, name: string) =>
    ipcRenderer.invoke("hv:mcp-connect-flow", scope, workspaceId, name) as Promise<
      { ok: true; tools: { name: string; description?: string }[] } | { ok: false; error: string }
    >,
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
  onPiExit: (cb: (i: { sessionId: string; code: number | null; intentional: boolean; stderr?: string }) => void): (() => void) => {
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
  // An extension asked for UI HappyVibe can't render; main auto-denied it so the
  // extension isn't left hanging (uiFallback.ts). Surfaced as a session notice.
  onUiUnhandled: (cb: (i: { sessionId: string; method?: string }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void =>
      cb(p as { sessionId: string; method?: string });
    ipcRenderer.on("hv:ui-unhandled", listener);
    return () => ipcRenderer.removeListener("hv:ui-unhandled", listener);
  },
});
