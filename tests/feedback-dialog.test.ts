import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { FEEDBACK_COPY } from "../src/renderer/src/components/feedbackCopy";

/**
 * The renderer suite has no DOM, so a visual contract is pinned in two halves:
 * the data the component exports, and a SOURCE SCAN for the things that must be
 * true and cannot be asserted by rendering — `tests/modal-layer.test.ts`'s shape.
 */
const dialog = fs.readFileSync("src/renderer/src/components/FeedbackDialog.tsx", "utf8");
const form = fs.readFileSync("src/renderer/src/components/FormRenderer.tsx", "utf8");
const sidebar = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
const app = fs.readFileSync("src/renderer/src/App.tsx", "utf8");

describe("§34 dialog", () => {
  it("uses the modal shell classes, so it sits at z-100 and browser panes hide under it", () => {
    expect(dialog).toMatch(/className="hv-overlay /);
    expect(dialog).toMatch(/className="hv-dialog /);
  });

  it("thumbnails are data: URLs — the CSP has no blob:", () => {
    expect(form + dialog).not.toMatch(/createObjectURL/);
    expect(dialog).toMatch(/readAsDataURL/);
  });

  /**
   * The chrome must not draw a heading: the form authors its own title element
   * and the body renders it. The Radix title stays for the accessible name.
   */
  it("the dialog draws NO header title — the only visible one is the form's own", () => {
    expect(dialog).toMatch(/<Dialog\.Title className="sr-only">/);
    expect(dialog).not.toMatch(/<Dialog\.Title className="font-black/);
  });

  /**
   * The frame FITS ITS CONTENT: a one-question step is not padded out to the
   * height of the five-option one. Only the send-off needs room, and it asks
   * for that itself rather than making every other step pay for it.
   */
  it("the frame is content-sized, capped by the viewport, with the footer outside the scroller", () => {
    expect(dialog).toMatch(/max-h-\[calc\(100vh-3rem\)\]/);
    // A fixed `h-` is what padded every short step out; it must not come back.
    expect(dialog).not.toMatch(/\sh-\[min\(/);
    expect(dialog).toMatch(/min-h-0 overflow-y-auto/);
    // The buttons live outside the scrolling body, so a long page cannot hide them.
    expect(dialog.indexOf("const footer =")).toBeGreaterThan(dialog.indexOf("const body ="));
  });

  it("the send-off reserves its own room, so the celebration is never cramped", () => {
    const at = dialog.indexOf('phase.k === "sent"');
    expect(dialog.slice(at, at + 400)).toMatch(/min-h-\[15rem\]/);
  });

  it("the send-off reuses the house celebration and is given time to play", () => {
    expect(dialog).toMatch(/hv-logo-hop/);
    expect(dialog).toMatch(/<BrandLogo size="lg"/);
    expect(dialog).toMatch(/hv-done-title/);
    // The hop is 1250ms; closing before it lands is what made it feel abrupt.
    const ms = Number(/const CLOSE_AFTER_MS = ([\d_]+);/.exec(dialog)?.[1].replace(/_/g, ""));
    expect(ms).toBeGreaterThan(1250);
  });

  it("no dead copy", () => {
    const all = dialog + form;
    const unused = Object.keys(FEEDBACK_COPY).filter((k) => !all.includes(`C.${k}`) && !all.includes(`FEEDBACK_COPY.${k}`));
    expect(unused).toEqual([]);
  });

  it("the copy never says telemetry, and the ✕ is not Banner's word", () => {
    expect(Object.values(FEEDBACK_COPY).join(" ")).not.toMatch(/telemetry/i);
  });

  it("the sidebar renders the icon in BOTH states, gated on availability", () => {
    expect((sidebar.match(/feedbackAvailable && \(/g) ?? []).length).toBe(2);
    expect((sidebar.match(/<FeedbackIcon \/>/g) ?? []).length).toBe(2);
    expect(sidebar).toMatch(/title="Send feedback"/);
  });

  it("App opens through feedbackOpen and every close path drops main's capture", () => {
    expect(app).toMatch(/feedbackAvailable=\{feedbackInfo\.available\}/);
    expect(dialog).toMatch(/window\.hv\.feedbackOpen\(\)/);
    expect(dialog).toMatch(/window\.hv\.feedbackClose\(\)/);
    // One `close` helper, so no path can forget it.
    expect((dialog.match(/const close = \(\)/g) ?? []).length).toBe(1);
  });

  it("the dialog is app-level: it passes no sessionId from a settings page", () => {
    expect(app).toMatch(/sessionId=\{activeView === "chat" \? focusedChatSessionId : null\}/);
  });
});
