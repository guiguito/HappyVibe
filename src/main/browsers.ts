/**
 * §28 — embedded browser panes are owned by MAIN. The renderer is a view.
 *
 * Same division of labour as §26's PTYs, for the same reason: a pane must
 * survive a renderer reload and a Pi respawn, and the thing that drives it (the
 * agent) lives on the other side of a process boundary from the thing that
 * shows it.
 *
 * WHY WebContentsView AND NOT <webview> (PRD §28, locked). It is the blessed,
 * future-proof API, and the cost is paid here: the view composites OVER the
 * renderer's DOM, so main owns its bounds and its visibility. The renderer
 * measures a placeholder and tells us where to sit; every modal tells us to get
 * out of the way. That is `setBounds` + `setVisible`, and it is the whole
 * mechanism behind "the permission modal must always win".
 *
 * THE GUEST HAS NO PRIVILEGES. sandbox on, contextIsolation on, nodeIntegration
 * off, and NO PRELOAD AT ALL — the agent drives the page from main via
 * `webContents`, i.e. from outside the sandbox, so the guest needs zero bridge
 * of its own. A preload would be a hole with nothing on the other side of it.
 */

import { WebContentsView, session, shell, type BrowserWindow, type Rectangle } from "electron";
import { EgressState, type NetRequest } from "./browserEgress";
import { hostOf } from "../../pi-runtime/extensions/hv-browser";
import { PICKER_CANCEL_SCRIPT, PICKER_SCRIPT, parsePicked, type PickedElement } from "./browserPicker";

/** One partition for every pane: §28's persistent, restart-surviving profile. */
const PARTITION = "persist:hv-browser";

/** Console + network rings: bounded, because these land in a context window. */
const CONSOLE_MAX = 200;

export type BrowserState = "loading" | "ready" | "failed" | "blocked" | "crashed";

export interface BrowserInfo {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  state: BrowserState;
  /** Set with state "blocked": the host the egress gate refused. */
  blockedHost?: string;
  /** Set with state "failed": what Chromium said, so the pane is never a blank. */
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface Entry {
  info: BrowserInfo;
  view: WebContentsView;
  egress: EgressState;
  console: Array<{ level: string; text: string }>;
  /** The URL a blocked navigation wanted, kept so "Allow" can retry it. */
  blockedUrl?: string;
  /** Main-frame requests we have already cleared, so redirects can inherit. */
  approvedNav: Set<string>;
}

let seq = 0;

export class BrowserManager {
  private readonly entries = new Map<string, Entry>();
  /** Installed once per partition — a second handler REPLACES the first. */
  private egressInstalled = false;
  /** webContents.id → entry, so the one shared hook can find its pane. */
  private readonly byWebContentsId = new Map<number, Entry>();

  constructor(
    private readonly win: BrowserWindow,
    private readonly onState: (info: BrowserInfo) => void,
    /** Fired for every request the guest makes — main audits these. */
    private readonly onRequest: (id: string, req: NetRequest) => void,
  ) {}

  create(workspaceId: string): BrowserInfo {
    const id = `b${++seq}-${Date.now().toString(36)}`;
    const view = new WebContentsView({
      webPreferences: {
        // §28's mandatory set. Every one of these is load-bearing; the guest is
        // hostile-by-assumption and gets no capability it does not need.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        partition: PARTITION,
        // Autoplay etc. stay at Chromium defaults; media PERMISSIONS are denied
        // wholesale below, which is the part that matters.
      },
    });

    const entry: Entry = {
      info: {
        id,
        workspaceId,
        url: "",
        title: "",
        state: "ready",
        canGoBack: false,
        canGoForward: false,
      },
      view,
      egress: new EgressState(),
      console: [],
      approvedNav: new Set(),
    };
    this.entries.set(id, entry);
    this.byWebContentsId.set(view.webContents.id, entry);

    // Hidden until the renderer tells us where it goes. Without this the view
    // flashes at 0,0 over the sidebar for a frame.
    view.setVisible(false);
    view.setBackgroundColor("#ffffff");
    this.win.contentView.addChildView(view);

    this.wireGuest(entry);
    this.installEgress();
    return entry.info;
  }

  /** Every guard that belongs to ONE guest (the partition-wide one is separate). */
  private wireGuest(entry: Entry): void {
    const wc = entry.view.webContents;
    const { id } = entry.info;

    // Deny camera/mic/geolocation/notifications/… wholesale. A page in the
    // agent's browser has no business asking, and a prompt would be a modal the
    // user never asked for over a pane they may not be looking at.
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);

