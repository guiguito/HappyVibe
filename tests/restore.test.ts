import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { messageText, restoreItems , stripInjectedContext} from "../src/main/restore";

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
      // §7 round 16: thinking is RESTORED now. This fixture always carried a
      // thinking block; until this round the assertion proved it was dropped.
      { kind: "thinking", text: "…" },
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

/**
 * §7 round 12 — images.
 *
 * Measured against 61 real session files before writing any of this: Pi DOES
 * persist images, as `{type:"image", data:<base64>, mimeType}` blocks inside
 * `message.content` — 7 of the 8 found were on `role:"toolResult"` (agent
 * screenshots), 1 on a user message (an attachment). `messageText` keeps only
 * text blocks, so both were dropped on reopen: the user's attachment vanished
 * from its bubble, and a screenshot was never rebuildable at all.
 */
describe("restore carries images", () => {
  const png = (data: string): { type: string; data: string; mimeType: string } => ({
    type: "image", data, mimeType: "image/png",
  });

  test("a user attachment survives as a data URL", () => {
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "look at this" }, png("AAAA")] },
    ]);
    expect(items[0]).toMatchObject({ kind: "user", text: "look at this" });
    expect((items[0] as { images?: string[] }).images).toEqual(["data:image/png;base64,AAAA"]);
  });

  test("an image-only message is not dropped as 'empty'", () => {
    // The old `if (text)` guard meant a prompt that was JUST a picture
    // reconstructed as nothing at all.
    const items = restoreItems([{ role: "user", content: [png("BBBB")] }]);
    expect(items).toHaveLength(1);
    expect((items[0] as { images?: string[] }).images).toEqual(["data:image/png;base64,BBBB"]);
  });

  test("a tool result's screenshot rides its card", () => {
    const items = restoreItems([
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "mcp", arguments: {} }] },
      { role: "toolResult", toolCallId: "t1", toolName: "mcp", content: [{ type: "text", text: "captured" }, png("CCCC")] },
    ]);
    const tool = items.find((i) => i.kind === "tool") as { result?: string; images?: string[] };
    expect(tool.result).toBe("captured");
    expect(tool.images).toEqual(["data:image/png;base64,CCCC"]);
  });

  test("the payload budget is a cap that SAYS it capped, not a silent truncation", () => {
    const big = "x".repeat(3_000_000); // 3 MB of base64 each
    const raw = Array.from({ length: 4 }, () => ({ role: "user", content: [png(big)] }));
    const items = restoreItems(raw);
    const carried = items.flatMap((i) => (i as { images?: string[] }).images ?? []);
    expect(carried.length).toBeLessThan(4);
    expect(items.some((i) => (i as { imagesDropped?: boolean }).imagesDropped)).toBe(true);
  });

  test("a session with no images is byte-for-byte what it was", () => {
    const items = restoreItems([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(items).toEqual([{ kind: "user", text: "hi" }]); // no empty images:[] noise
  });
});

/**
 * Round 15 — timestamps and turn durations, read from the session file.
 *
 * `message.timestamp` is epoch ms and `entry.timestamp` is an ISO string;
 * measured on a real HappyVibe session file, it is the MESSAGE-level one that
 * reaches restoreItems, which is what these fixtures use.
 */
describe("round 15: timestamps and turn duration", () => {
  const T0 = 1783062700000;

  test("user and assistant messages carry their stamp", () => {
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: T0 },
      { role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: T0 + 5000 },
    ]);
    expect(items[0]).toMatchObject({ kind: "user", ts: T0 });
    expect(items[1]).toMatchObject({ kind: "assistant", ts: T0 + 5000 });
  });

  test("a turn's LAST bubble carries the duration, and only it", () => {
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "go" }], timestamp: T0 },
      { role: "assistant", content: [{ type: "text", text: "first" }], timestamp: T0 + 2000 },
      { role: "assistant", content: [{ type: "text", text: "second" }], timestamp: T0 + 9000 },
    ]);
    expect((items[1] as { turnMs?: number }).turnMs).toBeUndefined();
    expect((items[2] as { turnMs?: number }).turnMs).toBe(9000);
  });

  test("a turn ending on a TOOL measures to the tool, not to the last bubble", () => {
    // The agent says "editing now", edits for 30s, and stops. Measuring to the
    // bubble would report a 2s turn; the tool result is when it really ended.
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "edit it" }], timestamp: T0 },
      {
        role: "assistant",
        timestamp: T0 + 2000,
        content: [
          { type: "text", text: "editing now" },
          { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } },
        ],
      },
      { role: "toolResult", toolCallId: "c1", toolName: "edit", content: "ok", timestamp: T0 + 32_000 },
    ]);
    const bubble = items.find((i) => i.kind === "assistant") as { turnMs?: number };
    expect(bubble.turnMs).toBe(32_000);
  });

  test("each turn is measured from its own prompt", () => {
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "one" }], timestamp: T0 },
      { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: T0 + 1000 },
      { role: "user", content: [{ type: "text", text: "two" }], timestamp: T0 + 60_000 },
      { role: "assistant", content: [{ type: "text", text: "b" }], timestamp: T0 + 63_000 },
    ]);
    const bubbles = items.filter((i) => i.kind === "assistant") as { turnMs?: number }[];
    expect(bubbles.map((b) => b.turnMs)).toEqual([1000, 3000]);
  });

  test("an unstamped session restores with no times rather than NaN", () => {
    const items = restoreItems([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "yo" }] },
    ]);
    expect((items[0] as { ts?: number }).ts).toBeUndefined();
    expect((items[1] as { turnMs?: number }).turnMs).toBeUndefined();
  });
});

