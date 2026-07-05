import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_RULES, evaluate, parseRulesFile, type RulesFile } from "../../pi-runtime/extensions/hv-rules";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import {
  agentDir, getApiKey, getDefaultModel, providerEnv, providerKeyStatus,
  removeProviderKey, rulesFile, sessionDir, setApiKey, setDefaultModel, setProviderKey,
} from "./config";
import {
  authJsonProviders, BYOK_PROVIDERS, detectOllama, isByokProvider, syncOllamaModels,
  type ByokProvider,
} from "./providers";
import { SessionIndex, WorkspaceRegistry, type SessionMeta } from "./store";
import { SessionManager, sweepOrphans, type SessionExit } from "./SessionManager";
import { EventLog } from "./log";
import { generateTitle } from "./titles";

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

/** Everything a Pi spawn needs from provider config (B3) + rules delivery (B4). */
function spawnOpts(resumeFile?: string) {
  return {
    model: getDefaultModel(),
    agentDir: agentDir(),
    providerEnv: providerEnv(),
    resumeFile,
    rulesFile: rulesFile(),
  };
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

  const manager = new SessionManager({
    pidFile,
    spawn: (workspace, resumeFile) =>
      new PiClient(resolvePiSpawn(workspace, sessionDir(), piRuntimeDir(), spawnOpts(resumeFile))),
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
    c.on("ui-request", (r: { id: string }) => {
      uiOwners.set(r.id, UTILITY);
      win.webContents.send("hv:ui-request", { ...r, sessionId: UTILITY });
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
      win.webContents.send("hv:pi-event", { ...e, sessionId });
      if (e.type === "agent_end") {
        maybeTitle(sessionId);
        if (meta && !index.get(sessionId)?.piSessionFile) void captureSessionFile(sessionId, client);
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
      win.webContents.send("hv:ui-request", { ...r, sessionId });
    });
  };

  manager.on("session-exit", ({ sessionId, code, intentional }: SessionExit) => {
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
    void log.append({ type: "session.start", sessionId: meta.id, workspaceId: meta.workspaceId, data: { resume } });
    if (!resume) void captureSessionFile(meta.id, client);
    return client;
  };

  app.on("will-quit", () => {
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

  ipcMain.handle("hv:close-session", async (_e, sessionId: string) => {
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
  });

  ipcMain.handle("hv:rename-session", (_e, sessionId: string, title: string) => {
    index.update(sessionId, { title: title.trim() || "Untitled", titleSource: "user" });
    sessionsChanged();
  });

  ipcMain.handle("hv:archive-session", (_e, sessionId: string, archived: boolean) => {
    index.update(sessionId, { archived });
    sessionsChanged();
  });

  ipcMain.handle("hv:prompt-session", async (_e, sessionId: string, msg: string) => {
    const client = manager.get(sessionId) as PiClient | null;
    if (!client) throw new Error("Session is not active");
    const meta = index.get(sessionId);
    if (meta?.titleSource === "fallback" && !firstPrompt.has(sessionId) && meta.title === "New session") {
      firstPrompt.set(sessionId, msg);
      index.update(sessionId, { title: truncateTitle(msg) }); // fallback until generation lands
      sessionsChanged();
    }
    await client.send({ type: "prompt", message: msg });
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

  // Payload field must match docs/validation/d1.md — select permission response uses { value: <choice string> }
  ipcMain.on("hv:respond-permission", (_e, id: string, choice: string) => {
    const owner = uiOwners.get(id);
    uiOwners.delete(id);
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
  });
  ipcMain.handle("hv:remove-provider-key", async (_e, provider: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    removeProviderKey(provider);
    await restartUtility();
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
    const models = ((res.data as { models?: { provider: string; id: string; name?: string }[] })?.models ?? []);
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id }));
  });
  ipcMain.handle("hv:set-default-model", async (_e, provider: string, modelId: string) => {
    setDefaultModel({ provider, modelId });
    // Apply live to the utility client; chat sessions pick the new default up
    // at their next spawn (changing a running conversation's model mid-turn
    // would be surprising).
    await utility?.send({ type: "set_model", provider, modelId }).catch(() => {});
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
}
