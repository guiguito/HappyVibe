import { expect, test } from "vitest";
import { sendOutcome } from "../src/renderer/src/sendOutcome";

// The composer draws a bubble at once when it thinks the agent is idle (the answer can take
// seconds — Pi may compact first), and nothing when it thinks the agent is busy (a chip comes).
test("idle guess, Pi started it: the bubble stays", () => {
  expect(sendOutcome(false, { disposition: "started" })).toEqual({ removeBubble: false, idle: false });
});
test("idle guess, Pi queued it: the bubble goes — the chip, then the delivery, draw it", () => {
  expect(sendOutcome(false, { disposition: "queued" })).toEqual({ removeBubble: true, idle: false });
});
test("a command Pi handled started no run: the session is idle again", () => {
  expect(sendOutcome(false, { disposition: "handled" })).toEqual({ removeBubble: false, idle: true });
});
test("busy guess never had a bubble to remove (main draws one on started)", () => {
  for (const d of ["started", "queued"] as const) expect(sendOutcome(true, { disposition: d }).removeBubble).toBe(false);
});
