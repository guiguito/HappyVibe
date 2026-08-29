import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readChildThinking } from "../src/main/subagentThinking";

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

describe("readChildThinking", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sessions-"));

  it("returns the child's thinking blocks, in order", () => {
    const file = mkTranscript(root, [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "first I read the file" }, { type: "text", text: "reading" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "now I write the report" }] },
    ]);
    expect(readChildThinking(root, file)).toEqual(["first I read the file", "now I write the report"]);
  });

  it("reads a record that nests its content under `message`", () => {
    // Pi's session JSONL uses both shapes depending on the record type; a reader
    // that handles only one returns an empty list for half the transcripts.
    const file = mkTranscript(root, [
      { recordType: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "nested" }] } },
    ], "nested_transcript.jsonl");
    expect(readChildThinking(root, file)).toEqual(["nested"]);
  });

  it("refuses a path outside the sessions root", () => {
    // The path arrives from an upstream payload, so it is confined on principle
    // — the same discipline as readSubagentStatus, against a different root.
    expect(readChildThinking(root, "/etc/passwd")).toEqual([]);
    expect(readChildThinking(root, path.join(root, "..", "elsewhere.jsonl"))).toEqual([]);
  });

  it("refuses a prefix-collision sibling of the root", () => {
    // `<root>-evil` starts with `<root>` as a string but is NOT inside it.
    expect(readChildThinking(root, `${root}-evil/x.jsonl`)).toEqual([]);
  });

  it("returns empty rather than throwing on a missing or torn file", () => {
    expect(readChildThinking(root, path.join(root, "subagent-artifacts", "nope.jsonl"))).toEqual([]);
    const torn = mkTranscript(root, [], "torn_transcript.jsonl");
    // A half-written last line is NORMAL while the child is still working.
    fs.writeFileSync(torn, '{"role":"assistant","content":[{"type":"thinking","thinking":"kept"}]}\n{"role":"assist');
    expect(readChildThinking(root, torn)).toEqual(["kept"]);
  });

  it("survives a transcript with no thinking at all", () => {
    const file = mkTranscript(root, [{ role: "assistant", content: [{ type: "text", text: "done" }] }], "plain_transcript.jsonl");
    expect(readChildThinking(root, file)).toEqual([]);
  });

  it("skips blank and whitespace-only thinking blocks", () => {
    const file = mkTranscript(root, [
      { role: "assistant", content: [{ type: "thinking", thinking: "   " }, { type: "thinking", thinking: "real" }] },
    ], "blank_transcript.jsonl");
    expect(readChildThinking(root, file)).toEqual(["real"]);
  });
});
