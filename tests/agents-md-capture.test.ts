/**
 * WS5 + §15 round 21: the agents-md-maker structured-output contract, and the
 * reader that gets its FULL answer out of the child's own session file.
 *
 * The parser is lenient about surrounding prose (find the tagged fence) but
 * strict about paths (relative, no escape, basename AGENTS.md).
 *
 * It MOVED from the renderer to main in round 21, because main is now the
 * writer on every surface — the renderer copy had exactly one caller (a
 * dialog), which is why a draft run from chat was never written at all.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { finalTextFromSessionFile, parseAgentsMdOutput } from "../src/main/agentsMd";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
const line = (role: string, content: unknown): string => JSON.stringify({ type: "message", message: { role, content } });

const fence = (body: string): string => "prose before\n```json agents-md\n" + body + "\n```\nprose after";

test("parses root + nested files from the tagged fence amid prose", () => {
  const out = parseAgentsMdOutput(fence('{"files": {"AGENTS.md": "# root", "packages/api/AGENTS.md": "# api"}}'));
  expect(out).toEqual({ "AGENTS.md": "# root", "packages/api/AGENTS.md": "# api" });
});

test("normalizes ./ prefixes and backslashes", () => {
  const out = parseAgentsMdOutput(fence('{"files": {"./AGENTS.md": "# root", "pkg\\\\AGENTS.md": "# pkg"}}'));
  expect(out).toEqual({ "AGENTS.md": "# root", "pkg/AGENTS.md": "# pkg" });
});

test("rejects path escapes and non-AGENTS.md basenames", () => {
  const out = parseAgentsMdOutput(
    fence('{"files": {"AGENTS.md": "ok", "../evil/AGENTS.md": "no", "/etc/AGENTS.md": "no", "src/notes.md": "no"}}'),
  );
  expect(out).toEqual({ "AGENTS.md": "ok" });
});

test("returns null when there is no tagged fence (caller falls back to root draft)", () => {
  expect(parseAgentsMdOutput("just some markdown, no fence")).toBeNull();
  expect(parseAgentsMdOutput("```json\n{\"files\":{}}\n```")).toBeNull(); // untagged fence
});

test("returns null on malformed JSON or empty/invalid files map", () => {
  expect(parseAgentsMdOutput(fence("{not json"))).toBeNull();
  expect(parseAgentsMdOutput(fence('{"files": {}}'))).toBeNull();
  expect(parseAgentsMdOutput(fence('{"files": []}'))).toBeNull();
  expect(parseAgentsMdOutput(fence('{"nope": 1}'))).toBeNull();
});

// ── §15 round 21: the untruncated source, and who writes ───────────────────

test("the child's final answer is the LAST assistant message's text blocks", () => {
  const jsonl = [
    line("user", [{ type: "text", text: "draft it" }]),
    line("assistant", [{ type: "thinking", thinking: "let me look" }, { type: "toolCall", name: "ls" }]),
    line("assistant", [{ type: "text", text: '```json agents-md\n{"files":{"AGENTS.md":"# p"}}\n```' }]),
  ].join("\n");
  expect(parseAgentsMdOutput(finalTextFromSessionFile(jsonl))).toEqual({ "AGENTS.md": "# p" });
});

test("several text blocks in the final message are joined", () => {
  expect(finalTextFromSessionFile(line("assistant", [{ type: "text", text: "a" }, { type: "text", text: "b" }]))).toBe("ab");
});

test("thinking and toolCall blocks are not part of the answer", () => {
  const jsonl = line("assistant", [
    { type: "thinking", thinking: "secret" },
    { type: "toolCall", name: "read", arguments: { path: "x" } },
    { type: "text", text: "answer" },
  ]);
  expect(finalTextFromSessionFile(jsonl)).toBe("answer");
});

test("an assistant message with no text falls back to the previous one", () => {
  // A child whose last turn was pure tool calls still has an answer earlier.
  const jsonl = [
    line("assistant", [{ type: "text", text: "the answer" }]),
    line("assistant", [{ type: "toolCall", name: "ls" }]),
  ].join("\n");
  expect(finalTextFromSessionFile(jsonl)).toBe("the answer");
});

test("a plain-string content is read too", () => {
  expect(finalTextFromSessionFile(line("assistant", "just a string"))).toBe("just a string");
});

test("a torn last line is skipped, not thrown", () => {
  // The file is appended live; the tail can be half-written.
  const jsonl = line("assistant", [{ type: "text", text: "ok" }]) + '\n{"type":"mes';
  expect(finalTextFromSessionFile(jsonl)).toBe("ok");
});

test("nothing at all yields the empty string, never a throw", () => {
  expect(finalTextFromSessionFile(null)).toBe("");
  expect(finalTextFromSessionFile("")).toBe("");
  expect(finalTextFromSessionFile(line("user", [{ type: "text", text: "hi" }]))).toBe("");
});

test("the renderer no longer parses the draft — main does", () => {
  expect(read("src/renderer/src/agents.ts")).not.toContain("parseAgentsMdOutput");
  const panel = read("src/renderer/src/components/AgentsMdPanel.tsx");
  expect(panel).not.toContain("parseAgentsMdOutput");
  expect(panel).not.toContain("writeAgentsMdFiles");
  // It listens for the write instead of doing it.
  expect(panel).toContain("onAgentsMdWritten");
});

test("main writes on the ASYNC completion path — the one that actually fires", () => {
  const ipc = read("src/main/ipc.ts");
  const at = ipc.indexOf('sub.stage === "complete"');
  expect(at).toBeGreaterThan(-1);
  const block = ipc.slice(at, at + 3500);
  expect(block).toContain("agents-md-maker");
  expect(block).toContain("writeAgentsMdFiles");
  // It reads the child's SESSION FILE, not the notify: the notify's summary is
  // capped at 500 chars in the bridge and would truncate a real draft.
  expect(block).toContain("finalTextFromSessionFile");
});
