import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hv", {
  getApiKey: () => ipcRenderer.invoke("hv:get-api-key"),
  setApiKey: (k: string) => ipcRenderer.invoke("hv:set-api-key", k),
  pickFolder: () => ipcRenderer.invoke("hv:pick-folder"),
  startSession: (ws: string) => ipcRenderer.invoke("hv:start-session", ws),
  prompt: (m: string) => ipcRenderer.invoke("hv:prompt", m),
  abort: () => ipcRenderer.invoke("hv:abort"),
  getStats: () => ipcRenderer.invoke("hv:get-stats"),
  restartPi: () => ipcRenderer.invoke("hv:restart-pi"),
  respondPermission: (id: string, choice: string) => ipcRenderer.send("hv:respond-permission", id, choice),
  onPiEvent: (cb: (e: Record<string, unknown>) => void) => ipcRenderer.on("hv:pi-event", (_e, p) => cb(p as Record<string, unknown>)),
  onUiRequest: (cb: (r: { id: string; title: string; options: string[] }) => void) => ipcRenderer.on("hv:ui-request", (_e, p) => cb(p as { id: string; title: string; options: string[] })),
  onPiExit: (cb: (i: { code: number | null }) => void) => ipcRenderer.on("hv:pi-exit", (_e, p) => cb(p as { code: number | null })),
});
