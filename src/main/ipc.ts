import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_RULES, evaluate, parseRulesFile, type RulesFile } from "../../pi-runtime/extensions/hv-rules";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import {
  agentDir, builtinAgentsDir, getApiKey, getDefaultModel, getOnboardingSeen, installBuiltinAgents,
  providerEnv, providerKeyStatus, removeProviderKey, rulesFile, sessionDir, setApiKey, setDefaultModel,
  setOnboardingSeen, setProviderKey,
} from "./config";
import { allowedAgentDirs, duplicateAgent, readAgentBody, writeAgentEdit } from "./agents";
import {
  authJsonProviders, BYOK_PROVIDERS, detectOllama, isByokProvider, syncOllamaModels,
  type ByokProvider,
} from "./providers";
import { deleteSessionFile, SessionIndex, WorkspaceRegistry, type SessionMeta } from "./store";
import { SessionManager, sweepOrphans, type SessionExit } from "./SessionManager";
import { SessionActivity } from "./activity";
import { EventLog } from "./log";
import { aggregate, type AnalyticsFilter } from "./analytics";
import { generateTitle } from "./titles";
import { promptCommand, type PromptBehavior, type PromptImage } from "./pi/commands";
import { copyClaudeMdToAgentsMd, hasClaudeMd, proposeAgentsMd, readAgentsMd, writeAgentsMd } from "./agentsMd";
import { listDir, readWorkspaceFile, resolveInWorkspace, statMtime, writeWorkspaceFile } from "./files";
import { globalAppendFile, readAppend, resolveWorkspaceAppend, writeAppend } from "./appendSystem";
import { readMcpFile, writeMcpServer, type McpServerConfig } from "./mcp";
import { probe } from "./mcpClient";
import { authenticate, logout } from "./mcpOAuth";
import { statusKey } from "./mcpStatusKey";
import { affectedSessionIds, type ReloadSession } from "./mcpReloadScope";

/** Transcript rebuilt from Pi's get_messages on resume (renderer shape). */
interface SimpleMessage {
  role: "user" | "assistant";
  text: string;
}

function truncateTitle(msg: string): string {
  const oneLine = msg.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => ((b as { type?: string; text?: string }).type === "text" ? (b as { text?: string }).text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

/** True iff this ui-request is a HappyVibe permission prompt (mirrors renderer parsePermission). */
function isPermissionPrompt(r: { method?: string; title?: string }): boolean {
  if (r.method !== "select") return false;
  try {
    return (JSON.parse(r.title ?? "") as { kind?: string })?.kind === "hv.permission";
  } catch {
    return false;
  }
}

/** hv.audit payload when this ui-request is the bridge's audit notify, else null. */
function parseAuditNotify(r: { method?: string; message?: string }): Record<string, unknown> | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    return p?.kind === "hv.audit" ? p : null;
  } catch {
    return null;
  }
}

