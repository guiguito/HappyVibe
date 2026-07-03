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
  // Each on* returns an unsubscribe function. Without it, React StrictMode's
  // dev double-mount registers listeners twice and every stream delta renders
  // twice ("the the heading heading ...").
  onPiEvent: (cb: (e: Record<string, unknown>) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as Record<string, unknown>);
    ipcRenderer.on("hv:pi-event", listener);
    return () => ipcRenderer.removeListener("hv:pi-event", listener);
  },
  onUiRequest: (cb: (r: { id: string; method?: string; title?: string; options?: string[] }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void =>
      cb(p as { id: string; method?: string; title?: string; options?: string[] });
    ipcRenderer.on("hv:ui-request", listener);
    return () => ipcRenderer.removeListener("hv:ui-request", listener);
  },
  onPiExit: (cb: (i: { code: number | null }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p as { code: number | null });
    ipcRenderer.on("hv:pi-exit", listener);
    return () => ipcRenderer.removeListener("hv:pi-exit", listener);
  },
});
