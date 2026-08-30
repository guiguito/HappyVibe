import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyDelta } from "../src/renderer/src/streaming";

// Round 16 — the main agent's thinking is rendered, collapsed. Pi already
// streams it (thinking_start/_delta/_end on assistantMessageEvent); App.tsx
// simply never read those three. The renderer suite has no DOM, so the wiring
// is pinned as a source scan plus the pure buffer behaviour it reuses.

describe("the thinking buffer reuses the text streaming helper", () => {
  test("a fresh block starts rather than appends", () => {
    expect(applyDelta({ s1: "old" }, "s1", "new", false)).toBe("new");
  });

  test("an open block appends", () => {
    expect(applyDelta({ s1: "abc" }, "s1", "def", true)).toBe("abcdef");
  });
});

describe("App reads all three thinking events", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");

  test("start and delta are read, and stream into the live buffer", () => {
    for (const t of ["thinking_start", "thinking_delta"]) expect(src).toContain(t);
    expect(src).toContain("thinkRef.current[sid]");
  });

  test("the item is committed as its own transcript kind", () => {
    expect(src).toContain('kind: "thinking"');
  });

  test("it mirrors on the SAME rAF as the answer, not a second one", () => {
    // A separate flush would be a second render path for the same turn.
    const flush = src.slice(src.indexOf("const scheduleFlush"), src.indexOf("const scheduleFlush") + 320);
    expect(flush).toContain("setStreamText");
    expect(flush).toContain("setThinkingText");
  });

  test("it settles at the NEXT ACTION, never at thinking_end", () => {
    // GUI round: the model routinely finishes thinking a beat before it starts
    // answering, so collapsing at thinking_end made the block vanish while the
    // user was still reading it. The three next-actions are the first answer
    // token, the first tool call, and the end of the turn.
    expect(src).toContain("const commitThinking");
    expect(src).not.toContain('ame?.type === "thinking_end"');
    const calls = src.split("commitThinking(sid)").length - 1;
    expect(calls).toBeGreaterThanOrEqual(3);
  });

});

describe("sending re-collapses the blocks — per SESSION", () => {
  const chat = readFileSync(path.join(process.cwd(), "src/renderer/src/components/ChatView.tsx"), "utf8");
  const tr = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");

  test("the nonce is bumped on send, beside the scroll one", () => {
    // The decision is explicit: collapsed by default EACH TIME the user sends.
    expect(chat).toContain("setCollapseNonce((n) => n + 1)");
    expect(chat).toContain("collapseNonce={collapseNonce}");
  });

  test("it lives in ChatView, NOT App — App's would be global", () => {
    // ChatView is mounted per session, so sending in one session cannot
    // collapse another's reasoning. A single counter in App would do exactly
    // that, silently, and only with two sessions open.
    const app = readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");
    expect(app).not.toContain("collapseNonce");
    expect(app).not.toContain("collapseThinking");
  });

  test("only thinking items carry it, or the whole transcript remounts on send", () => {
    expect(tr).toContain("function thinkingKey");
    const fn = tr.slice(tr.indexOf("function thinkingKey"), tr.indexOf("function thinkingKey") + 240);
    expect(fn).toContain('it.kind === "thinking"');
    // The non-thinking branch must keep the plain key.
    expect(fn).toContain("(it.id ?? i)");
  });
});

describe("Transcript renders it collapsed", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");
  // Sliced to the component's real end, not a char budget: a fixed window was
  // too short to reach the render body and the assertion failed for the wrong
  // reason. `\n}` at column 0 is the end of a top-level function here.
  const from = src.indexOf("function ThinkingBlock");
  const decl = src.slice(from, src.indexOf("\n}", from) + 2);

  test("the item exists and is not an assistant bubble", () => {
    expect(src).toContain('kind: "thinking"');
  });

  test("a COMMITTED block is closed, a LIVE one is open", () => {
    // NOT a bare `useState(false)` scan: Transcript.tsx already contains four
    // of those, so that assertion would pass before the change was written.
    // `useState(!!live)` carries both halves — the live block opens itself, and
    // the committed one that replaces it is a fresh component, so it starts
    // closed. That is what keeps §7's "collapsed by default" true after a turn.
    expect(decl).toContain("useState(!!live)");
    expect(decl).not.toContain("useState(true)");
  });

  test("it renders MARKDOWN, with the answer bubble's own renderer", () => {
    // GUI round: the model writes `**Recommending X**` and plain
    // whitespace-pre-wrap showed the asterisks.
    expect(decl).toContain("ReactMarkdown");
    expect(decl).toContain("MD_COMPONENTS");
    expect(decl).not.toContain("whitespace-pre-wrap");
  });

  test("the block is set apart by TYPE, not by a panel", () => {
    // GUI round 2: a border + fill made the reasoning a card competing with the
    // answer beside it. Differentiation is italic + a smaller size in the same
    // muted ink, so nothing but type separates them.
    expect(decl).not.toContain("border-2");
    expect(decl).not.toContain("bg-paper-deep");
    expect(decl).toContain("md-quiet");
    const css = readFileSync(path.join(process.cwd(), "src/renderer/src/styles.css"), "utf8");
    const quiet = css.slice(css.indexOf(".md-quiet {"), css.indexOf(".md-quiet {") + 400);
    expect(quiet).toContain("font-style: italic");
    // The model writes its summaries in **bold** — the one emphasis this
    // surface must not have.
    expect(css).toContain(".md-quiet strong");
    expect(css.slice(css.indexOf(".md-quiet strong"), css.indexOf(".md-quiet strong") + 160)).toContain("font-weight: inherit");
  });

  test("the live block is followed as it grows, or the view stops scrolling", () => {
    // Reported: "autoscroll does not work anymore after a thinking block
    // collapses". The live block renders OUTSIDE `items`, so the follow effect
    // needs it in its deps for the same reason it needs `streaming`.
    // Sliced to the effect's real close, not a char budget — the comment
    // explaining the fix sits between the call and the deps array.
    const from = src.indexOf("bottom.current?.scrollIntoView");
    const deps = src.slice(from, src.indexOf("]);", from) + 3);
    expect(deps).toMatch(/\}, \[items, busy, streaming, thinking\]\);/);
  });

  test("the label is quiet and lowercase — it is subordinate to the answer", () => {
    // The AGENT label's treatment, which this used to borrow and must not.
    expect(decl).not.toContain("uppercase");
    expect(decl).not.toContain("tracking-widest");
    expect(decl).toContain("thinking");
  });
});
