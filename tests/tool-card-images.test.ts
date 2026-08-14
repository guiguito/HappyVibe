/**
 * §7 round 12 — a screenshot in a tool result.
 *
 * The reported symptom was "when a screenshot is taken the agent opens it in a
 * browser; it's not shown in the chat". The live path already RECEIVED the
 * image: `ToolCardData.result` is the raw result, and an MCP screenshot is
 * `{content:[{type:"image", data, mimeType}]}`. The card handed the whole thing
 * to JSON.stringify, so the picture arrived as a megabyte of base64 inside the
 * details block — and buried the text that came with it.
 */
import { describe, expect, test } from "vitest";
import { resultImages, stripImages } from "../src/renderer/src/components/ToolCard";

const img = (data: string, mimeType = "image/png"): unknown => ({ type: "image", data, mimeType });

describe("resultImages", () => {
  test("pulls image blocks out of a live MCP result as data URLs", () => {
    const result = { content: [img("AAAA"), { type: "text", text: "captured" }] };
    expect(resultImages(result)).toEqual(["data:image/png;base64,AAAA"]);
  });

  test("honours the mimeType — a jpeg data URL must not claim to be a png", () => {
    expect(resultImages({ content: [img("BBBB", "image/jpeg")] })).toEqual([
      "data:image/jpeg;base64,BBBB",
    ]);
  });

  test("prefers restored data URLs, which main already built", () => {
    // On reopen the result is a plain string and the images arrive separately.
    expect(resultImages("captured", ["data:image/png;base64,CCCC"])).toEqual([
      "data:image/png;base64,CCCC",
    ]);
  });

  test("is empty for every ordinary result — no card grows a picture by accident", () => {
    expect(resultImages(undefined)).toEqual([]);
    expect(resultImages("plain text")).toEqual([]);
    expect(resultImages({ content: [{ type: "text", text: "hi" }] })).toEqual([]);
    expect(resultImages({ nothing: true })).toEqual([]);
    expect(resultImages({ content: [{ type: "image" }] })).toEqual([]); // no data
  });
});

describe("stripImages", () => {
  test("removes the base64 from what the details block dumps", () => {
    const data = "Q".repeat(5000);
    const out = stripImages({ content: [img(data), { type: "text", text: "captured" }] });
    expect(JSON.stringify(out)).not.toContain(data);
    expect(JSON.stringify(out)).toContain("captured"); // the text survives
  });

  test("leaves a non-content result untouched", () => {
    expect(stripImages("plain")).toBe("plain");
    expect(stripImages(undefined)).toBe(undefined);
    const obj = { ok: true };
    expect(stripImages(obj)).toBe(obj);
  });

  test("keeps the shape a failed delegation reads (content[].text)", () => {
    // ToolCard reads card.result.content[].text for a failed subagent run —
    // stripping images must not disturb that path.
    const out = stripImages({ content: [img("ZZZZ"), { type: "text", text: "agent failed: nope" }] }) as {
      content: Array<{ type?: string; text?: string }>;
    };
    expect(out.content).toEqual([{ type: "text", text: "agent failed: nope" }]);
  });
});
