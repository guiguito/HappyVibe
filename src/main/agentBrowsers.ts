/**
 * §28 — which browser pane an agent session owns, and the cap.
 *
 * The §26 split, repeated because it earned it: BrowserManager stays
 * session-ignorant (a pane belongs to a WORKSPACE and to the human looking at
 * it), and this module is the only thing that also knows a session opened one.
 * Ending a session therefore never destroys a pane — it releases a claim, and
 * the browser stays as an ordinary tab the user can keep using.
 *
 * ADOPTION (round 1). A human opens browsers with ⌘B, and "look at what I am
 * looking at" is the whole point of having one. So a session with no browser of
 * its own ADOPTS the pane the human most recently had on screen in this
 * workspace, instead of opening a second one beside it. The cap below is
 * therefore about what the agent may CREATE — human-opened panes are unlimited,
 * exactly as §26 caps agent terminals at 3 while the human's are uncapped.
 *
 * CAP 1, not 3. A pane is a full Chromium renderer, where a terminal is a PTY,
 * and there is no "open a second browser" workflow the agent needs: the whole
 * loop is open → read → act → re-read on ONE page. So `open` on a session that
 * already has a pane NAVIGATES it (§28 "reuse-by-navigate") instead of refusing,
 * because refusing would teach the model to close and re-open, which is worse
 * for the user watching it.
 */

import type { BrowserManager } from "./browsers";

export const MAX_AGENT_BROWSERS = 1;

export type OpenResult = { ok: true; browserId: string; reused: boolean } | { ok: false; reason: string };

export class AgentBrowsers {
  /** sessionId → browserId. One entry per session, by construction. */
  private readonly claims = new Map<string, string>();

  constructor(private readonly mgr: BrowserManager) {}

  /** The live pane this session owns, pruning a claim whose pane is gone. */
  idFor(sessionId: string): string | null {
    const id = this.claims.get(sessionId);
    if (!id) return null;
    if (this.mgr.get(id)) return id;
    this.claims.delete(sessionId);
    return null;
  }

  open(sessionId: string, workspaceId: string, url: string): OpenResult {
    const existing = this.idFor(sessionId);
    if (existing) {
      this.mgr.navigate(existing, url, "agent");
      return { ok: true, browserId: existing, reused: true };
    }
    // Adopt before creating: an unclaimed pane in this workspace is one the
    // human opened, and taking it over is what makes "why is this button dead?"
    // work without a second tab appearing beside the one they are pointing at.
    const adopted = this.adoptable(workspaceId);
    if (adopted) {
      this.claims.set(sessionId, adopted);
      this.mgr.navigate(adopted, url, "agent");
      return { ok: true, browserId: adopted, reused: true };
    }
    const info = this.mgr.create(workspaceId);
    this.claims.set(sessionId, info.id);
    this.mgr.navigate(info.id, url, "agent");
    return { ok: true, browserId: info.id, reused: false };
  }

  /**
   * The pane this session may take over: same workspace, claimed by nobody,
   * most recently on screen. Another session's browser is never stolen — two
   * agents fighting over one page is worse than a second tab.
   */
  private adoptable(workspaceId: string): string | null {
    const claimed = new Set(this.claims.values());
    for (const info of this.mgr.listByRecency(workspaceId)) {
      if (!claimed.has(info.id)) return info.id;
    }
    return null;
  }

  /**
   * Resolve the pane a non-open tool acts on. Every browser tool except `open`
   * needs one, and "there isn't one" is a refusal the MODEL can act on — hence a
   * reason string rather than a null the bridge would have to phrase itself.
   */
  require(sessionId: string): { ok: true; browserId: string } | { ok: false; reason: string } {
    const id = this.idFor(sessionId);
    return id
      ? { ok: true, browserId: id }
      : { ok: false, reason: "This session has no browser open. Call browser_open with a URL first." };
  }

  /** Drop this session's claim WITHOUT destroying the pane — the human's now. */
  releaseSession(sessionId: string): string[] {
    const id = this.idFor(sessionId);
    this.claims.delete(sessionId);
    return id ? [id] : [];
  }

  /** The pane is gone (user closed the tab): forget whoever claimed it. */
  forgetBrowser(browserId: string): void {
    for (const [sid, id] of this.claims) if (id === browserId) this.claims.delete(sid);
  }

  /**
   * §9's seam, for the browser. One line, ids and the URL only — never page
   * content — so an agent can still find the page it opened three compactions
   * ago without paying for it every turn.
   */
  buildOpenBrowserBlock(sessionId: string): string {
    const id = this.idFor(sessionId);
    const info = id ? this.mgr.get(id) : null;
    if (!info) return "";
    return `<open-browser>\n${info.id}\t${info.url || "(blank)"}\t${info.state}\n</open-browser>`;
  }
}
