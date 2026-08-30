import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OUTPUT_TOOLS, outputTail, resultText } from "../src/renderer/src/components/ToolCard";

// Round 16 — a bash card rendered `JSON.stringify(result)`, so command output
// reached the user as escaped \n inside an envelope. The RESTORE path already
// did the right thing (restore.ts sets a plain string), so these pin that the
// two paths now agree.

describe("resultText", () => {
  test("extracts the text blocks of a live tool result", () => {
    const live = { content: [{ type: "text", text: "one\ntwo\nthree" }], details: {} };
    expect(resultText(live)).toBe("one\ntwo\nthree");
  });

  test("passes a restored result through — it is already a string", () => {
    expect(resultText("one\ntwo")).toBe("one\ntwo");
  });

  test("joins several text blocks with newlines", () => {
    const r = { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], details: {} };
    expect(resultText(r)).toBe("a\nb");
  });

  test("ignores image blocks — those are rendered as pictures", () => {
    const r = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "shot saved" }] };
    expect(resultText(r)).toBe("shot saved");
    expect(resultText({ content: [{ type: "image", data: "AAAA" }] })).toBeNull();
  });

  test("is null when there is nothing to show, so the caller renders nothing", () => {
    expect(resultText(undefined)).toBeNull();
    expect(resultText(null)).toBeNull();
    expect(resultText({ content: [] })).toBeNull();
    expect(resultText({ content: [{ type: "text", text: "   " }] })).toBeNull();
    expect(resultText({ details: { ok: true } })).toBeNull();
  });
});

describe("outputTail", () => {
  test("keeps the last three non-blank lines, in order", () => {
    expect(outputTail("a\n\nb\nc\nd\n\n")).toEqual(["b", "c", "d"]);
  });

  test("returns everything when there is less than the cap", () => {
    expect(outputTail("only")).toEqual(["only"]);
  });

  test("empty output yields no rows rather than one blank row", () => {
    expect(outputTail("")).toEqual([]);
    expect(outputTail("\n \n")).toEqual([]);
  });
});

describe("OUTPUT_TOOLS", () => {
  test("covers the terminal family, which is what the feedback named", () => {
    for (const t of ["bash", "terminal_run", "terminal_read"]) expect(OUTPUT_TOOLS.has(t)).toBe(true);
  });

  test("excludes tools whose result is not command output", () => {
    // `edit`/`write` render a diff, `subagent` has its own card, and
    // `terminal_kill` returns an acknowledgement rather than output.
    for (const t of ["edit", "write", "subagent", "terminal_kill", "read"]) {
      expect(OUTPUT_TOOLS.has(t)).toBe(false);
    }
  });
});

describe("the details block", () => {
  test("consults the text blocks BEFORE falling back to the envelope", () => {
    // The renderer suite has no DOM, so this is a source scan — the
    // tests/modal-layer.test.ts pattern.
    //
    // The stringify is NOT asserted absent: a pure-details tool result has no
    // text block, and there the envelope IS the information. What matters is
    // the order — `text` is consulted first, so a result that HAS text can
    // never reach the stringify.
    const src = readFileSync(path.join(process.cwd(), "src/renderer/src/components/ToolCard.tsx"), "utf8");
    const ternary = src.match(/const result =[\s\S]{0,200}?;/)?.[0] ?? "";
    expect(ternary).toContain("text !== null ? text");
    expect(ternary.indexOf("text !== null")).toBeLessThan(ternary.indexOf("JSON.stringify"));
    expect(src).toContain("const text = resultText(card.result);");
  });
});
