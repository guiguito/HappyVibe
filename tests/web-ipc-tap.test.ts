import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { tapIpc, type IpcMainLike } from "../src/main/web/ipcTap";

/** ipcMain's shape: an EventEmitter plus a private handler map, as Electron has it. */
function fakeIpcMain(): IpcMainLike & EventEmitter & { real: Map<string, unknown> } {
  const em = new EventEmitter() as IpcMainLike & EventEmitter & { real: Map<string, unknown> };
  em.real = new Map();
  em.handle = (ch, fn) => {
    if (em.real.has(ch)) throw new Error(`Attempted to register a second handler for '${ch}'`);
    em.real.set(ch, fn);
  };
  em.handleOnce = (ch, fn) => em.handle(ch, fn);
  em.removeHandler = (ch) => void em.real.delete(ch);
  return em;
}

const tab = (id: number) => {
  const sent: unknown[][] = [];
  return { sent, webContents: { id, send: (ch: string, ...a: unknown[]) => void sent.push([ch, ...a]) } };
};

describe("web ipc tap", () => {
  it("an invoke from a tab reaches the handle()d handler, with the tab as sender", async () => {
    const ipc = fakeIpcMain();
    const tap = tapIpc(ipc);
    ipc.handle("hv:add", (e, a, b) => ({ sender: (e as { sender: { id: number } }).sender.id, sum: (a as number) + (b as number) }));
    expect(ipc.real.has("hv:add")).toBe(true); // Electron still has it for the windows
    await expect(tap.invoke(tab(7), "hv:add", [2, 3])).resolves.toEqual({ sender: 7, sum: 5 });
  });

  it("refuses an unknown channel with Electron's own message", async () => {
    const tap = tapIpc(fakeIpcMain());
    await expect(tap.invoke(tab(1), "hv:nope", [])).rejects.toThrow("No handler registered for 'hv:nope'");
  });

  it("a duplicate registration still throws — the real handle() runs first", () => {
    const ipc = fakeIpcMain();
    tapIpc(ipc);
    ipc.handle("hv:x", () => 1);
    expect(() => ipc.handle("hv:x", () => 2)).toThrow(/second handler/);
  });

  it("removeHandler takes it away from the tabs too", async () => {
    const ipc = fakeIpcMain();
    const tap = tapIpc(ipc);
    ipc.handle("hv:x", () => 1);
    ipc.removeHandler("hv:x");
    await expect(tap.invoke(tab(1), "hv:x", [])).rejects.toThrow(/No handler/);
  });

  it("a send reaches on() listeners — including ones registered before the tap (inlet-sdk's)", () => {
    const ipc = fakeIpcMain();
    const got: unknown[] = [];
    ipc.on("inlet:config", (e: { sender: { id: number } }, p: unknown) => got.push([e.sender.id, p]));
    const tap = tapIpc(ipc);
    tap.send(tab(3), "inlet:config", [{ op: "hello" }]);
    expect(got).toEqual([[3, { op: "hello" }]]);
  });

  it("event.sender.send and event.reply answer the tab that asked", () => {
    const ipc = fakeIpcMain();
    const tap = tapIpc(ipc);
    ipc.on("q", (e: { sender: { send(c: string, p: unknown): void }; reply(c: string, p: unknown): void }) => {
      e.sender.send("a1", 1);
      e.reply("a2", 2);
    });
    const t = tab(4);
    tap.send(t, "q", []);
    expect(t.sent).toEqual([["a1", 1], ["a2", 2]]);
  });

  it("a sync message returns what the listener put in returnValue (the boot)", () => {
    const ipc = fakeIpcMain();
    const tap = tapIpc(ipc);
    ipc.on("hv:window-boot", (e: { sender: { id: number }; returnValue: unknown }) => {
      e.returnValue = { windowId: e.sender.id };
    });
    expect(tap.sync(tab(9), "hv:window-boot", [])).toEqual({ windowId: 9 });
  });
});
