import { describe, expect, test } from "vitest";
import { messageText, restoreItems } from "../src/main/restore";

// Shapes mirror Pi's real get_messages output (verified against a session file):
// assistant messages carry text + toolCall blocks; tool output is a separate
// role:"toolResult" message matched by toolCallId.

describe("messageText", () => {
  test("joins text blocks, drops thinking/toolCall blocks", () => {
    expect(
      messageText([
        { type: "thinking", thinking: "…" },
        { type: "text", text: "Hello" },
        { type: "toolCall", id: "t1", name: "x", arguments: {} },
        { type: "text", text: "world" },
      ]),
    ).toBe("Hello\nworld");
    expect(messageText("plain")).toBe("plain");
    expect(messageText(undefined)).toBe("");
  });
});

describe("restoreItems", () => {
  test("reconstructs user, assistant text, and tool cards in order with intent + result", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "write a poem" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "…" },
          { type: "text", text: "On it." },
          { type: "toolCall", id: "call-1", name: "Notion_notion-create-pages", arguments: { intent: "Creating a Notion page", pages: [] } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "Notion_notion-create-pages",
        isError: false,
        content: [{ type: "text", text: '{"url":"https://notion.so/p/1"}' }],
      },
      { role: "assistant", content: [{ type: "text", text: "Done — created the page." }] },
    ];
    const items = restoreItems(raw);
    expect(items).toEqual([
      { kind: "user", text: "write a poem" },
      { kind: "assistant", text: "On it." },
      {
        kind: "tool",
        toolCallId: "call-1",
        toolName: "Notion_notion-create-pages",
        args: { intent: "Creating a Notion page", pages: [] },
        result: '{"url":"https://notion.so/p/1"}',
        error: false,
      },
      { kind: "assistant", text: "Done — created the page." },
    ]);
  });

  test("marks a tool card as error when its result isError", () => {
    const raw = [
      { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "false" } }] },
      { role: "toolResult", toolCallId: "c2", isError: true, content: [{ type: "text", text: "boom" }] },
    ];
    const [tool] = restoreItems(raw);
    expect(tool).toMatchObject({ kind: "tool", toolCallId: "c2", error: true, result: "boom" });
  });

  test("emits a plan card at its plan_complete position (path from the result), not at the bottom", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "plan the feature" }] },
      { role: "assistant", content: [
        { type: "text", text: "Here's the plan." },
        { type: "toolCall", id: "p1", name: "plan_complete", arguments: { intent: "…", plan: "# Plan" } },
      ] },
      { role: "toolResult", toolCallId: "p1", toolName: "plan_complete", content: [{ type: "text", text: "Plan saved to .agents/plans/001-feature.md. It is ready for the user to review…" }] },
      { role: "assistant", content: [{ type: "text", text: "Implementing now." }] },
      { role: "assistant", content: [{ type: "toolCall", id: "e1", name: "edit", arguments: { path: "src/x.ts" } }] },
      { role: "toolResult", toolCallId: "e1", content: [{ type: "text", text: "ok" }] },
    ];
    const items = restoreItems(raw);
    // Plan card sits between the "Here's the plan." bubble and the implementation
    // messages — NOT appended last.
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "plan", "assistant", "tool"]);
    expect(items[2]).toEqual({ kind: "plan", planPath: ".agents/plans/001-feature.md" });
  });

  test("plan_start / plan_status_update never become cards", () => {
    const raw = [
      { role: "assistant", content: [{ type: "toolCall", id: "s1", name: "plan_start", arguments: {} }] },
      { role: "toolResult", toolCallId: "s1", toolName: "plan_start", content: [{ type: "text", text: "Plan Mode is on." }] },
      { role: "assistant", content: [{ type: "toolCall", id: "u1", name: "plan_status_update", arguments: { status: "implemented" } }] },
      { role: "toolResult", toolCallId: "u1", toolName: "plan_status_update", content: [{ type: "text", text: "Plan marked implemented." }] },
    ];
    expect(restoreItems(raw)).toEqual([]);
  });

  test("revised plans collapse to the last plan_complete for that path", () => {
    const raw = [
      { role: "assistant", content: [{ type: "toolCall", id: "p1", name: "plan_complete", arguments: {} }] },
      { role: "toolResult", toolCallId: "p1", toolName: "plan_complete", content: [{ type: "text", text: "Plan saved to .agents/plans/001-x.md. It is ready…" }] },
      { role: "user", content: [{ type: "text", text: "revise it" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "p2", name: "plan_complete", arguments: {} }] },
      { role: "toolResult", toolCallId: "p2", toolName: "plan_complete", content: [{ type: "text", text: "Plan saved to .agents/plans/001-x.md. It is ready…" }] },
    ];
    const items = restoreItems(raw);
    const plans = items.filter((i) => i.kind === "plan");
    expect(plans).toHaveLength(1); // one card, at the LAST revision's position
    expect(items[items.length - 1]).toEqual({ kind: "plan", planPath: ".agents/plans/001-x.md" });
  });

  test("drops empty text messages and unmatched results", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "   " }] },
      { role: "toolResult", toolCallId: "orphan", content: [{ type: "text", text: "x" }] },
    ];
    expect(restoreItems(raw)).toEqual([]);
  });
});