export function registerIpc(win: BrowserWindow): void {
  const userData = app.getPath("userData");
  const index = new SessionIndex(path.join(userData, "session-index.json"));
  const workspaces = new WorkspaceRegistry(path.join(userData, "workspaces.json"));
  const log = new EventLog(path.join(userData, "events.jsonl"));
  const pidFile = path.join(userData, "pi-pids.json");

  // Kill pi processes a previous app run left behind (crash / force-quit).
  const swept = sweepOrphans(pidFile);
  if (swept.length) console.warn("[hv] swept orphan pi processes:", swept);

  // B6: install/refresh the bundled built-in agents into the app-owned agent
  // dir (idempotent, never clobbers user edits). pi-subagents discovers them.
  try {
    installBuiltinAgents(path.join(piRuntimeDir(), "agents"));
  } catch (e) {
    console.warn("[hv] built-in agent install failed:", e);
  }


  // W1.3: main-side activity knowledge (busy / pending prompt / subagent) —
  // hibernation must never touch a genuinely active session.
  const activity = new SessionActivity();

  /** Everything a Pi spawn needs from provider config (B3) + rules delivery (B4).
   *  Model resolution (W2.1, full PRD hierarchy): session override → workspace
   *  override → global default. Mirrors resolveModel in renderer composer.ts. */
  const spawnOpts = (workspace?: string, resumeFile?: string, sessionId?: string) => ({
    model:
      (sessionId ? index.get(sessionId)?.model : null) ??
      (workspace ? workspaces.getModel(workspace) : null) ??
      getDefaultModel(),
    agentDir: agentDir(),
    providerEnv: providerEnv(),
    resumeFile,
    rulesFile: rulesFile(),
  });

  const manager = new SessionManager({
    pidFile,
    spawn: (workspace, resumeFile, sessionId) =>
      new PiClient(resolvePiSpawn(workspace, sessionDir(), piRuntimeDir(), spawnOpts(workspace, resumeFile, sessionId))),
    // W1.3: called at the cap — hibernate the oldest idle session (stats
    // captured best-effort like close-session, index marked, renderer told),
    // or return null so the manager refuses honestly.
    hibernate: async (liveIds) => {
      const victim = activity.oldestIdle(liveIds);
      if (!victim) return null;
      const client = manager.get(victim) as PiClient | null;
      let stats: unknown = null;
      if (client) {
        try {
          stats = (await client.send({ type: "get_session_stats" })).data ?? null;
        } catch {
          /* unresponsive — hibernate without stats */
        }
      }
      const meta = index.get(victim);
      void log.append({
        type: "session.hibernate",
        sessionId: victim,
        workspaceId: meta?.workspaceId,
        data: { stats: stats as Record<string, unknown> | null },
      });
      index.update(victim, { hibernated: true });
      sessionsChanged();
      return victim;
    },
  });

  // Which client owns a pending extension_ui_request id (permission modal, auth flows).
  const UTILITY = "__utility__";
  const uiOwners = new Map<string, string>();
  const clientFor = (owner: string | undefined): PiClient | null =>
    owner === UTILITY ? utility : owner ? (manager.get(owner) as PiClient | null) : null;

  // ── utility client (B3) ──────────────────────────────────────────
  // Auth/model bridge commands ride the RPC prompt channel (s0.2), so they
  // need a live Pi even before any workspace session exists. A $HOME session
  // outside the SessionManager (and outside the index) serves those ops.
  let utility: PiClient | null = null;
  let utilityStarting: Promise<PiClient> | null = null;

  const startUtility = async (): Promise<PiClient> => {
    utility?.stop();
    utility = null;
    // Sync Ollama models into the app-owned agent dir so local models are
    // selectable with zero config.
    await syncOllamaModels(agentDir()).catch(() => {});
    const c = new PiClient(resolvePiSpawn(os.homedir(), sessionDir(), piRuntimeDir(), spawnOpts()));
    c.on("ui-request", (r: { id: string; message?: string }) => {
      uiOwners.set(r.id, UTILITY);
      win.webContents.send("hv:ui-request", { ...r, sessionId: UTILITY });
      // Auth landed/left → the model list changed (OAuth results only flow as
      // hv.auth ui-requests, so this is where main learns about them).
      try {
        const p = JSON.parse(r.message ?? "") as { kind?: string; stage?: string };
        if (p?.kind === "hv.auth" && (p.stage === "success" || p.stage === "logged_out")) providersChanged();
      } catch {
        /* not JSON — not an hv.auth notify */
      }
    });
    c.on("exit", () => {
      if (utility === c) utility = null; // crashed — next auth/model op respawns it
    });
    await c.start();
    utility = c;
    return c;
  };
  const ensureUtility = async (): Promise<PiClient> => {
    if (utility) return utility;
    // Guard against concurrent first calls (settings fires status+models together).
    utilityStarting ??= startUtility().finally(() => { utilityStarting = null; });
    return utilityStarting;
  };
  /** Respawn so key changes (they ride spawn env) take effect for auth/model ops. */
  const restartUtility = async (): Promise<void> => {
    if (utility) await startUtility();
  };

  // First user message per session, kept until the model title lands.
  const firstPrompt = new Map<string, string>();

  const sessionsChanged = (): void => win.webContents.send("hv:sessions-changed", index.list());

  // V2.A: single "model config changed" broadcast — fired on BYOK key add/
  // remove, OAuth login/logout (main sees every utility hv.auth notify), and
  // default/workspace-model edits. The chat bar refetches its model list and
  // resolution tiers on it, so the chip and menu are never stale.
  const providersChanged = (): void => win.webContents.send("hv:providers-changed");

  // ── MCP status model ─────────────────────────────────────────────────────
  type McpState = "connected" | "needs-auth" | "failed" | "checking";
  interface McpServerStatus {
    name: string;
    scope: "global" | "workspace";
    workspaceId: string | null;
    state: McpState;
    toolCount: number;
    tools?: { name: string; description?: string }[];
    error?: string;
    lastChecked: number;
  }
  const mcpStatusMap = new Map<string, McpServerStatus>();
  const mcpStatusChanged = (): void =>
    win.webContents.send("hv:mcp-status-changed", Array.from(mcpStatusMap.values()));

  const checkServer = async (
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
  ): Promise<void> => {
    const file =
      scope === "global"
        ? path.join(agentDir(), "mcp.json")
        : (() => {
            const ws = path.resolve(workspaceId ?? "");
            if (!workspaces.list().some((w) => path.resolve(w) === ws)) {
              throw new Error("Unknown workspace");
            }
            return path.join(ws, ".mcp.json");
          })();
    const cfg = readMcpFile(file).mcpServers[name];
    if (!cfg) {
      mcpStatusMap.delete(statusKey(scope, workspaceId, name));
      mcpStatusChanged();
      return;
    }
    mcpStatusMap.set(statusKey(scope, workspaceId, name), {
      name, scope, workspaceId, state: "checking", toolCount: 0, lastChecked: Date.now(),
    });
    mcpStatusChanged();
    const result = await probe(name, cfg, agentDir());
    mcpStatusMap.set(statusKey(scope, workspaceId, name), {
      name, scope, workspaceId,
      state: result.state,
      toolCount: result.tools?.length ?? 0,
      tools: result.tools,
      error: result.error,
      lastChecked: Date.now(),
    });
    mcpStatusChanged();
  };

  // Startup connectivity sweep — fire-and-forget, never blocks boot.
  // ponytail: stdio probes briefly spawn each server process; upgrade = persistent handles if startup time bites
  void (async () => {
    const globalServers = Object.keys(readMcpFile(path.join(agentDir(), "mcp.json")).mcpServers);
    const wsPaths = workspaces.list();
    const allChecks: Promise<void>[] = [
      ...globalServers.map((n) => checkServer("global", null, n)),
      ...wsPaths.flatMap((ws) =>
        Object.keys(readMcpFile(path.join(ws, ".mcp.json")).mcpServers).map((n) =>
          checkServer("workspace", ws, n),
        ),
      ),
    ];
    await Promise.allSettled(allChecks);
    const byState: Record<string, number> = {};
    for (const s of mcpStatusMap.values()) byState[s.state] = (byState[s.state] ?? 0) + 1;
    void log.append({ type: "mcp.startup_check", data: { total: allChecks.length, byState } });
  })().catch((e) => console.warn("[hv] mcp startup sweep failed:", e));

  const maybeTitle = (sessionId: string): void => {
    const meta = index.get(sessionId);
    const msg = firstPrompt.get(sessionId);
    if (!meta || meta.titleSource !== "fallback" || !msg) return;
    firstPrompt.delete(sessionId);
    // Fire-and-forget — never blocks the chat; fallback title stays on failure.
    void generateTitle(piRuntimeDir(), meta.workspaceId, msg, {
      model: getDefaultModel(),
      // BYOK keys via env; OAuth creds live in auth.json under the agent dir.
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
    }).then((title) => {
      const cur = index.get(sessionId);
      if (title && cur && cur.titleSource === "fallback") {
        index.update(sessionId, { title, titleSource: "model" });
        sessionsChanged();
      }
    });
  };

  const captureSessionFile = async (sessionId: string, client: PiClient): Promise<void> => {
    try {
      const state = (await client.send({ type: "get_state" })).data as { sessionFile?: string } | undefined;
      if (state?.sessionFile) index.update(sessionId, { piSessionFile: state.sessionFile });
    } catch {
      /* crashed before answering — piSessionFile stays unset */
    }
  };

  const attach = (sessionId: string, client: PiClient): void => {
    const meta = index.get(sessionId);
    client.on("event", (e: Record<string, unknown>) => {
      activity.event(sessionId, e); // W1.3: busy/subagent state + last-activity
      win.webContents.send("hv:pi-event", { ...e, sessionId });
      if (e.type === "agent_end") {
        maybeTitle(sessionId);
        if (meta && !index.get(sessionId)?.piSessionFile) void captureSessionFile(sessionId, client);
        drainPendingReload(sessionId); // apply a deferred MCP reload now the turn is done
      }
    });
    client.on("ui-request", (r: { id: string; method?: string; message?: string }) => {
      // B4 audit channel: hv.audit notifies are fire-and-forget (never respond)
      // and land in the EventLog, not the renderer.
      const audit = parseAuditNotify(r);
      if (audit) {
        void log.append({ type: "permission.decision", sessionId, workspaceId: meta?.workspaceId, data: audit });
        return;
      }
      uiOwners.set(r.id, sessionId);
      // W1.3: an unanswered permission prompt protects the session from hibernation.
      if (isPermissionPrompt(r)) activity.promptOpened(sessionId);
      win.webContents.send("hv:ui-request", { ...r, sessionId });
    });
  };

  // Sessions deferred for an MCP reload (declared here so session-exit can clear them).
  const pendingMcpReload = new Set<string>();

  manager.on("session-exit", ({ sessionId, code, intentional }: SessionExit) => {
    activity.remove(sessionId);
    pendingMcpReload.delete(sessionId); // don't reload a session that's gone
    const meta = index.get(sessionId);
    if (!intentional) {
      void log.append({ type: "session.crash", sessionId, workspaceId: meta?.workspaceId, data: { code } });
    }
    win.webContents.send("hv:pi-exit", { sessionId, code, intentional });
  });

  const startClient = async (meta: SessionMeta, resume: boolean): Promise<PiClient> => {
    await syncOllamaModels(agentDir()).catch(() => {});
    const client = (await manager.start(
      meta.id,
      meta.workspaceId,
      resume ? meta.piSessionFile : undefined
    )) as PiClient;
    attach(meta.id, client);
    // W1.3: waking a hibernated session — restore is otherwise the plain resume path.
    if (index.get(meta.id)?.hibernated) {
      index.update(meta.id, { hibernated: false });
      sessionsChanged();
    }
    void log.append({ type: "session.start", sessionId: meta.id, workspaceId: meta.workspaceId, data: { resume } });
    if (!resume) void captureSessionFile(meta.id, client);
    return client;
  };

  // ── MCP live-reload ──────────────────────────────────────────────────────
  // Pi/the adapter read MCP config only at spawn (no live tool-reload API), so
  // "apply changes live" = respawn the affected sessions resumed (conversation
  // preserved via the session file). Idle sessions reload now; busy ones defer
  // to their next idle. A respawn resets that session's in-memory permission
  // grants + dangerous mode to safe defaults — surfaced via hv:session-reloading.
  // (pendingMcpReload is declared earlier so the session-exit handler can clear it.)
  const reloadingMcp = new Set<string>();

  const reloadSession = async (sessionId: string): Promise<void> => {
    if (reloadingMcp.has(sessionId) || !manager.get(sessionId)) return;
    reloadingMcp.add(sessionId);
    try {
      // Capture the session file first so the conversation survives the respawn.
      if (!index.get(sessionId)?.piSessionFile) {
        const c = manager.get(sessionId) as PiClient | null;
        if (c) await captureSessionFile(sessionId, c);
      }
      const meta = index.get(sessionId);
      if (!meta) return;
      win.webContents.send("hv:session-reloading", { sessionId, reason: "mcp" });
      const exited = new Promise<void>((resolve) => {
        const onExit = (e: SessionExit): void => {
          if (e.sessionId !== sessionId) return;
          manager.off("session-exit", onExit);
          resolve();
        };
        manager.on("session-exit", onExit);
      });
      manager.stop(sessionId); // intentional — renderer clears crash status
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise<void>((r) => { timer = setTimeout(r, 5_000); })]);
      clearTimeout(timer);
      // If the process didn't exit within the grace window its record still
      // exists — startClient would return the dying client (the manager never
      // double-spawns the same id), losing the session. Abort: leave the old
      // process running; the change applies on its next natural restart.
      if (manager.get(sessionId)) {
        void log.append({ type: "session.mcp_reload_failed", sessionId, data: { error: "stop timed out; left running" } });
        return;
      }
      const client = await startClient(meta, !!meta.piSessionFile);
      void client.send({ type: "prompt", message: "/hv-tools" }).catch(() => {}); // refresh renderer tool list
    } catch (err) {
      void log.append({ type: "session.mcp_reload_failed", sessionId, data: { error: String(err) } });
    } finally {
      reloadingMcp.delete(sessionId);
    }
  };

  // Reload a deferred session once it goes idle (called from event/prompt-close paths).
  const drainPendingReload = (sessionId: string): void => {
    if (pendingMcpReload.has(sessionId) && activity.isIdle(sessionId)) {
      pendingMcpReload.delete(sessionId);
      void reloadSession(sessionId);
    }
  };

  let mcpReloadTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingScopes: Array<{ scope: "global" | "workspace"; workspaceId: string | null }> = [];
  const runMcpReloadPass = async (): Promise<void> => {
    const scopes = pendingScopes.splice(0);
    const live: ReloadSession[] = manager
      .activeIds()
      .map((id) => { const m = index.get(id); return m ? { id, workspaceId: m.workspaceId } : null; })
      .filter((s): s is ReloadSession => s !== null);
    const affected = new Set<string>();
    for (const { scope, workspaceId } of scopes)
      for (const id of affectedSessionIds(scope, workspaceId, live)) affected.add(id);
    for (const id of affected) {
      if (activity.isIdle(id)) await reloadSession(id); // sequential — avoid a spawn burst
      else pendingMcpReload.add(id);
    }
  };
  // Debounced so add-then-authenticate coalesces into a single reload pass.
  const scheduleMcpReload = (scope: "global" | "workspace", workspaceId: string | null): void => {
    pendingScopes.push({ scope, workspaceId });
    clearTimeout(mcpReloadTimer);
    mcpReloadTimer = setTimeout(() => { void runMcpReloadPass(); }, 500);
  };

  app.on("will-quit", () => {
    clearTimeout(mcpReloadTimer); // don't spawn during teardown
    manager.stopAll();
    utility?.stop();
  });

  // ── config / folder picking ──────────────────────────────────────
  ipcMain.handle("hv:get-api-key", () => getApiKey());
  ipcMain.handle("hv:set-api-key", (_e, key: string) => setApiKey(key));
  ipcMain.handle("hv:pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ── workspaces ───────────────────────────────────────────────────
  ipcMain.handle("hv:list-workspaces", () => workspaces.list());
  ipcMain.handle("hv:add-workspace", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    workspaces.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle("hv:remove-workspace", (_e, ws: string) => workspaces.remove(ws));

  // ── sessions ─────────────────────────────────────────────────────
  ipcMain.handle("hv:list-sessions", () => index.list());

  ipcMain.handle("hv:create-session", async (_e, workspaceId: string): Promise<SessionMeta> => {
    const meta = index.create(workspaceId);
    try {
      await startClient(meta, false);
    } catch (err) {
      index.remove(meta.id); // never spawned — don't leave a ghost entry
      throw err;
    }
    sessionsChanged();
    return meta;
  });

  ipcMain.handle(
    "hv:open-session",
    async (_e, sessionId: string): Promise<{ meta: SessionMeta; messages: SimpleMessage[] | null }> => {
      const meta = index.get(sessionId);
      if (!meta) throw new Error("Unknown session");
      if (manager.get(sessionId)) return { meta, messages: null }; // already active — renderer keeps its transcript
      const client = await startClient(meta, !!meta.piSessionFile);
      let messages: SimpleMessage[] | null = null;
      if (meta.piSessionFile) {
        try {
          const res = await client.send({ type: "get_messages" });
          const raw = (res.data as { messages?: Array<{ role?: string; content?: unknown }> })?.messages ?? [];
          messages = raw
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role as "user" | "assistant", text: messageText(m.content) }))
            .filter((m) => m.text.trim() !== "");
        } catch {
          messages = []; // resumed but history unreadable — start visually fresh
        }
      }
      sessionsChanged();
      return { meta, messages };
    }
  );

  // Shared by close and delete: capture stats best-effort, log session.end,
  // stop the process.
  const endSession = async (sessionId: string): Promise<void> => {
    const client = manager.get(sessionId) as PiClient | null;
    const meta = index.get(sessionId);
    let stats: unknown = null;
    if (client) {
      try {
        stats = (await client.send({ type: "get_session_stats" })).data ?? null;
      } catch {
        /* dying process — end without stats */
      }
    }
    void log.append({
      type: "session.end",
      sessionId,
      workspaceId: meta?.workspaceId,
      data: { stats: stats as Record<string, unknown> | null },
    });
    manager.stop(sessionId);
  };

  ipcMain.handle("hv:close-session", (_e, sessionId: string) => endSession(sessionId));

  // V2.C2: permanent delete — confirm happens renderer-side. Stop first if
  // live (same stats/session.end capture as close), drop the index entry,
  // delete the Pi session file (sessionDir-confined; missing file fine).
  ipcMain.handle("hv:delete-session", async (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    if (!meta) return;
    if (manager.get(sessionId)) await endSession(sessionId);
    index.remove(sessionId);
    deleteSessionFile(sessionDir(), meta.piSessionFile);
    void log.append({ type: "session.delete", sessionId, workspaceId: meta.workspaceId });
    sessionsChanged();
  });

  ipcMain.handle("hv:rename-session", (_e, sessionId: string, title: string) => {
    index.update(sessionId, { title: title.trim() || "Untitled", titleSource: "user" });
    sessionsChanged();
  });

  ipcMain.handle("hv:archive-session", (_e, sessionId: string, archived: boolean) => {
    index.update(sessionId, { archived });
    sessionsChanged();
  });

  // behavior (B2, additive): renderer passes "steer" | "followUp" while the
  // agent is busy — Pi errors on a bare prompt mid-stream without it.
  // images (W2.1, additive): RPC ImageContent[] built renderer-side (composer.ts).
  ipcMain.handle(
    "hv:prompt-session",
    async (_e, sessionId: string, msg: string, behavior?: PromptBehavior, images?: PromptImage[]) => {
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") {
      throw new Error("Invalid prompt behavior");
    }
    if (images !== undefined) {
      const ok = Array.isArray(images) &&
        images.every((i) => i?.type === "image" && typeof i.data === "string" && typeof i.mimeType === "string");
      if (!ok) throw new Error("Invalid images payload");
    }
    let client = manager.get(sessionId) as PiClient | null;
    const meta = index.get(sessionId);
    if (!client) {
      // W1.3: prompting a hibernated (or otherwise stopped) session wakes it
      // transparently — the user is never blocked by our internal cap.
      if (!meta) throw new Error("Unknown session");
      client = await startClient(meta, !!meta.piSessionFile);
    }
    activity.prompted(sessionId);
    if (meta?.titleSource === "fallback" && !firstPrompt.has(sessionId) && meta.title === "New session") {
      firstPrompt.set(sessionId, msg);
      index.update(sessionId, { title: truncateTitle(msg) }); // fallback until generation lands
      sessionsChanged();
    }
    await client.send(promptCommand(msg, behavior, images));
  });

  ipcMain.handle("hv:abort-session", async (_e, sessionId: string) => {
    await (manager.get(sessionId) as PiClient | null)?.send({ type: "abort" });
  });

  // getStats(sessionId?) — the optional sessionId is the additive B1 extension.
  ipcMain.handle("hv:get-stats", async (_e, sessionId?: string) => {
    const client = sessionId ? (manager.get(sessionId) as PiClient | null) : null;
    if (!client) return null;
    try {
      return (await client.send({ type: "get_session_stats" })).data ?? null;
    } catch {
      return null;
    }
  });

  // ── B5: context visibility ─────────────────────────────────────────
  // All three ride the RPC prompt channel as fire-and-forget /hv-context*
  // bridge commands; the hv.context notify streams back through hv:ui-request
  // (B4 hv.dangerous pattern). The renderer parses it — never opens the modal.
  const contextCmd = (sessionId: string, message: string): void => {
    void (manager.get(sessionId) as PiClient | null)?.send({ type: "prompt", message }).catch(() => {});
  };
  ipcMain.handle("hv:context-snapshot", (_e, sessionId: string) => contextCmd(sessionId, "/hv-context"));
  ipcMain.handle("hv:context-remove", (_e, sessionId: string, keys: string[]) =>
    contextCmd(sessionId, `/hv-context-remove ${keys.join(",")}`));
  ipcMain.handle("hv:context-restore", (_e, sessionId: string, keys: string[]) =>
    contextCmd(sessionId, `/hv-context-restore ${keys.join(",")}`));
  ipcMain.handle("hv:compact-session", (_e, sessionId: string) => {
    const client = manager.get(sessionId) as PiClient | null;
    if (!client) throw new Error("Session is not active");
    // Fire the compact RPC; compaction_start/end stream back as pi-events.
    void client.send({ type: "compact" }).catch(() => {});
  });

  // Payload field must match docs/validation/d1.md — select permission response uses { value: <choice string> }
  ipcMain.on("hv:respond-permission", (_e, id: string, choice: string) => {
    const owner = uiOwners.get(id);
    uiOwners.delete(id);
    if (owner && owner !== UTILITY) {
      activity.promptClosed(owner);
      drainPendingReload(owner); // prompt closed → session may be idle now
    }
    clientFor(owner)?.respondUi(id, { value: choice });
  });

  // ── B3: providers & onboarding ────────────────────────────────────
  // input/select responses use { value }; null → { cancelled: true } (rpc-mode.js).
  ipcMain.on("hv:respond-input", (_e, id: string, value: string | null) => {
    const owner = uiOwners.get(id);
    uiOwners.delete(id);
    clientFor(owner)?.respondUi(id, value === null ? { cancelled: true } : { value });
  });

  ipcMain.handle("hv:get-providers", () => {
    const status = providerKeyStatus();
    return {
      byok: (Object.keys(BYOK_PROVIDERS) as ByokProvider[]).map((id) => ({
        id, label: BYOK_PROVIDERS[id].label, source: status[id],
      })),
      defaultModel: getDefaultModel(),
    };
  });
  ipcMain.handle("hv:set-provider-key", async (_e, provider: string, key: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    setProviderKey(provider, key);
    // Keys ride spawn env: the utility client respawns now; running chat
    // sessions keep their env until their next spawn (never yanked mid-turn).
    await restartUtility();
    providersChanged();
  });
  ipcMain.handle("hv:remove-provider-key", async (_e, provider: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    removeProviderKey(provider);
    await restartUtility();
    providersChanged();
  });

  // OAuth over RPC: fire-and-forget /hv-* bridge commands. The prompt promise
  // only resolves when the whole login flow ends, so never await it here —
  // progress/results stream back as hv.auth ui-requests.
  ipcMain.handle("hv:auth-login", async (_e, provider: string) => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: `/hv-login ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-login-cancel", (_e, provider: string) => {
    void utility?.send({ type: "prompt", message: `/hv-login-cancel ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-logout", async (_e, provider: string) => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: `/hv-logout ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-status", async () => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: "/hv-auth-status" }).catch(() => {});
  });

  ipcMain.handle("hv:detect-ollama", () => detectOllama());

  // ── B4: permission rules, audit, badge ─────────────────────────────
  const readRules = (): RulesFile => {
    try {
      return parseRulesFile(fs.readFileSync(rulesFile(), "utf8"));
    } catch {
      return EMPTY_RULES; // missing or corrupt → empty (bridge behaves the same)
    }
  };

  ipcMain.handle("hv:get-rules", () => readRules());

  ipcMain.handle("hv:set-rules", (_e, rules: RulesFile) => {
    // Sanitize through the same parser the bridge uses — malformed rules never hit disk.
    const clean = parseRulesFile(JSON.stringify(rules));
    fs.writeFileSync(rulesFile(), JSON.stringify(clean, null, 2));
    // Broadcast reload to every live Pi (fire-and-forget slash command, B3 pattern).
    for (const id of manager.activeIds()) {
      void (manager.get(id) as PiClient | null)?.send({ type: "prompt", message: "/hv-rules-reload" }).catch(() => {});
    }
    void utility?.send({ type: "prompt", message: "/hv-rules-reload" }).catch(() => {});
    return clean;
  });

  // Settings "test a call" preview — the SAME pure engine the bridge runs.
  ipcMain.handle("hv:eval-rules", (_e, workspaceId: string, tool: string, input: Record<string, unknown>) =>
    evaluate(readRules(), { tool, input, workspace: workspaceId }));

  ipcMain.handle("hv:read-audit", (_e, filter?: { sessionId?: string; workspaceId?: string }) =>
    log.read({ type: "permission.decision", ...filter }));

  // ── B7: local analytics (read + aggregate in main, never leaves the machine) ──
  ipcMain.handle("hv:get-analytics", async (_e, filter?: AnalyticsFilter) =>
    aggregate(await log.read(), filter ?? {}));

  // B7 onboarding: "seen the wow-flow" flag lives in config (userData), shown
  // once, re-openable from the Help affordance.
  ipcMain.handle("hv:get-onboarding-seen", () => getOnboardingSeen());
  ipcMain.handle("hv:set-onboarding-seen", (_e, seen: boolean) => setOnboardingSeen(!!seen));

  // macOS dock badge = total pending permission prompts (renderer-computed).
  ipcMain.on("hv:set-badge-count", (_e, n: number) => {
    try {
      app.setBadgeCount(Number.isInteger(n) && n > 0 ? n : 0);
    } catch {
      /* not supported on this platform */
    }
  });

  // Live model list from Pi's registry (only models with configured auth).
  ipcMain.handle("hv:list-models", async () => {
    const c = await ensureUtility();
    const res = await c.send({ type: "get_available_models" });
    const models = ((res.data as { models?: { provider: string; id: string; name?: string; contextWindow?: number; input?: string[] }[] })?.models ?? []);
    // contextWindow feeds B5's estimated-gauge fallback (when Pi didn't measure).
    // input (W2.1) gates the image-attach button: only vision models accept images.
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id, contextWindow: m.contextWindow, input: m.input }));
  });
  ipcMain.handle("hv:set-default-model", async (_e, provider: string, modelId: string) => {
    setDefaultModel({ provider, modelId });
    // Apply live to the utility client; chat sessions pick the new default up
    // at their next spawn (changing a running conversation's model mid-turn
    // would be surprising).
    await utility?.send({ type: "set_model", provider, modelId }).catch(() => {});
    providersChanged();
  });

  // First-run gate: any BYOK key, any auth.json credential, or local Ollama.
  ipcMain.handle("hv:has-any-provider", async () => {
    const status = providerKeyStatus();
    if (Object.values(status).some(Boolean)) return true;
    if (authJsonProviders(agentDir()).length > 0) return true;
    return (await detectOllama()).running;
  });

  // Explicit renderer request only; auth URLs from Pi's OAuth flows.
  ipcMain.handle("hv:open-external", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return Promise.resolve();
  });

  // ── AGENTS.md (B2, additive) — fs confined to <workspace>/AGENTS.md ──
  ipcMain.handle("hv:read-agents-md", (_e, workspaceId: string) =>
    readAgentsMd(workspaces.list(), workspaceId));
  ipcMain.handle("hv:write-agents-md", (_e, workspaceId: string, content: string) =>
    writeAgentsMd(workspaces.list(), workspaceId, String(content)));
  ipcMain.handle("hv:propose-agents-md", (_e, workspaceId: string) =>
    proposeAgentsMd(piRuntimeDir(), workspaces.list(), workspaceId, {
      model: getDefaultModel(),
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
    }));
  // W2.3 missing-file flow: CLAUDE.md → AGENTS.md copy (same confinement).
  ipcMain.handle("hv:has-claude-md", (_e, workspaceId: string) =>
    hasClaudeMd(workspaces.list(), workspaceId));
  ipcMain.handle("hv:copy-claude-md", (_e, workspaceId: string) =>
    copyClaudeMdToAgentsMd(workspaces.list(), workspaceId));

  // ── B6: agents & tools ─────────────────────────────────────────────────
  // hv.agents / hv.tools ride the fire-and-forget /hv-* command channel (like
  // B5 context); results stream back as notifies parsed by the renderer.
  // Prefer the focused session's live Pi, else the utility client, so the
  // panels work even with no chat session open.
  const anyClient = async (sessionId?: string): Promise<PiClient> => {
    const c = sessionId ? (manager.get(sessionId) as PiClient | null) : null;
    return c ?? ensureUtility();
  };
  const agentDirs = (): string[] => allowedAgentDirs(builtinAgentsDir(), workspaces.list());

  ipcMain.handle("hv:list-agents", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-agents" }).catch(() => {});
  });
  ipcMain.handle("hv:list-tools", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-tools" }).catch(() => {});
  });

  // Agent file edit/duplicate — path-confined to allowed agent dirs (agents.ts).
  ipcMain.handle("hv:read-agent", (_e, filePath: string) => readAgentBody(agentDirs(), filePath));
  ipcMain.handle("hv:write-agent", (_e, filePath: string, edit: { body?: string; model?: string | null }) => {
    writeAgentEdit(agentDirs(), filePath, edit);
    // Agents are read at delegation time by the pi-subagents child spawn, so
    // edits apply to the next delegation — no live broadcast needed.
  });
  ipcMain.handle("hv:duplicate-agent", (_e, filePath: string) => duplicateAgent(agentDirs(), filePath));

  // ── W1.4: system prompt + workspace settings ───────────────────────────
  // /hv-sysprompt rides the fire-and-forget command channel (B5 pattern); the
  // hv.sysprompt notify streams back through hv:ui-request. Prefer the focused
  // session's Pi (it has a captured prompt after a turn), else the utility
  // client (never runs a turn → text null → renderer shows the friendly note).
  ipcMain.handle("hv:sysprompt-snapshot", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-sysprompt" }).catch(() => {});
  });

  // APPEND_SYSTEM.md additions layer — read at session load, so edits apply to
  // new/restarted sessions. Workspace file REPLACES the global one (appendSystem.ts).
  ipcMain.handle("hv:get-global-append", () => readAppend(globalAppendFile(agentDir())));
  ipcMain.handle("hv:set-global-append", (_e, content: string) =>
    writeAppend(globalAppendFile(agentDir()), String(content)));
  ipcMain.handle("hv:get-workspace-append", (_e, workspaceId: string) =>
    readAppend(resolveWorkspaceAppend(workspaces.list(), workspaceId)));
  ipcMain.handle("hv:set-workspace-append", (_e, workspaceId: string, content: string) =>
    writeAppend(resolveWorkspaceAppend(workspaces.list(), workspaceId), String(content)));

  // ── W2.1: per-session model override + image attach ─────────────────────
  // Persists on SessionMeta (survives hibernation/resume — spawn resolution
  // picks it up) AND applies live via RPC set_model when the session has a
  // running Pi. Returns { live } so the renderer can show an honest
  // "applies on restart" hint when the live switch didn't happen.
  ipcMain.handle(
    "hv:set-session-model",
    async (_e, sessionId: string, m: { provider: string; modelId: string } | null): Promise<{ live: boolean }> => {
      if (!index.get(sessionId)) throw new Error("Unknown session");
      const model = m && typeof m.provider === "string" && typeof m.modelId === "string"
        ? { provider: m.provider, modelId: m.modelId }
        : undefined;
      index.update(sessionId, { model }); // undefined clears (dropped by JSON.stringify)
      sessionsChanged();
      const client = manager.get(sessionId) as PiClient | null;
      if (!client || !model) return { live: false };
      try {
        const res = await client.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
        return { live: res.success !== false };
      } catch {
        return { live: false }; // persisted — applies on next spawn
      }
    }
  );

  // Image picker for the "+" attach menu — main-side dialog, images only.
  // Returns base64 + mimeType matching the RPC ImageContent shape (no data: prefix).
  const IMAGE_MIME: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
  };
  ipcMain.handle("hv:pick-image", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    const file = r.canceled ? null : r.filePaths[0];
    if (!file) return null;
    const mimeType = IMAGE_MIME[path.extname(file).toLowerCase()];
    if (!mimeType) return null; // filter should prevent this — stay honest if bypassed
    return { data: fs.readFileSync(file).toString("base64"), mimeType, name: path.basename(file) };
  });

  // ── W2.2: workspace file tree + editor (additive; files.ts confinement) ──
  ipcMain.handle("hv:fs-list", (_e, workspaceId: string, relDir: string) =>
    listDir(workspaces.list(), workspaceId, relDir));
  ipcMain.handle("hv:fs-read", (_e, workspaceId: string, relPath: string) =>
    readWorkspaceFile(workspaces.list(), workspaceId, relPath));
  ipcMain.handle("hv:fs-write", (_e, workspaceId: string, relPath: string, content: string) =>
    writeWorkspaceFile(workspaces.list(), workspaceId, relPath, content));
  ipcMain.handle("hv:fs-mtime", (_e, workspaceId: string, relPath: string) =>
    statMtime(workspaces.list(), workspaceId, relPath));
  // Reveal in Finder from clickable card paths — workspace-confined.
  ipcMain.handle("hv:reveal-path", (_e, workspaceId: string, relPath: string) => {
    shell.showItemInFolder(resolveInWorkspace(workspaces.list(), workspaceId, relPath));
  });

  // Per-workspace model override (spawn resolution: workspace → global default).
  // Applies to sessions spawned/restarted after the change.
  ipcMain.handle("hv:get-workspace-model", (_e, workspaceId: string) => workspaces.getModel(workspaceId));
  ipcMain.handle("hv:set-workspace-model", (_e, workspaceId: string, m: { provider: string; modelId: string } | null) => {
    workspaces.setModel(workspaceId, m && typeof m.provider === "string" && typeof m.modelId === "string"
      ? { provider: m.provider, modelId: m.modelId }
      : null);
    providersChanged(); // open chat bars refetch → the chip's tier updates live
  });

  // ── MCP server config (adapter reads agentDir()/mcp.json + <ws>/.mcp.json;
  //    changes apply to NEW sessions — the adapter loads config at startup) ──
  const globalMcpFile = () => path.join(agentDir(), "mcp.json");
  // Workspace tier: fixed filename at the workspace root. Guard: only paths
  // registered in the WorkspaceRegistry are writable — uses path.resolve
  // matching, same trust boundary as resolveWorkspaceAppend.
  const workspaceMcpFile = (workspaceId: string): string => {
    const ws = path.resolve(workspaceId);
    if (!workspaces.list().some((w) => path.resolve(w) === ws)) {
      throw new Error("Unknown workspace");
    }
    return path.join(ws, ".mcp.json");
  };

  ipcMain.handle("hv:mcp-get", (_e, workspaceId?: string) => ({
    global: readMcpFile(globalMcpFile()),
    workspace: workspaceId ? readMcpFile(workspaceMcpFile(workspaceId)) : null,
  }));

  ipcMain.handle(
    "hv:mcp-set-server",
    (_e, scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: McpServerConfig | null) => {
      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      writeMcpServer(file, name, cfg);
      void log.append({ type: "mcp.config", workspaceId: workspaceId ?? undefined,
        data: { scope, name, removed: cfg === null } });
      if (cfg === null) {
        // Removal: drop the now-stale status entry so it can't resurface.
        mcpStatusMap.delete(statusKey(scope, workspaceId, name));
        mcpStatusChanged();
      }
      scheduleMcpReload(scope, workspaceId); // apply to running sessions
      return readMcpFile(file);
    },
  );

  ipcMain.handle("hv:mcp-status", () => Array.from(mcpStatusMap.values()));

  ipcMain.handle(
    "hv:mcp-check",
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name?: string) => {
      if (name) {
        await checkServer(scope, workspaceId, name);
        return;
      }
      // Check all servers in scope
      const file =
        scope === "global"
          ? path.join(agentDir(), "mcp.json")
          : workspaceMcpFile(workspaceId ?? "");
      const servers = Object.keys(readMcpFile(file).mcpServers);
      await Promise.all(servers.map((n) => checkServer(scope, workspaceId, n)));
    },
  );

  // ── MCP OAuth: authenticate (add-time) + logout (per-server) ─────────────
  // authenticate awaits the full browser OAuth flow (up to 5 min) — that's
  // fine, it's a per-invoke promise; no global lock that would block other IPC.
  ipcMain.handle(
    "hv:mcp-authenticate",
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name: string) => {
      // Guarded cfg resolution — same boundary as checkServer.
      const file =
        scope === "global"
          ? path.join(agentDir(), "mcp.json")
          : workspaceMcpFile(workspaceId ?? "");
      const cfg = readMcpFile(file).mcpServers[name];
      if (!cfg) return { ok: false, error: "server not found" };

      const result = await authenticate(name, cfg, agentDir(), {
        openExternal: (url) => shell.openExternal(url),
      });

      mcpStatusMap.set(statusKey(scope, workspaceId, name), {
        name, scope, workspaceId,
        state: result.ok ? "connected" : "needs-auth",
        toolCount: result.ok ? result.tools.length : 0,
        tools: result.ok ? result.tools : undefined,
        error: result.ok ? undefined : result.error,
        lastChecked: Date.now(),
      });
      mcpStatusChanged();
      if (result.ok) scheduleMcpReload(scope, workspaceId); // server now usable → apply to sessions
      return result;
    },
  );

  ipcMain.handle("hv:mcp-logout", async (_e, name: string) => {
    logout(name, agentDir());
    // Best-effort: drop any live runtime connection via the utility client.
    try {
      const c = await ensureUtility();
      void c.send({ type: "prompt", message: `/mcp logout ${name}` }).catch(() => {});
    } catch {
      /* utility unavailable — non-fatal */
    }
    // Update every status-map entry for this server name → needs-auth.
    for (const [key, entry] of mcpStatusMap) {
      if (entry.name === name) {
        mcpStatusMap.set(key, {
          ...entry,
          state: "needs-auth",
          toolCount: 0,
          tools: undefined,
          error: undefined,
          lastChecked: Date.now(),
        });
      }
    }
    mcpStatusChanged();
    // A logged-out server must stop working everywhere; tokens are keyed by name
    // (not scope), so reload all live sessions.
    scheduleMcpReload("global", null);
  });
}
