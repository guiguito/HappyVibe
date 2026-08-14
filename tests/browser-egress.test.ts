import { describe, it, expect } from "vitest";
import { EgressState } from "../src/main/browserEgress";

describe("EgressState (§28 two-tier egress gate)", () => {
  it("localhost always allows, with no approval needed", () => {
    const s = new EgressState();
    expect(s.decideMainFrame("http://localhost:5173/", false).allow).toBe(true);
    expect(s.decideMainFrame("http://127.0.0.1:8080/x", false).allow).toBe(true);
  });

  it("a one-shot approval covers exactly one main-frame load", () => {
    const s = new EgressState();
    s.approveOnce("https://docs.foo.com/a");
    expect(s.decideMainFrame("https://docs.foo.com/a", false).allow).toBe(true);
    // …and having LANDED there, the host is approved for follow-ups (below).
    // A DIFFERENT unapproved host is still refused.
    const d = s.decideMainFrame("https://other.com/a", false);
    expect(d).toEqual({ allow: false, reason: "needs-approval", host: "other.com" });
  });

  it("a one-shot approval does not cover a different URL", () => {
    const s = new EgressState();
    s.approveOnce("https://docs.foo.com/a");
    expect(s.decideMainFrame("https://evil.com/a", false).allow).toBe(false);
  });

  it("same-host navigation allows after landing; cross-host asks; redirects inherit", () => {
    const s = new EgressState();
    s.approveHost("docs.foo.com");
    expect(s.decideMainFrame("https://docs.foo.com/deeper", false).allow).toBe(true);
    expect(s.decideMainFrame("https://evil.com/x", false)).toEqual({
      allow: false,
      reason: "needs-approval",
      host: "evil.com",
    });
    // A redirect chain out of an approved navigation is the SAME navigation —
    // refusing it would break every vendor login that bounces through an IdP.
    expect(s.decideMainFrame("https://cdn.evil.com/x", true).allow).toBe(true);
  });

  it("an unparseable URL is refused rather than allowed by accident", () => {
    const s = new EgressState();
    const d = s.decideMainFrame("javascript:alert(1)", false);
    expect(d.allow).toBe(false);
  });

  it("records requests, renders newest-last, and caps the ring", () => {
    const s = new EgressState();
    for (let i = 0; i < 250; i++) {
      s.record({ url: `https://a/${i}`, method: "GET", resourceType: "xhr", status: 200 });
    }
    const out = s.recent();
    expect(out).toContain("https://a/249");
    expect(out).not.toContain("https://a/10\n");
    expect(out.split("\n").length).toBeLessThanOrEqual(201 + 1); // ring + header
    expect(s.recent(5).split("\n").length).toBe(6); // header + 5 rows
  });

  it("says so plainly when nothing has been requested yet", () => {
    expect(new EgressState().recent()).toMatch(/no requests/i);
  });

  it("reports an error in place of a status when a request failed", () => {
    const s = new EgressState();
    s.record({ url: "https://a/x", method: "GET", resourceType: "xhr", error: "net::ERR_FAILED" });
    expect(s.recent()).toContain("net::ERR_FAILED");
  });
});
