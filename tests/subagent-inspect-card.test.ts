import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inspectToResults } from "../src/renderer/src/agents";

/**
 * §12 (2026-08-30): `window.hv.subagentInspect` was built 2026-08-21 and had
 * ZERO renderer callers until this round. It is what a FINISHED async
 * delegation's expanded card reads, because that run's `tool_execution_end`
 * carried a dispatch receipt and never a transcript.
 */
describe("inspectToResults", () => {
  it("maps an inspect reply onto the rows SubagentTraceView already renders", () => {
    const out = inspectToResults(
      {
        finalOutput: "Fourteen files, three entry points.",
        messages: [
          { role: "assistant", kind: "text", text: "Reading vite.config.js" },
          { role: "assistant", kind: "toolCall", text: "vite.config.js", name: "read" },
          { role: "user", kind: "toolResult", text: "export default …", name: "read" },
        ],
      },
      "code-explorer",
    );
    expect(out).toHaveLength(1);
    expect(out[0].agent).toBe("code-explorer");
    expect(out[0].finalOutput).toBe("Fourteen files, three entry points.");
    expect(out[0].messages.map((m) => m.role)).toEqual(["assistant", "assistant", "user"]);
    // A text message stays verbatim…
    expect(out[0].messages[0].text).toBe("Reading vite.config.js");
    // …and a tool call reads as its tool name, the same shape traceFromEnd
    // builds from upstream's compact `toolCalls`.
    expect(out[0].messages[1].text).toBe("read vite.config.js");
  });

  it("falls back to the kind when a call carries no tool name", () => {
    const out = inspectToResults({ messages: [{ role: "assistant", kind: "toolCall", text: "x" }] }, "worker");
    expect(out[0].messages[0].text).toBe("toolCall x");
  });

  it("returns nothing rather than an empty card when there is nothing to show", () => {
    expect(inspectToResults({}, "worker")).toEqual([]);
    expect(inspectToResults({ messages: [] }, "worker")).toEqual([]);
    expect(inspectToResults({ finalOutput: "   " }, "worker")).toEqual([]);
  });

  it("keeps a final output with no transcript", () => {
    const out = inspectToResults({ finalOutput: "done" }, "worker");
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual([]);
    expect(out[0].finalOutput).toBe("done");
  });
});

describe("the card fetches only when it has to", () => {
  const src = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  const card = src.slice(src.indexOf("function SubagentCard"), src.indexOf("export function SubagentTraceView"));

  it("found a SubagentCard body to scan", () => {
    // Guards the negative assertions below from passing vacuously.
    expect(card.length).toBeGreaterThan(2000);
  });

  it("calls subagentInspect", () => {
    expect(card).toContain("window.hv.subagentInspect(sessionId, asyncId)");
  });

  it("fetches on expand, not on mount", () => {
    // The whole reason this route is affordable: it costs no model turn but it
    // does cost an RPC round trip and a 10s timeout, per card, per transcript.
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("if (!open ");
  });

  it("does not fetch a run that already streamed its transcript in", () => {
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("results.length > 0");
  });

  it("only fetches an ASYNC run — a foreground one has no asyncId to inspect", () => {
    const eff = card.slice(0, card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("!asyncId");
  });

  it("names a foreign-session refusal instead of spinning", () => {
    // Inspection is scoped to the CURRENT session's children, so a respawn
    // legitimately answers foreign_session. A card that never hears back spins
    // forever, which is the failure this route was built to avoid.
    expect(card).toContain("inspectError");
    expect(card).toContain("foreign_session");
  });

  it("drops what it read on collapse rather than caching it", () => {
    // Reopening a run must show what it says NOW, not what it said then — the
    // same rule the run card's thinking view follows.
    const eff = card.slice(card.indexOf("const [inspected"), card.indexOf("window.hv.subagentInspect"));
    expect(eff).toContain("setInspected(null)");
  });
});

describe("sessionId reaches the card the same way workspace does", () => {
  const t = readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");

  it("Transcript takes it and hands it to ToolCard", () => {
    expect(t).toMatch(/sessionId\?: string \| null;/);
    expect(t).toContain("<ToolCard card={it.card} workspace={workspace} sessionId={sessionId} onOpenFile={onOpenFile} />");
  });

  it("Transcript passes it through the memoized row", () => {
    // MessageItem is memo'd — a prop that never reaches it silently arrives as
    // undefined and the fetch never fires.
    expect(t).toMatch(/<MessageItem[\s\S]{0,300}sessionId=\{sessionId\}/);
  });

  it("ChatView supplies it", () => {
    expect(chat).toMatch(/<Transcript[\s\S]{0,2000}sessionId=\{sessionId\}/);
  });
});