    // file:// is the sandbox escape that costs nothing to close.
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });

    // A popup must never become an un-gated second window. Same-pane navigation
    // instead, so target=_blank links still work — and go through the gate.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // A user-initiated "open in browser" gesture goes to the OS browser,
      // where it is their session and their rules, not ours.
      if (disposition === "new-window" && /^https?:/i.test(url)) {
        void shell.openExternal(url).catch(() => {});
      }
      return { action: "deny" };
    });

    wc.on("console-message", (details) => {
      entry.console.push({ level: details.level, text: details.message });
      if (entry.console.length > CONSOLE_MAX) {
        entry.console.splice(0, entry.console.length - CONSOLE_MAX);
      }
    });

    wc.on("did-start-loading", () => this.patch(id, { state: "loading" }));
    wc.on("did-stop-loading", () => {
      // A blocked navigation also stops loading; do not paint over its state.
      if (entry.info.state === "blocked") return;
      this.patch(id, {
        state: entry.info.state === "failed" ? "failed" : "ready",
        url: wc.getURL(),
        title: wc.getTitle(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      });
    });
    wc.on("page-title-updated", (_e, title) => this.patch(id, { title }));
    wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED: what a cancelled navigation reports, including every
      // one the egress gate refuses. Painting "failed" over "blocked" would
      // replace the actionable state with a generic one.
      if (!isMainFrame || code === -3) return;
      this.patch(id, { state: "failed", error: `${desc} (${code})`, url });
    });
    wc.on("render-process-gone", () => this.patch(id, { state: "crashed" }));
  }

  /**
   * The egress gate. ONE hook for the whole partition — Electron replaces the
   * previous handler rather than stacking, so installing per pane would silently
   * disarm every pane but the newest.
   */
  private installEgress(): void {
    if (this.egressInstalled) return;
    this.egressInstalled = true;
    const ses = session.fromPartition(PARTITION);

    ses.webRequest.onBeforeRequest((details, callback) => {
      const entry = this.entryForRequest(details.webContentsId);
      if (!entry) return callback({}); // not ours — never block a stranger
      const req: NetRequest = {
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
      };
      entry.egress.record(req);
      this.onRequest(entry.info.id, req);

      if (details.resourceType !== "mainFrame") {
        // Tier 2: subresources of a page we already allowed run silently, and
        // are logged above. §28 records the honest limit this leaves.
        return callback({});
      }

      // Set by onBeforeRedirect below when this URL is a hop in a navigation we
      // already approved. Consumed here, so it authorises exactly one request.
      const inherited = entry.approvedNav.delete(details.url);
      const decision = entry.egress.decideMainFrame(details.url, inherited);
      if (decision.allow) return callback({});
      // Refused: cancel, and put the pane into a state that OFFERS the approval
      // rather than showing a blank. The user clicking Allow is consent (§28's
      // user-initiated rule), so it needs no second prompt.
      entry.blockedUrl = details.url;
      this.patch(entry.info.id, { state: "blocked", blockedHost: decision.host });
      callback({ cancel: true });
    });

    // A redirect chain is ONE navigation, and this is the ONLY place that can
    // say so: the hop arrives at onBeforeRequest as a fresh request with a
    // different URL and no marker on it, so without this every vendor login
    // that bounces through an identity provider lands on the blocked state.
    // (`decideMainFrame`'s `isRedirectOfApproved` parameter exists for exactly
    // this and is otherwise unreachable — a same-URL repeat is already allowed
    // by host.)
    ses.webRequest.onBeforeRedirect((details) => {
      const entry = this.entryForRequest(details.webContentsId);
      if (!entry || details.resourceType !== "mainFrame" || !details.redirectURL) return;
      // Bounded: these are transient hand-offs, consumed by the request that
      // follows within milliseconds. A long chain is a redirect loop, not a
      // reason to grow a set for the life of the pane.
      if (entry.approvedNav.size > 32) entry.approvedNav.clear();
      entry.approvedNav.add(details.redirectURL);
    });

    const outcome = (details: { webContentsId?: number; url: string }, patch: { status?: number; error?: string }): void => {
      const entry = this.entryForRequest(details.webContentsId);
      entry?.egress.complete(details.url, patch);
    };
    ses.webRequest.onCompleted((d) => outcome(d, { status: d.statusCode }));
    ses.webRequest.onErrorOccurred((d) => outcome(d, { error: d.error }));
  }

  private entryForRequest(webContentsId: number | undefined): Entry | undefined {
    return webContentsId === undefined ? undefined : this.byWebContentsId.get(webContentsId);
  }

  private patch(id: string, patch: Partial<BrowserInfo>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // A state that leaves "blocked"/"failed" clears their explanatory fields, so
    // a stale host can never be shown beside a live page.
    const next = { ...entry.info, ...patch };
    if (patch.state && patch.state !== "blocked") next.blockedHost = undefined;
    if (patch.state && patch.state !== "failed") next.error = undefined;
    entry.info = next;
    this.onState(next);
  }

  /**
   * Navigate. `origin` decides whether the egress gate is pre-armed:
   *   - "user": typed in the URL bar or clicked in our chrome — consent by
   *     definition (§28), so the host is approved outright.
   *   - "agent": the bridge already ran the permission gate for this URL and
   *     only calls us on an approval, so we arm ONE navigation.
   */
  navigate(id: string, url: string, origin: "user" | "agent"): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const host = hostOf(url);
    if (origin === "user" && host) entry.egress.approveHost(host);
    else entry.egress.approveOnce(url);
    entry.blockedUrl = undefined;
    this.patch(id, { state: "loading", url, blockedHost: undefined });
    void entry.view.webContents.loadURL(url).catch(() => {
      /* did-fail-load carries the diagnosis; a rejected promise adds nothing */
    });
  }

  /** The user clicked Allow on a blocked pane: approve that host and retry. */
  allowBlocked(id: string): void {
    const entry = this.entries.get(id);
    const url = entry?.blockedUrl;
    if (!entry || !url) return;
    const host = hostOf(url);
    if (host) entry.egress.approveHost(host);
    this.navigate(id, url, "user");
  }

  goBack(id: string): void {
    const wc = this.entries.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.entries.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.entries.get(id)?.view.webContents.reload();
  }

  async screenshot(id: string): Promise<Buffer | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const image = await entry.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toPNG();
  }

  /**
   * The rendered text of the page. `innerText` rather than the accessibility
   * tree deliberately: it is what a human reads, it needs no CDP attach, and it
   * degrades gracefully on a page that never finished loading.
   * ponytail: a11y-tree extraction is the upgrade path if a real page proves
   * innerText insufficient — recorded, not built.
   */
  async getText(id: string, maxChars = 20_000): Promise<string | null> {
    return this.evalIn(id, `(() => {
      const t = document.body ? document.body.innerText : "";
      return t.replace(/\\n{3,}/g, "\\n\\n").slice(0, ${maxChars});
    })()`);
  }

  async click(id: string, selector: string): Promise<string | null> {
    return this.evalIn(id, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "No element matches " + ${JSON.stringify(selector)};
      el.scrollIntoView({ block: "center" });
      el.click();
      return "Clicked " + (el.tagName || "").toLowerCase() + " " + ${JSON.stringify(selector)};
    })()`);
  }

  async type(id: string, selector: string, text: string): Promise<string | null> {
    return this.evalIn(id, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "No element matches " + ${JSON.stringify(selector)};
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
      if (setter && setter.set) setter.set.call(el, ${JSON.stringify(text)});
      else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "Typed into " + ${JSON.stringify(selector)};
    })()`);
  }

  /** browser_evaluate's engine. Result JSON-stringified; a throw comes back as text. */
  async evaluate(id: string, code: string): Promise<string | null> {
    return this.evalIn(id, code);
  }

  private async evalIn(id: string, code: string): Promise<string | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    try {
      const result: unknown = await entry.view.webContents.executeJavaScript(code, true);
      if (result === undefined) return "undefined";
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (err) {
      return `The page threw: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  readConsole(id: string, lines = 100): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const rows = entry.console.slice(-Math.max(1, Math.floor(lines)));
    return rows.length
      ? rows.map((m) => `${m.level}\t${m.text}`).join("\n")
      : "(the page has logged nothing)";
  }

  readNetwork(id: string, limit = 50): string | null {
    return this.entries.get(id)?.egress.recent(limit) ?? null;
  }

  /**
   * §28 picker. The script is injected (no preload exists to hold it) and
   * resolves when the user clicks an element or presses Escape.
   */
  async pick(id: string): Promise<PickedElement | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    try {
      // userGesture true: the picker installs listeners, and Chromium treats a
      // gesture-less injection more suspiciously than it needs to here.
      return parsePicked(await entry.view.webContents.executeJavaScript(PICKER_SCRIPT, true));
    } catch {
      return null;
    }
  }

  cancelPick(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    void entry.view.webContents.executeJavaScript(PICKER_CANCEL_SCRIPT, true).catch(() => {});
  }

  setBounds(id: string, bounds: Rectangle): void {
    this.entries.get(id)?.view.setBounds(bounds);
  }

  setVisible(id: string, visible: boolean): void {
    this.entries.get(id)?.view.setVisible(visible);
  }

  get(id: string): BrowserInfo | null {
    return this.entries.get(id)?.info ?? null;
  }

  list(workspaceId?: string): BrowserInfo[] {
    const all = [...this.entries.values()].map((e) => e.info);
    return workspaceId === undefined ? all : all.filter((i) => i.workspaceId === workspaceId);
  }

  destroy(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.byWebContentsId.delete(entry.view.webContents.id);
    this.entries.delete(id);
    try {
      this.win.contentView.removeChildView(entry.view);
      entry.view.webContents.close();
    } catch {
      /* the window is already going away */
    }
  }

  destroyAll(): void {
    for (const id of [...this.entries.keys()]) this.destroy(id);
  }

  /** §28: Clear browsing data — what makes the persistent partition reversible. */
  async clearData(): Promise<void> {
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
  }
}
