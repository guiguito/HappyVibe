import { describe, expect, it } from "vitest";
import { failure, fromOutcome } from "../src/main/feedback/client";

/**
 * §34 — the SDK's outcomes onto the replies FeedbackDialog already tells apart.
 * The dialog branches on `kind` (validation jumps to the question, rate_limited
 * has its own copy) and on `status` (pending shows the queued copy), so a code
 * falling through to "server" is a user-visible regression.
 */
const facts = { attachments: 1, bytes: 42, formVersion: 3 };

describe("fromOutcome", () => {
  it("accepted and duplicate are both success", () => {
    for (const status of ["accepted", "duplicate"] as const) {
      expect(fromOutcome({ status, submissionId: "sub_1", formVersion: 3, createdAt: "x" }, facts)).toEqual({
        ok: true,
        submissionId: "sub_1",
        status,
        ...facts,
      });
    }
  });

  it("pending is success with no id yet — the SDK queued it on disk", () => {
    expect(fromOutcome({ status: "pending" }, facts)).toEqual({ ok: true, submissionId: null, status: "pending", ...facts });
  });

  it("invalid carries the server's per-question details", () => {
    const details = [{ questionId: "el_x", code: "missing_required_answer", message: "Required." }];
    expect(fromOutcome({ status: "invalid", details }, facts)).toMatchObject({ ok: false, kind: "validation", details });
  });
});

describe("failure", () => {
  it.each([
    ["form_not_published", "not_published"],
    ["missing_required_answer", "validation"],
    ["file_too_large", "validation"],
    ["client_context_too_large", "validation"],
    ["intent_expired", "expired"],
    ["rate_limit_exceeded", "rate_limited"],
    ["submission_already_pending", "conflict"],
    ["feedback_database_inaccessible", "unauthorized"],
    ["network_unavailable", "network"],
    ["something_new", "server"],
  ])("%s → %s", (code, kind) => {
    expect(failure({ code, message: "m" }).kind).toBe(kind);
  });
});
