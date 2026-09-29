import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * docs round #19 — the "Include open files and terminals" switch also gates the
 * browser pane's address (ipc.ts, the getOpenFilesContext() block), and its
 * copy never said so. DERIVED: every block sent under that switch must be named
 * by the switch's own words, so a fourth block added there fails here.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
const rendered = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/&apos;/g, "'").replace(/\s+/g, " ");

const SAYS: Record<string, RegExp> = {
  OpenFiles: /which files you currently have open/,
  OpenTerminals: /terminals the agent itself started/,
  OpenBrowser: /address of the browser pane it opened/,
};

test("every block the switch gates is named in the switch's copy", () => {
  const ipc = read("src/main/ipc.ts");
  const start = ipc.indexOf("if (getOpenFilesContext()) {");
  const gate = ipc.slice(start, ipc.indexOf("// §9 rewind: the snapshot", start));
  const blocks = [...gate.matchAll(/\bbuild(\w+)Block\(/g)].map((m) => m[1]);
  expect(start).toBeGreaterThan(-1);
  expect([...new Set(blocks)].sort()).toEqual(Object.keys(SAYS).sort());

  const view = read("src/renderer/src/components/SystemPromptView.tsx");
  const toggle = rendered(view.slice(view.indexOf("function OpenFilesToggle")));
  for (const b of blocks) expect(toggle, b).toMatch(SAYS[b]);
  expect(toggle).toMatch(/never the page itself/);
});
