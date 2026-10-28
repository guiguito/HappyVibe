/**
 * Web mode — reaching main's IPC handlers from a browser tab.
 *
 * `ipcMain.on` listeners are an EventEmitter's, so a `send` or a `sendSync`
 * from a tab is just `emit` with a look-alike event — and that also reaches
 * listeners registered inside dependencies (inlet-sdk's crash, analytics and
 * config channels). `ipcMain.handle` keeps its handlers in a private map with no
 * public way to call one, so the tap records each registration as it happens.
 * It must therefore be installed BEFORE the first `handle` call; index.ts does
 * it at module scope, and only in web mode — a desktop-only run never has it.
 *
 * Electron-free: index.ts passes the real `ipcMain`, tests an EventEmitter.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown;

export interface IpcMainLike {
  handle(channel: string, fn: Handler): void;
  handleOnce(channel: string, fn: Handler): void;
  removeHandler(channel: string): void;
  emit(channel: string, ...args: unknown[]): boolean;
}

/** What a tab's window offers as `event.sender`. */
interface SenderLike {
  webContents: { id: number; send(channel: string, ...args: unknown[]): void };
}

export interface IpcTap {
  invoke(win: SenderLike, channel: string, args: unknown[]): Promise<unknown>;
  send(win: SenderLike, channel: string, args: unknown[]): void;
  sync(win: SenderLike, channel: string, args: unknown[]): unknown;
}

/**
 * The parts of `IpcMainEvent` main and inlet-sdk read: `sender` (bySender,
 * `sender.send` replies), `reply`, and `returnValue` for a sync message.
 */
function eventFor(win: SenderLike): { sender: SenderLike["webContents"]; returnValue: unknown; reply: (ch: string, ...a: unknown[]) => void } {
  return {
    sender: win.webContents,
    returnValue: undefined,
    reply: (ch, ...a) => win.webContents.send(ch, ...a),
  };
}

export function tapIpc(ipc: IpcMainLike): IpcTap {
  const handlers = new Map<string, Handler>();
  const handle = ipc.handle.bind(ipc);
  const handleOnce = ipc.handleOnce.bind(ipc);
  const removeHandler = ipc.removeHandler.bind(ipc);
  // The real registration first: it is what throws on a duplicate channel.
  ipc.handle = (channel, fn) => {
    handle(channel, fn);
    handlers.set(channel, fn);
  };
  ipc.handleOnce = (channel, fn) => {
    handleOnce(channel, fn);
    handlers.set(channel, (e, ...a) => {
      handlers.delete(channel);
      removeHandler(channel);
      return fn(e, ...a);
    });
  };
  ipc.removeHandler = (channel) => {
    removeHandler(channel);
    handlers.delete(channel);
  };

  return {
    invoke: (win, channel, args) => {
      const fn = handlers.get(channel);
      // Electron's own message, so a renderer cannot tell which transport refused it.
      if (!fn) return Promise.reject(new Error(`No handler registered for '${channel}'`));
      return Promise.resolve().then(() => fn(eventFor(win), ...args));
    },
    send: (win, channel, args) => {
      ipc.emit(channel, eventFor(win), ...args);
    },
    sync: (win, channel, args) => {
      const e = eventFor(win);
      ipc.emit(channel, e, ...args);
      return e.returnValue;
    },
  };
}
