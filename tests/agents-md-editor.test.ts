import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * §15 round 21 — the AGENTS.md dialog becomes the editor a file tab already is.
 *
 * Source scan: the renderer suite has no DOM, and what matters is that this
 * surface REUSES the file tab's editor, switcher and preview rather than
 * growing near-copies that drift.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
const panel = (): string => read("src/renderer/src/components/AgentsMdPanel.tsx");

test("the textarea is gone — this is the same editor a file tab uses", () => {
  const src = panel();
  expect(src).not.toContain("<textarea");
  expect(src).toContain('lazy(() => import("./EditorPane"))');
  expect(src).toContain("<Suspense");
});

test("it reuses FileTab's own switcher glyphs rather than drawing new ones", () => {
  // Two icon sets for one control is how two surfaces come to look different.
  expect(panel()).toMatch(/import \{[^}]*CodeGlyph[^}]*\} from "\.\/FileTab"/s);
  expect(panel()).toMatch(/import \{[^}]*EyeGlyph[^}]*\} from "\.\/FileTab"/s);
  const ft = read("src/renderer/src/components/FileTab.tsx");
  expect(ft).toMatch(/export function CodeGlyph/);
  expect(ft).toMatch(/export function EyeGlyph/);
});

test("preview renders markdown with GFM, like the file tab", () => {
  const src = panel();
  expect(src).toContain('from "react-markdown"');
  expect(src).toContain("remarkGfm");
  expect(src).toContain('className="md');
});

test("an EXISTING file opens on preview; a missing one opens on source", () => {
  // Nothing to preview and something to write.
  const src = panel();
  expect(src).toMatch(/useState<"rendered" \| "raw">/);
  expect(src).toMatch(/setView\(c === null \? "raw" : "rendered"\)/);
});

test("the editor's document is replaced by version, not by a controlled value", () => {
  // CodeMirror is uncontrolled between versions; a drafted file must bump it or
  // the editor keeps showing the old buffer.
  const src = panel();
  expect(src).toContain("docVersion={docVersion}");
  expect(src).toMatch(/setDocVersion\(\(v\) => v \+ 1\)/);
});

test("the keymap comes from the shortcut registry, not a hardcoded key", () => {
  const src = panel();
  expect(src).toContain("saveKey={saveKey}");
  expect(src).toContain("searchKey={searchKey}");
  const app = read("src/renderer/src/App.tsx");
  const at = app.indexOf("<AgentsMdPanel");
  expect(app.slice(at, at + 700)).toMatch(/saveKey=\{bindings\.save\}/);
});
