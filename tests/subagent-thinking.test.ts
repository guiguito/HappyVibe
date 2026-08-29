import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readChildTrace } from "../src/main/subagentThinking";

/**
 * PRD §12 (2026-08-29, the fleet round) — a sub-agent's own reasoning.
 *
 * The confinement root here is the app's SESSIONS dir, not os.tmpdir():
 * pi-subagents writes `subagent-artifacts/` flat into our own session directory
 * (store.ts ARTIFACT_DIR). Reusing subagentStatus.ts's tmpdir guard would
 * return nothing at all, silently — which looks exactly like "this run had no
 * thinking", so the wrong guard would ship green.
 */
function mkTranscript(root: string, lines: unknown[], name = "run_worker_0_transcript.jsonl"): string {
  const dir = path.join(root, "subagent-artifacts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

describe("readChildTrace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));

  it("returns the child's thinking blocks, in order", () => {
    const file = mkTranscript(root, [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "first I read the file" }, { type: "text", text: "reading" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "now I write the report" }] },
    ]);
    expect(readChildTrace(root, file).filter((r) => r.kind === "thinking").map((r) => r.text)).toEqual(["first I read the file", "now I write the report"]);
  });

  it("reads a record that nests its content under `message`", () => {
    // Pi's session JSONL uses both shapes depending on the record type; a reader
    // that handles only one returns an empty list for half the transcripts.
    const file = mkTranscript(root, [
      { recordType: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "nested" }] } },
    ], "nested_transcript.jsonl");
    expect(readChildTrace(root, file).map((r) => r.text)).toEqual(["nested"]);
  });

  it("refuses a path outside the sessions root", () => {
    // The path arrives from an upstream payload, so it is confined on principle
    // — the same discipline as readSubagentStatus, against a different root.
    expect(readChildTrace(root, "/etc/passwd")).toEqual([]);
    expect(readChildTrace(root, path.join(root, "..", "elsewhere.jsonl"))).toEqual([]);
  });

  it("refuses a prefix-collision sibling of the root", () => {
    // `<root>-evil` starts with `<root>` as a string but is NOT inside it.
    expect(readChildTrace(root, `${root}-evil/x.jsonl`)).toEqual([]);
  });

  it("returns empty rather than throwing on a missing or torn file", () => {
    expect(readChildTrace(root, path.join(root, "subagent-artifacts", "nope.jsonl"))).toEqual([]);
    const torn = mkTranscript(root, [], "torn_transcript.jsonl");
    // A half-written last line is NORMAL while the child is still working.
    fs.writeFileSync(torn, '{"role":"assistant","content":[{"type":"thinking","thinking":"kept"}]}\n{"role":"assist');
    expect(readChildTrace(root, torn).map((r) => r.text)).toEqual(["kept"]);
  });

  it("survives a transcript with no thinking at all", () => {
    const file = mkTranscript(root, [{ role: "assistant", content: [{ type: "text", text: "done" }] }], "plain_transcript.jsonl");
    expect(readChildTrace(root, file)).toEqual([]);
  });

  it("skips blank and whitespace-only thinking blocks", () => {
    const file = mkTranscript(root, [
      { role: "assistant", content: [{ type: "thinking", thinking: "   " }, { type: "thinking", thinking: "real" }] },
    ], "blank_transcript.jsonl");
    expect(readChildTrace(root, file).map((r) => r.text)).toEqual(["real"]);
  });
});

/**
 * The interleaving is the point (§12, 2026-08-29 round 2). Measured on a real
 * child transcript: ONE assistant record carries its thinking block and the
 * toolCall blocks that thought produced, in that order —
 *
 *   record 2  message/assistant  THINK[33], CALL:ls, CALL:read
 *
 * so reasoning can be shown against the actions it explains rather than piled
 * at the top of the card, and one source replaces two (transcript + the status
 * file's recentTools).
 */
describe("readChildTrace interleaving", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-trace-"));

  it("keeps thinking and the calls it produced in transcript order", () => {
    const file = mkTranscript(root, [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "first look around" },
        { type: "toolCall", name: "ls", arguments: { path: "/repo" } },
        { type: "toolCall", name: "read", arguments: { path: "/repo/AGENTS.md" } },
      ] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "now report" },
        { type: "toolCall", name: "grep", arguments: { pattern: "TODO" } },
      ] },
    ], "interleave_transcript.jsonl");
    expect(readChildTrace(root, file)).toEqual([
      { kind: "thinking", text: "first look around" },
      { kind: "call", name: "ls", text: "/repo" },
      { kind: "call", name: "read", text: "/repo/AGENTS.md" },
      { kind: "thinking", text: "now report" },
      { kind: "call", name: "grep", text: "TODO" },
    ]);
  });

  it("drops tool RESULTS — they are ~95% of the bytes and the card is not a transcript", () => {
    const file = mkTranscript(root, [
      { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "a.ts" } }] },
      { role: "toolResult", content: [{ type: "text", text: "x".repeat(18_000) }] },
    ], "noresults_transcript.jsonl");
    expect(readChildTrace(root, file)).toEqual([{ kind: "call", name: "read", text: "a.ts" }]);
  });

  it("summarizes a call by the argument that says what it touched", () => {
    const file = mkTranscript(root, [
      { role: "assistant", content: [
        { type: "toolCall", name: "bash", arguments: { command: "npm test" } },
        { type: "toolCall", name: "weird", arguments: { unknownKey: 1 } },
        { type: "toolCall", name: "noargs" },
      ] },
    ], "args_transcript.jsonl");
    expect(readChildTrace(root, file)).toEqual([
      { kind: "call", name: "bash", text: "npm test" },
      { kind: "call", name: "weird", text: "" },
      { kind: "call", name: "noargs", text: "" },
    ]);
  });

  it("truncates a very long argument rather than wrapping the card", () => {
    const file = mkTranscript(root, [
      { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "x".repeat(400) } }] },
    ], "longarg_transcript.jsonl");
    const row = readChildTrace(root, file)[0];
    expect(row.text.length).toBe(120);
    expect(row.text.endsWith("…")).toBe(true);
  });

  it("keeps the TAIL when a run is pathologically long", () => {
    // Newest work is what someone watching a live run is reading.
    const blocks = Array.from({ length: 500 }, (_, i) => ({ type: "toolCall", name: `t${i}`, arguments: {} }));
    const file = mkTranscript(root, [{ role: "assistant", content: blocks }], "huge_transcript.jsonl");
    const rows = readChildTrace(root, file);
    expect(rows).toHaveLength(400);
    expect(rows[rows.length - 1].name).toBe("t499");
  });
});
