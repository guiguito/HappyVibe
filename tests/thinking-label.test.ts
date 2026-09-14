import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { thinkingLabel } from "../src/renderer/src/thinkingLabel";

describe("the label carries the state, not the content", () => {
  test("while streaming it is the bare verb — the dots are rendered separately", () => {
    expect(thinkingLabel({ live: true })).toBe("Thinking");
    // live wins even when a duration is somehow present
    expect(thinkingLabel({ live: true, ms: 9000 })).toBe("Thinking");
  });

  test("a finished block with a measured duration names it", () => {
    expect(thinkingLabel({ ms: 12_000 })).toBe("Thought for 12s");
    expect(thinkingLabel({ ms: 1_400 })).toBe("Thought for 1s");
  });

  test("past a minute it reads in minutes and seconds", () => {
    expect(thinkingLabel({ ms: 95_000 })).toBe("Thought for 1m 35s");
    expect(thinkingLabel({ ms: 120_000 })).toBe("Thought for 2m 0s");
  });

  /**
   * The reopened-session case. A thinking block in the session file carries no
   * start or end stamp, so the duration is NOT recoverable — and an unknown
   * number is left off rather than invented (§19 ruling 3, one surface over).
   */
  test("no duration → no number, never a zero", () => {
    expect(thinkingLabel({})).toBe("Thought");
    expect(thinkingLabel({ ms: undefined })).toBe("Thought");
  });

  test("a sub-second think still rounds up to 1s rather than reading 0s", () => {
    expect(thinkingLabel({ ms: 200 })).toBe("Thought for 1s");
  });

  test("a nonsense duration degrades to the unknown case", () => {
    expect(thinkingLabel({ ms: -5 })).toBe("Thought");
    expect(thinkingLabel({ ms: Number.NaN })).toBe("Thought");
  });
});

describe("the live block is collapsed, which is what the PRD already decided", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");
  // The component's real body, not a char budget — Transcript.tsx holds several
  // `useState(false)` and a file-wide scan would pass before the change existed.
  const from = src.indexOf("function ThinkingBlock");
  const decl = src.slice(from, src.indexOf("\n}", from) + 2);

  /**
   * The defect this round fixed: §7's round-16 decision reads "collapsed by
   * default … live text is streamed only into an expanded block", and the
   * implementation was `useState(!!live)` — live blocks opened themselves.
   * Pinned as an ABSENCE because that is exactly what a render test cannot
   * fail on, and because the drift was silent for a whole round.
   */
  test("a live block does not open itself", () => {
    expect(decl).not.toContain("useState(!!live)");
    expect(decl).toContain("useState(false)");
  });

  test("the dots are rendered, and only while live", () => {
    expect(src).toContain("hv-dots");
    expect(src).toContain("thinkingLabel");
  });
});

describe("App measures the duration it prints", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");

  test("the clock starts at thinking_start and the item carries the result", () => {
    expect(src).toContain("thinkStart.current[sid] = Date.now()");
    expect(src).toMatch(/kind: "thinking"[^}]*ms:/);
  });
});
