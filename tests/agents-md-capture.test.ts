/**
 * WS5: parseAgentsMdOutput — the agents-md-maker structured-output contract.
 * The parser is lenient about surrounding prose (find the tagged fence) but
 * strict about paths (relative, no escape, basename AGENTS.md).
 */
import { expect, test } from "vitest";
import { parseAgentsMdOutput } from "../src/renderer/src/agents";

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
