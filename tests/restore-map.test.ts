import { describe, it, expect } from "vitest";
import { toTranscriptItems, type RestoredMessage } from "../src/renderer/src/restoreMap";

/**
 * The seam that had no test. Both sides of it were correct — main paired the
 * command and the bubble knew how to draw a card — but the mapper between them
 * rebuilt user items field by field and dropped `promptTemplate`, so a reopened session
 * silently fell back to showing the raw expansion. Every other test passed.
 */
const CTX = { sessionId: "s1", workspaceId: "/ws" };
const ids = (): (() => number) => {
  let n = 0;
  return () => ++n;
};

describe("toTranscriptItems", () => {
  it("carries `promptTemplate` through, so a reopened session redraws the card", () => {
    const msgs: RestoredMessage[] = [
      { kind: "user", text: "Review the changes…", promptTemplate: { typed: "/review README.md" } },
    ];
    const [item] = toTranscriptItems(msgs, CTX, ids());
    expect(item).toMatchObject({
      kind: "user",
      text: "Review the changes…",
      promptTemplate: { typed: "/review README.md" },
    });
  });

  it("leaves an ordinary user message without a command", () => {
    const [item] = toTranscriptItems([{ kind: "user", text: "hello" }], CTX, ids());
    expect((item as { promptTemplate?: unknown }).promptTemplate).toBeUndefined();
  });

  it("rebuilds tool cards, marking a recorded error as error and everything else done", () => {
    const msgs: RestoredMessage[] = [
      { kind: "tool", toolCallId: "t1", toolName: "bash", args: { command: "ls" }, result: "ok" },
      { kind: "tool", toolCallId: "t2", toolName: "bash", args: {}, error: true },
    ];
    const items = toTranscriptItems(msgs, CTX, ids());
    expect(items[0]).toMatchObject({ kind: "tool", card: { toolCallId: "t1", status: "done", result: "ok" } });
    expect(items[1]).toMatchObject({ kind: "tool", card: { toolCallId: "t2", status: "error" } });
  });

  it("rebuilds a plan card with session/workspace context and defaults", () => {
    const [item] = toTranscriptItems([{ kind: "plan", planPath: ".agents/plans/001-x.md" }], CTX, ids());
    expect(item).toMatchObject({
      kind: "plan",
      card: { sessionId: "s1", workspaceId: "/ws", path: ".agents/plans/001-x.md", status: "draft", done: 0, total: 0 },
    });
  });

  it("assigns a distinct id per item, so rewind and React keys keep working", () => {
    const items = toTranscriptItems(
      [{ kind: "user", text: "a" }, { kind: "assistant", text: "b" }, { kind: "user", text: "c" }],
      CTX,
      ids(),
    );
    const seen = items.map((i) => (i as { id?: number }).id);
    expect(new Set(seen).size).toBe(3);
    expect(seen.every((n) => typeof n === "number")).toBe(true);
  });
});
