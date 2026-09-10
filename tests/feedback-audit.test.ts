import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { feedbackText, toAuditRow } from "../src/renderer/src/components/AuditView";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const analytics = fs.readFileSync("src/main/analytics.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");

/**
 * §34 — "nothing leaves the machine silently". Every send writes one audit row,
 * and that row carries counts and ids, never a word the user typed.
 *
 * A source scan, because the renderer suite has no DOM and the payload's shape
 * is decided in main by one helper.
 */
describe("§34 feedback.sent audit row", () => {
  it("ONE writer serves both surfaces, and the Audit page reads the type back", () => {
    // Both callers go through auditFeedbackSent, so the payload cannot differ
    // between the dialog and the pulse.
    expect((ipc.match(/const auditFeedbackSent =/g) ?? []).length).toBe(1);
    expect((ipc.match(/log\.append\(\{\s*type: "feedback\.sent"/g) ?? []).length).toBe(1);
    expect((ipc.match(/auditFeedbackSent\(/g) ?? []).length).toBe(2); // called once per surface
    expect(ipc).toMatch(/log\.read\(\{ type: "feedback\.sent"/);
  });

  it("the row payload never carries answers or clientContext", () => {
    const at = ipc.indexOf("const auditFeedbackSent =");
    const helper = ipc.slice(at, ipc.indexOf("};", at));
    expect(helper).toMatch(/log\.append/);
    expect(helper).not.toMatch(/answers|clientContext/);
  });

  it("analytics names it as a no-op — the switch stays an inventory of what main writes", () => {
    expect(analytics).toMatch(/case "feedback\.sent":/);
  });

  it("every §34 IPC channel is exposed by preload", () => {
    for (const ch of [
      "hv:feedback-info",
      "hv:feedback-open",
      "hv:feedback-close",
      "hv:feedback-send",
      "hv:feedback-pulse-form",
      "hv:feedback-pulse-send",
      "hv:session-pulse-asked",
    ]) {
      expect(preload, ch).toContain(`"${ch}"`);
      expect(ipc, ch).toContain(`"${ch}"`);
    }
  });

  it("main resolves the model through the app's own chain, never a second table", () => {
    const at = ipc.indexOf("const modelFor =");
    expect(at).toBeGreaterThan(0);
    expect(ipc.slice(at, at + 400)).toMatch(/resolveSpawnModel/);
  });
});

describe("AuditView feedback row", () => {
  const base = { ts: "2026-09-10T10:00:00.000Z", sessionId: "s1" };

  it("discriminates on the event TYPE and renders without content", () => {
    const r = toAuditRow({
      ...base,
      type: "feedback.sent",
      data: { database: "general", formVersion: 2, submissionId: "sub_1", status: "accepted", attachments: 2, bytes: 4096 },
    } as never);
    expect(r.row).toBe("feedback");
    expect(feedbackText(r as never)).toBe("Sent feedback · 2 screenshots");
    const s = toAuditRow({
      ...base,
      type: "feedback.sent",
      data: { database: "session", formVersion: 1, submissionId: "sub_2", status: "accepted", attachments: 0, bytes: 0 },
    } as never);
    expect(feedbackText(s as never)).toBe("Rated the session");
  });

  it("one screenshot is singular", () => {
    const r = toAuditRow({
      ...base,
      type: "feedback.sent",
      data: { database: "general", formVersion: 2, submissionId: "sub_3", status: "accepted", attachments: 1, bytes: 10 },
    } as never);
    expect(feedbackText(r as never)).toBe("Sent feedback · 1 screenshot");
  });

  it("a duplicate replay is labelled as such, not as a second submission", () => {
    const r = toAuditRow({
      ...base,
      type: "feedback.sent",
      data: { database: "general", formVersion: 2, submissionId: "sub_1", status: "duplicate", attachments: 0, bytes: 0 },
    } as never);
    expect(feedbackText(r as never)).toBe("Sent feedback · already received");
  });
});
