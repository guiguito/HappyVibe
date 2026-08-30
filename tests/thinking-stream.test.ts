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

  test("start, delta and end are all handled", () => {
    for (const t of ["thinking_start", "thinking_delta", "thinking_end"]) {
      expect(src).toContain(t);
    }
  });

  test("the item is committed as its own transcript kind", () => {
    expect(src).toContain('kind: "thinking"');
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

  test("the item exists and is not an assistant bubble", () => {
    expect(src).toContain('kind: "thinking"');
  });

  test("it is closed by default — the whole safety of reversing §7", () => {
    // NOT a bare `useState(false)` scan: Transcript.tsx already contains four
    // of those, so that assertion would pass before the change was written.
    // Anchor on the component instead.
    const decl = src.match(/function ThinkingBlock[\s\S]{0,400}/)?.[0] ?? "";
    expect(decl).toContain("useState(false)");
    expect(decl).not.toContain("useState(true)");
  });
});
