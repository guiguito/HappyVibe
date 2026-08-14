/**
 * §28 — the egress gate's decision state, and the network log the agent reads.
 *
 * PURE and electron-free (the pi/spawn.ts discipline) so it is unit-testable
 * without a window: `browsers.ts` owns the `webRequest` hook and asks this
 * module what to do. Splitting it that way is deliberate — the interesting part
 * of the security story is a state machine, and a state machine behind an
 * Electron session object is a state machine nobody tests.
 *
 * WHY THE ENFORCEMENT POINT IS HERE AND NOT ON THE TOOL CALL. Gating only
 * `browser_navigate` is bypassable by the page itself: one `location.href` from
 * injected JS and the agent's gated tool never ran. `webRequest.onBeforeRequest`
 * on the partition sees every request the guest makes, whoever caused it.
 *
 * THE TWO TIERS, and the honest limit (PRD §28):
 *   - main-frame navigations gate per host (`browser:<host>` rules)
 *   - subresources of a page we already allowed run silently, but are LOGGED
 * So in-page `fetch` can still reach any domain the page can. The headline is
 * "the agent's browser only NAVIGATES where you allow", not "no byte leaves".
 * `browser_evaluate`'s own stricter rule is the companion mitigation.
 */

/** Newest-last, and bounded: the failure mode is burning the context window. */
const RING_MAX = 200;

export interface NetRequest {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  error?: string;
}

export type NavDecision = { allow: true } | { allow: false; reason: "needs-approval"; host: string };

export class EgressState {
  /** Hosts the user (or the localhost carve-out) has cleared for this pane. */
  private readonly hosts = new Set<string>();
  /**
   * ONE expected navigation, armed just before main calls loadURL.
   *
   * It exists because approving a host and navigating to it are two different
   * events: the tool call is approved for a URL, and the request arrives a
   * moment later with no marker on it. Spent on first use so an approval for
   * one page cannot silently authorise a second load of something else.
   */
  private pendingOnce: string | null = null;
  private ring: NetRequest[] = [];

  /** Clear a host for the rest of this pane's life (Allow / Allow for session). */
  approveHost(host: string): void {
    this.hosts.add(host);
  }

  /** Arm the single navigation main is about to perform. */
  approveOnce(url: string): void {
    this.pendingOnce = url;
  }

  /**
   * The gate. `isRedirectOfApproved` is true when this request is the
   * continuation of a navigation already allowed — a redirect chain is one
   * navigation, and refusing the hop would break every IdP bounce.
   */
  decideMainFrame(url: string, isRedirectOfApproved: boolean): NavDecision {
    const host = hostname(url);
    if (!host) {
      // Unparseable, or a non-http scheme. Refuse: `file://` and friends are
      // exactly what the sandbox rules exist to keep out, and "allow what we
      // could not classify" is the wrong default for a security decision.
      return { allow: false, reason: "needs-approval", host: url.slice(0, 80) };
    }
    if (isLocal(host) || this.hosts.has(host) || isRedirectOfApproved || this.pendingOnce === url) {
      this.pendingOnce = null;
      // Landing on a host clears same-host follow-ups: a page you approved is a
      // page you can click around in. Cross-host still asks.
      this.hosts.add(host);
      return { allow: true };
    }
    return { allow: false, reason: "needs-approval", host };
  }

  /** Every request, allowed or not — this is what `browser_read_network` serves. */
  record(req: NetRequest): void {
    this.ring.push(req);
    if (this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
  }

  /** Fill in the outcome of the most recent record of this URL, if any. */
  complete(url: string, outcome: { status?: number; error?: string }): void {
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i].url !== url) continue;
      if (outcome.status !== undefined) this.ring[i].status = outcome.status;
      if (outcome.error !== undefined) this.ring[i].error = outcome.error;
      return;
    }
  }

  /**
   * Tab-separated, newest last — the same austerity as
   * buildOpenTerminalsBlock, and for the same reason: this lands in a context
   * window, so a table costs less than JSON and reads the same.
   */
  recent(limit = RING_MAX): string {
    const rows = this.ring
      .slice(-Math.max(1, Math.floor(limit)))
      .map((r) => `${r.method}\t${r.error ?? r.status ?? "pending"}\t${r.resourceType}\t${r.url.slice(0, 200)}`);
    return rows.length ? `method\tstatus\ttype\turl\n${rows.join("\n")}` : "(no requests recorded yet)";
  }
}

/**
 * Local copies of hv-browser's two helpers.
 *
 * ponytail: this module is import-free by contract (same as hv-rules.ts), and
 * these are four lines. Both sets are pinned together by tests/hv-browser.test.ts
 * and tests/browser-egress.test.ts; if a third consumer appears, promote them.
 */
function hostname(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname || null;
  } catch {
    return null;
  }
}

const LOCAL = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);
const isLocal = (h: string): boolean => LOCAL.has(h);
