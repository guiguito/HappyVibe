import { expect, test } from "vitest";
import { clearedTexts, promptOutcome } from "../src/main/pi/promptOutcome";

const ok = (data?: unknown) => ({ type: "response" as const, command: "prompt", success: true, data });

test("Pi's disposition is read off the response (Pi 0.99+)", () => {
  expect(promptOutcome(ok({ disposition: "started" }))).toEqual({ ok: true, disposition: "started" });
  expect(promptOutcome(ok({ disposition: "queued" }))).toEqual({ ok: true, disposition: "queued" });
  expect(promptOutcome(ok({ disposition: "handled" }))).toEqual({ ok: true, disposition: "handled" });
});

test("a response without a disposition is a started turn (the pre-0.99 meaning)", () => {
  expect(promptOutcome(ok())).toEqual({ ok: true, disposition: "started" });
});

test("success:false is a refusal carrying Pi's text — never silently a success", () => {
  expect(promptOutcome({ type: "response", command: "prompt", success: false, error: "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry." }))
    .toEqual({ ok: false, error: "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry." });
  expect(promptOutcome({ type: "response", command: "prompt", success: false })).toEqual({ ok: false, error: "" });
});

test("clearedTexts reads clear_queue's answer and drops anything that isn't text", () => {
  expect(clearedTexts({ type: "response", command: "clear_queue", success: true, data: { steering: ["a", 3], followUp: ["b"] } }))
    .toEqual({ steering: ["a"], followUp: ["b"] });
  expect(clearedTexts({ type: "response", command: "clear_queue", success: false })).toEqual({ steering: [], followUp: [] });
});