/**
 * §9/§26/§28 append app-authored context blocks to the OUTGOING prompt, so they
 * land in the session file as part of the user's message. Live, the renderer
 * echoes only what was typed, so they are invisible — but a RELOAD reconstructs
 * the bubble from the file, and the machinery appears inside the user's own
 * words. Reported 2026-08-22 after a reload surfaced an <open-browser> block in
 * a prompt about a penalty game.
 *
 * §24 already solved this shape for prompt-template expansions (store the typed
 * form, show that instead). These three blocks had no equivalent.
 *
 * Stripped only from the END, and one block at a time, because that is exactly
 * how they are appended — a user who types "<open-browser>" mid-sentence keeps it.
 */
describe("stripInjectedContext", () => {
  const browser = "<open-browser>\nb1-x\thttp://localhost:5174/p.html\tready\n</open-browser>";
  const terms = "<open-terminals>\nt1\tzsh\trunning\n</open-terminals>";
  const files = "<open-files>\nsrc/a.ts\n</open-files>";

  test("removes a trailing browser block", () => {
    expect(stripInjectedContext(`Goal keeper is dull.\n\n${browser}`)).toBe("Goal keeper is dull.");
  });

  test("removes SEVERAL trailing blocks, in any order", () => {
    expect(stripInjectedContext(`Do the thing.\n\n${files}\n\n${terms}\n\n${browser}`)).toBe("Do the thing.");
    expect(stripInjectedContext(`Do it.\n\n${browser}\n\n${files}`)).toBe("Do it.");
  });

  test("leaves a message that has none alone", () => {
    expect(stripInjectedContext("just a normal prompt")).toBe("just a normal prompt");
  });

  test("keeps a block the USER typed mid-sentence", () => {
    // Only trailing blocks are ours. Anything with text after it is theirs.
    const typed = `why does ${browser} show up?`;
    expect(stripInjectedContext(typed)).toBe(typed);
  });

  test("does not eat the whole message when it is ONLY a block", () => {
    // Degenerate but real: an empty prompt with context appended. Returning ""
    // is right — restore.ts already drops text-empty, image-less messages.
    expect(stripInjectedContext(browser)).toBe("");
  });

  test("survives an unclosed block rather than deleting the rest", () => {
    const broken = "hello\n\n<open-browser>\nb1-x\tready";
    expect(stripInjectedContext(broken)).toBe(broken);
  });

  test("is applied on the restore path", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "main", "restore.ts"), "utf8");
    expect(src).toMatch(/stripInjectedContext\(messageText\(m\.content\)\)/);
  });
});

// §7 round 16 — thinking blocks were dropped on purpose until this round, so a
// reopened session showed less than a live one. These pin that they agree.
describe("the agent's thinking survives a reopen", () => {
  test("a reopened session shows the thinking a live one does", () => {
    const items = restoreItems([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me read AGENTS.md first." },
          { type: "text", text: "Here is what the project does." },
        ],
      },
    ]);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("thinking");
    // Order matters: the reasoning precedes the answer it produced.
    expect(kinds.indexOf("thinking")).toBeLessThan(kinds.indexOf("assistant"));
    expect(items.find((i) => i.kind === "thinking")).toMatchObject({
      kind: "thinking",
      text: "Let me read AGENTS.md first.",
    });
  });

  test("an empty thinking block yields no item rather than a blank one", () => {
    const items = restoreItems([
      { role: "assistant", content: [{ type: "thinking", thinking: "   " }] },
    ]);
    expect(items.some((i) => i.kind === "thinking")).toBe(false);
  });

  test("a turn that did no thinking gains nothing", () => {
    const items = restoreItems([
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["assistant"]);
  });
});

test("§31: stripInjectedContext leaves a <document> block alone — the CHIP is read from it", () => {
  // The renderer strips it for DISPLAY and parses the header for the chip, so
  // both halves need the block still present in the restored text. Adding
  // `document` to TRAILING_CONTEXT_BLOCK would silently delete the chip from
  // every reopened session — this is the test that would catch it.
  const text = 'summarise this\n\n<document path="/a/report.docx" format="docx">\n# Q3\nbody\n</document>';
  expect(stripInjectedContext(text)).toBe(text);
});

test("§31: the blocks stripInjectedContext WAS written for still go, with a document beside them", () => {
  const text =
    'go\n\n<document path="/a/r.docx" format="docx">\n# Q3\n</document>\n\n<open-files>\nsrc/a.ts\n</open-files>';
  const out = stripInjectedContext(text);
  expect(out).not.toMatch(/<open-files>/);
  expect(out).toMatch(/<document path="\/a\/r\.docx"/);
});
