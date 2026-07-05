import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import os from "node:os";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import {
  agentDir, getApiKey, getDefaultModel, providerEnv, providerKeyStatus,
  removeProviderKey, sessionDir, setApiKey, setDefaultModel, setProviderKey,
} from "./config";
import {
  authJsonProviders, BYOK_PROVIDERS, detectOllama, isByokProvider, syncOllamaModels,
  type ByokProvider,
} from "./providers";

let client: PiClient | null = null;
let lastWorkspace: string | null = null;

function attach(win: BrowserWindow, c: PiClient): void {
  c.on("event", (e) => win.webContents.send("hv:pi-event", e));
  c.on("ui-request", (r) => win.webContents.send("hv:ui-request", r));
  c.on("exit", (info) => win.webContents.send("hv:pi-exit", info));
}

async function startSession(win: BrowserWindow, workspace: string): Promise<void> {
  client?.stop();
  lastWorkspace = workspace;
  // Sync Ollama models into the app-owned agent dir before every spawn so
  // local models are selectable with zero config.
  await syncOllamaModels(agentDir()).catch(() => {});
  client = new PiClient(
    resolvePiSpawn(workspace, sessionDir(), piRuntimeDir(), {
      model: getDefaultModel(),
      agentDir: agentDir(),
      providerEnv: providerEnv(),
    }),
  );
  attach(win, client);
  await client.start();
}

/**
 * Auth/model commands need a live Pi (bridge commands ride the RPC prompt
 * channel — s0.2). Before any workspace is open, spawn a utility session in
 * $HOME; a later real startSession replaces it.
 */
let starting: Promise<void> | null = null;
async function ensureClient(win: BrowserWindow): Promise<PiClient> {
  if (client) return client;
  // Guard against concurrent first calls (settings fires status+models together).
  starting ??= startSession(win, lastWorkspace ?? os.homedir()).finally(() => { starting = null; });
  await starting;
  return client!;
}

/** Restart with the same workspace so env-injected key changes take effect. */
async function restartIfRunning(win: BrowserWindow): Promise<void> {
  if (client) await startSession(win, lastWorkspace ?? os.homedir());
}

export function registerIpc(win: BrowserWindow): void {
  ipcMain.handle("hv:get-api-key", () => getApiKey());
  ipcMain.handle("hv:set-api-key", (_e, key: string) => setApiKey(key));
  ipcMain.handle("hv:pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("hv:start-session", (_e, ws: string) => startSession(win, ws));
  ipcMain.handle("hv:restart-pi", () => lastWorkspace ? startSession(win, lastWorkspace) : Promise.resolve());
  ipcMain.handle("hv:prompt", async (_e, msg: string) => { await client?.send({ type: "prompt", message: msg }); });
  ipcMain.handle("hv:abort", async () => { await client?.send({ type: "abort" }); });
  ipcMain.handle("hv:get-stats", async () => (await client?.send({ type: "get_session_stats" }))?.data ?? null);
  // Payload field must match docs/validation/d1.md — select permission response uses { value: <choice string> }
  ipcMain.on("hv:respond-permission", (_e, id: string, choice: string) => client?.respondUi(id, { value: choice }));

  // ── B3: providers & onboarding ────────────────────────────────────────────
  // input/select responses use { value }; null → { cancelled: true } (rpc-mode.js).
  ipcMain.on("hv:respond-input", (_e, id: string, value: string | null) =>
    client?.respondUi(id, value === null ? { cancelled: true } : { value }));

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
    await restartIfRunning(win); // keys ride spawn env — respawn to take effect
  });
  ipcMain.handle("hv:remove-provider-key", async (_e, provider: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    removeProviderKey(provider);
    await restartIfRunning(win);
  });

  // OAuth over RPC: fire-and-forget /hv-* bridge commands. The prompt promise
  // only resolves when the whole login flow ends, so never await it here —
  // progress/results stream back as hv.auth ui-requests.
  ipcMain.handle("hv:auth-login", async (_e, provider: string) => {
    const c = await ensureClient(win);
    void c.send({ type: "prompt", message: `/hv-login ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-login-cancel", (_e, provider: string) => {
    void client?.send({ type: "prompt", message: `/hv-login-cancel ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-logout", async (_e, provider: string) => {
    const c = await ensureClient(win);
    void c.send({ type: "prompt", message: `/hv-logout ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-status", async () => {
    const c = await ensureClient(win);
    void c.send({ type: "prompt", message: "/hv-auth-status" }).catch(() => {});
  });

  ipcMain.handle("hv:detect-ollama", () => detectOllama());

  // Live model list from Pi's registry (only models with configured auth).
  ipcMain.handle("hv:list-models", async () => {
    const c = await ensureClient(win);
    const res = await c.send({ type: "get_available_models" });
    const models = ((res.data as { models?: { provider: string; id: string; name?: string }[] })?.models ?? []);
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id }));
  });
  ipcMain.handle("hv:set-default-model", async (_e, provider: string, modelId: string) => {
    setDefaultModel({ provider, modelId });
    // Apply to the running session immediately; persisted default covers respawns.
    await client?.send({ type: "set_model", provider, modelId }).catch(() => {});
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
