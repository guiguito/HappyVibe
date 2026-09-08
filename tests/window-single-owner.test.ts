/**
 * §7 round 23 — the source scans that keep "a tab lives in exactly one window"
 * true, in the no-DOM suite's two halves: pure exports asserted as DATA (see
 * tests/window-registry.test.ts and friends), plus these scans for what must be
 * ABSENT. An absence is exactly what a render test does not fail on, and every
 * item here is a way the app was single-window by construction.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipc = readFileSync("src/main/ipc.ts", "utf8");
const index = readFileSync("src/main/index.ts", "utf8");

describe("main is no longer bound to one window (round 23)", () => {
  it("registerIpc receives the registry, not a BrowserWindow", () => {
    expect(ipc).toMatch(/export function registerIpc\(\s*windows: WindowRegistry<BrowserWindow>/);
    expect(ipc).not.toMatch(/export function registerIpc\(win: BrowserWindow\)/);
  });

  it("the one push helper is a broadcast", () => {
    expect(ipc).toMatch(/const send = \(channel: string, payload\?: unknown\): void => windows\.broadcast\(channel, payload\)/);
    expect(ipc).not.toMatch(/win\.webContents\.send\(/);
  });

  it("no dialog parents on a captured window — all seven parent on the sender's", () => {
    expect(ipc).not.toMatch(/showOpenDialog\(win,/);
    expect(ipc.match(/showOpenDialog\(ownerOf\(e\)/g)?.length).toBe(7);
  });

  it("the dock-click window goes through the registry too, so it receives pushes", () => {
    // It never did: `activate` called createWindow() and that window was never
    // handed to registerIpc, so it was deaf for its whole life.
    expect(index).not.toMatch(/length === 0\) createWindow\(\)/);
    expect(index).toMatch(/if \(windows\.all\(\)\.length === 0\) openWindow\(/);
  });
});

describe("per-window chrome is per window (round 23)", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const sidebar = readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
  const preload = readFileSync("src/preload/index.ts", "utf8");

  /**
   * localStorage is shared by every renderer of one origin, so each of these
   * would have made a second window silently mirror the first one's chrome —
   * and `hv:active-ws` would have dragged its whole workspace along with it.
   */
  const PER_WINDOW_KEYS = [
    "hv:active-ws",
    "hv:drawer-panel",
    "hv:drawer-width:",
    "hv:sidebar-collapsed",
    "hv:settings-open",
    "hv:settings-groups",
    "hv:ws-collapsed",
    "hv:sidebar-split",
  ];

  it("none of the per-window keys is read or written through localStorage any more", () => {
    for (const k of PER_WINDOW_KEYS) {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(app + sidebar, k).not.toMatch(new RegExp(`localStorage\\.[gs]etItem\\([\`"']${esc}`));
    }
  });

  it("app-level localStorage is untouched — these are shared on purpose", () => {
    // A dismissal or a cached system prompt is a property of the USER, not of a
    // window, so moving them would be the opposite bug.
    const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
    expect(chat).toMatch(/localStorage\.setItem\(`hv:agentsmd-dismissed:/);
  });

  it("the layout is read synchronously from the boot record and written per window", () => {
    expect(preload).toMatch(/boot: ipcRenderer\.sendSync\("hv:window-boot"\)/);
    // The CHANNEL, not the word: preload's comment names what it replaced.
    expect(preload).not.toMatch(/invoke\("hv:(get|set)-layout"/);
    expect(ipc).not.toMatch(/handle\("hv:(get|set)-layout"/);
    expect(app).toMatch(/window\.hv\.boot\.record\.tabsByWs/);
    expect(app).toMatch(/window\.hv\.setWindowTabs\(/);
  });

  it("the one-time adoption from localStorage lives in uiStore and nowhere else", () => {
    const store = readFileSync("src/renderer/src/uiStore.ts", "utf8");
    expect(store).toMatch(/const ADOPTED = \[/);
    // Every key the scan above forbids elsewhere must be adopted here, or that
    // key silently resets for every existing install.
    for (const k of PER_WINDOW_KEYS) {
      if (k.endsWith(":")) {
        expect(store).toContain(`"${k}files"`);
        expect(store).toContain(`"${k}changes"`);
      } else {
        expect(store).toContain(`"${k}"`);
      }
    }
  });

  it("Window > New Window exists on Cmd-Shift-N and opens a collapsed-sidebar peer", () => {
    // Cmd-N and Cmd-T are the session and terminal bindings (shortcuts.ts), so
    // a new WINDOW cannot have either.
    expect(index).toMatch(/label: 'New Window'/);
    expect(index).toMatch(/accelerator: 'CmdOrCtrl\+Shift\+N'/);
    // It is opened to hold a tab, not to browse.
    expect(index).toMatch(/'hv:sidebar-collapsed': '1'/);
  });

  it("the boot handler is registered before any window exists, not inside registerIpc", () => {
    // preload calls it with sendSync at module load, so a handler that arrived
    // later would block the renderer on a message nobody answers.
    expect(index).toMatch(/ipcMain\.on\(['"]hv:window-boot['"]/);
    expect(ipc).not.toMatch(/"hv:window-boot"/);
    expect(index.search(/ipcMain\.on\(['"]hv:window-boot/)).toBeLessThan(index.indexOf("openWindow({"));
  });
});

/**
 * The per-window store's behaviour, with `window` stubbed — the no-DOM suite
 * has no browser globals, and this module deliberately reads them lazily so
 * importing a component that uses it does not need them either.
 */
describe("uiStore: per-window reads, and the one-time adoption (round 23)", () => {
  const load = async (
    recordUi: Record<string, string>,
    legacy: Record<string, string> = {},
  ): Promise<{ uiGet: (k: string) => string | null; uiSet: (k: string, v: string | null) => void; written: Record<string, string>[] }> => {
    const written: Record<string, string>[] = [];
    const ls = { ...legacy };
    (globalThis as unknown as { window: unknown }).window = {
      hv: {
        boot: { windowId: 7, record: { tabsByWs: {}, ui: recordUi } },
        setWindowUi: (ui: Record<string, string>) => {
          written.push(ui);
          return Promise.resolve();
        },
      },
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string): string | null => (k in ls ? ls[k]! : null),
    };
    vi.resetModules();
    const mod = await import("../src/renderer/src/uiStore");
    return { ...mod, written };
  };

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  it("reads this window's record, not the shared store", async () => {
    const { uiGet } = await load({ "hv:active-ws": "/a" }, { "hv:active-ws": "/b" });
    expect(uiGet("hv:active-ws")).toBe("/a");
    expect(uiGet("hv:nothing")).toBeNull();
  });

  it("adopts the legacy localStorage values ONCE, when the record is empty", async () => {
    const { uiGet } = await load({}, { "hv:sidebar-collapsed": "1", "hv:settings-groups": '["x"]', "hv:unrelated": "no" });
    expect(uiGet("hv:sidebar-collapsed")).toBe("1");
    expect(uiGet("hv:settings-groups")).toBe('["x"]');
    // Only the adopted list travels — this store is not a localStorage mirror.
    expect(uiGet("hv:unrelated")).toBeNull();
  });

  it("a window that HAS a record ignores the legacy store — a new window must not inherit it", async () => {
    // ⌘⇧N ships `{"hv:sidebar-collapsed":"1"}`, and adopting on top of that
    // would hand the new window the first one's workspace and drawer widths.
    const { uiGet } = await load({ "hv:sidebar-collapsed": "1" }, { "hv:active-ws": "/b", "hv:sidebar-collapsed": "0" });
    expect(uiGet("hv:sidebar-collapsed")).toBe("1");
    expect(uiGet("hv:active-ws")).toBeNull();
  });

  it("a write pushes the whole map to main, and null deletes", async () => {
    const { uiSet, uiGet, written } = await load({ "a": "1" });
    uiSet("b", "2");
    expect(written.at(-1)).toEqual({ a: "1", b: "2" });
    uiSet("a", null);
    expect(written.at(-1)).toEqual({ b: "2" });
    expect(uiGet("a")).toBeNull();
  });

  it("survives a store that throws (private window, blocked site data)", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      hv: { boot: { windowId: 1, record: { tabsByWs: {}, ui: {} } }, setWindowUi: () => Promise.resolve() },
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (): string => {
        throw new Error("blocked");
      },
    };
    vi.resetModules();
    const { uiGet } = await import("../src/renderer/src/uiStore");
    expect(uiGet("hv:sidebar-collapsed")).toBeNull();
  });
});

describe("a tab lives in exactly one window (round 23)", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const tabstrip = readFileSync("src/renderer/src/components/TabStrip.tsx", "utf8");
  const filetab = readFileSync("src/renderer/src/components/FileTab.tsx", "utf8");

  it("the tab menu opens for EVERY kind, not only the renameable ones", () => {
    // Round 12 gated onContextMenu on `if (!isChat && !isTerm) return;` — it
    // existed only for Rename. That made round 23's Move item unreachable on a
    // file tab, i.e. on exactly the kind whose move carries an unsaved buffer.
    // Found in the GUI: right-clicking notes.txt did nothing at all.
    const i = tabstrip.indexOf("onContextMenu");
    expect(tabstrip.slice(i, i + 400)).not.toMatch(/if \(!isChat && !isTerm\) return;/);
    // Rename is gated per ITEM instead.
    expect(tabstrip).toMatch(/\{\(sessionOf\(menu\.tab\) !== null \|\| terminalOf\(menu\.tab\) !== null\) && \(/);
  });

  it("the tab menu offers Move to new window", () => {
    expect(tabstrip).toMatch(/Move to new window/);
    // The app's only blur-dismissed menu bug, twice reported: a <button> press
    // does not focus it, so this menu acts on mousedown (tests/tabstrip-menu).
    const at = tabstrip.indexOf(">\n              Move to new window");
    expect(at).toBeGreaterThan(-1);
    const item = tabstrip.slice(tabstrip.lastIndexOf("<button", at), at);
    expect(item).toMatch(/onMouseDown/);
    expect(item).not.toMatch(/onClick/);
  });

  it("a dirty draft is reported with the dirty flag, and an arriving tab can take one", () => {
    expect(filetab).toMatch(/onDirtyChange: \(dirty: boolean, content: string\) => void/);
    expect(filetab).toMatch(/takeDraft\?: \(\) => string \| undefined/);
  });

  it("detaching uses the pure closeTab, so a moved terminal keeps its PTY", () => {
    // closeTerminalTab KILLS the pty and closeBrowserTab DESTROYS the pane —
    // right for closing a tab, catastrophic for moving one.
    const i = app.indexOf("const detachTab");
    expect(i).toBeGreaterThan(-1);
    const detach = app.slice(i, i + 500);
    expect(detach).toMatch(/closeTab\(/);
    expect(detach).not.toMatch(/closeTerminalTab|closeBrowserTab|termKill|browserDestroy/);
  });

  it("the source detaches only after main confirms the move", () => {
    // Detaching first would lose the tab outright if the target window died
    // between the click and the push.
    const i = app.indexOf("const moveTabToWindow");
    expect(i).toBeGreaterThan(-1);
    const fn = app.slice(i, i + 1200);
    expect(fn).toMatch(/const ok = await window\.hv\.moveTab\(/);
    expect(fn).toMatch(/if \(ok\) detachTab\(/);
  });

  it("a NEW window's draft rides the boot payload, not a push it would miss", () => {
    // openWindow returns before its renderer exists, so hv:tab-arrive sent then
    // reaches nobody. index.ts parks it and hv:window-boot hands it over.
    expect(index).toMatch(/pendingDrafts/);
    expect(app).toMatch(/window\.hv\.boot\.draft/);
  });
});

describe("prompts are routed and counted by main (round 23)", () => {
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const permission = readFileSync("src/renderer/src/permission.ts", "utf8");

  it("only the two MODAL kinds are gated on the routed window", () => {
    // Everything else in that handler is state EVERY window needs: dangerous
    // mode, plan state, the tool inventories, and the notifies that draw
    // transcript cards.
    expect(app).toMatch(/const mine = r\.promptWindowId === undefined \|\| r\.promptWindowId === window\.hv\.boot\.windowId/);
    expect(app).toMatch(/if \(info && mine\)/);
    expect(app).toMatch(/if \(ask && mine\)/);
  });

  it("the sidebar's pending count comes from main, not from this window's queue", () => {
    // A renderer counting its own queue reports only the prompts it was chosen
    // to show, so the OTHER window's sidebar would claim the session is idle.
    expect(app).toMatch(/pending=\{pendingBySession\}/);
    expect(permission).not.toMatch(/export function pendingCounts/);
  });

  it("only BLOCKING prompts are counted, from their own map", () => {
    // uiOwners holds every ui-request INCLUDING notifies, which are
    // fire-and-forget and therefore never deleted. Counting that map made the
    // sidebar climb with every transcript card and kept counting deleted
    // sessions — measured live as {sessionA:2, deletedSession:3, sessionB:4}
    // while exactly one prompt was open.
    expect(ipc).toMatch(/const pendingPrompts = new Map<string, string>\(\)/);
    expect(ipc).toMatch(/if \(!method \|\| !BLOCKING_UI_METHODS\.has\(method\)\) return;/);
    expect(ipc).toMatch(/for \(const sid of pendingPrompts\.values\(\)\)/);
    expect(ipc).not.toMatch(/for \(const sid of uiOwners\.values\(\)\)/);
  });

  it("a dead session leaves nothing pending", () => {
    const i = ipc.indexOf('send("hv:pi-exit"');
    expect(ipc.slice(i - 400, i)).toMatch(/pendingPrompts\.delete\(id\)/);
  });

  it("the dock badge is summed in main — one number for the whole app", () => {
    expect(ipc).toMatch(/const badgeByWindow = new Map<number, number>\(\)/);
    expect(ipc).toMatch(/for \(const win of windows\.all\(\)\) total \+= badgeByWindow\.get\(win\.id\) \?\? 0/);
  });

  it("an answered prompt is retracted from every window", () => {
    expect(ipc.match(/send\("hv:ui-resolved"/g)?.length).toBe(2);
    expect(app).toMatch(/window\.hv\.onUiResolved\(/);
  });

  it("holdings are DECLARED by the renderer and not debounced", () => {
    // Routing a prompt to the window that held the tab 400ms ago is the bug.
    expect(app).toMatch(/window\.hv\.windowHolds\(\{/);
    const i = app.indexOf("window.hv.windowHolds({");
    expect(app.slice(i - 400, i)).not.toMatch(/setTimeout/);
  });
});
