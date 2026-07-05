import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import { getApiKey, setApiKey, sessionDir } from "./config";
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
      new PiClient(resolvePiSpawn(workspace, sessionDir(), getApiKey() ?? "", piRuntimeDir(), resumeFile)),
  });

  // Which session owns a pending extension_ui_request id (permission modal).
  const uiOwners = new Map<string, string>();
  // First user message per session, kept until the model title lands.
  const firstPrompt = new Map<string, string>();

  const sessionsChanged = (): void => win.webContents.send("hv:sessions-changed", index.list());

  const maybeTitle = (sessionId: string): void => {
    const meta = index.get(sessionId);
    const msg = firstPrompt.get(sessionId);
    if (!meta || meta.titleSource !== "fallback" || !msg) return;
    firstPrompt.delete(sessionId);
    // Fire-and-forget — never blocks the chat; fallback title stays on failure.
    void generateTitle(piRuntimeDir(), meta.workspaceId, getApiKey() ?? "", msg).then((title) => {
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
    client.on("ui-request", (r: { id: string }) => {
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

  app.on("will-quit", () => manager.stopAll());

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
    if (owner) (manager.get(owner) as PiClient | null)?.respondUi(id, { value: choice });
  });
}
