import { BrowserWindow, dialog, ipcMain } from "electron";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import { getApiKey, setApiKey, sessionDir } from "./config";

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
  client = new PiClient(resolvePiSpawn(workspace, sessionDir(), getApiKey() ?? "", piRuntimeDir()));
  attach(win, client);
  await client.start();
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
}
