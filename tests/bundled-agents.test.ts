import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "yaml";

/**
 * PRD §12 (2026-09-27): every bundled agent obeys the same four rules, so a new
 * agent file inherits them by being a file — nothing to remember to add it to.
 */
const DIR = path.join(process.cwd(), "pi-runtime", "agents");
const TW = path.join(process.cwd(), "pi-runtime", "node_modules", "@tintinweb", "pi-subagents", "src");

// DERIVED the way tintinweb derives BUILTIN_TOOL_NAMES (agent-types.ts: the union of
// Pi's coding and read-only tool sets) — the only names a `tools:` line can name.
const PI_SDK = path.join(process.cwd(), "pi-runtime", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "sdk.js");
const sdk = (await import(pathToFileURL(PI_SDK).href)) as {
  createCodingTools: (cwd: string) => Array<{ name: string }>;
  createReadOnlyTools: (cwd: string) => Array<{ name: string }>;
};
const BUILTINS = new Set([...sdk.createCodingTools("."), ...sdk.createReadOnlyTools(".")].map((t) => t.name));
// …and tintinweb still computes it that way, or this derivation has drifted from what it checks.
const twDerivation = /BUILTIN_TOOL_NAMES: string\[\] = \[\s*\.\.\.new Set\(\[\.\.\.createCodingTools\("\."\), \.\.\.createReadOnlyTools\("\."\)\]/;
const READ_ONLY = new Set(["read", "grep", "find", "ls"]);

const agents = fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => {
  const raw = fs.readFileSync(path.join(DIR, f), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return { file: f, fm: yaml.parse(m?.[1] ?? "") as Record<string, unknown>, body: m?.[2] ?? "" };
});

test("the derivations are not vacuous", () => {
  expect(fs.readFileSync(path.join(TW, "agent-types.ts"), "utf8")).toMatch(twDerivation);
  expect([...BUILTINS].sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
  expect(agents.length).toBe(10);
});

test("the bundled roster (PRD §12, 2026-09-27)", () => {
  expect(agents.map((a) => a.fm.name).sort()).toEqual([
    "agents-md-maker", "code-explorer", "data-analyst", "notes-synthesizer", "plan-critic",
    "reviewer", "security-auditor", "silent-failure-hunter", "technical-writer", "worker",
  ]);
});

for (const a of agents) {
  test(`${a.file}: named, described, tools Pi has`, () => {
    expect(a.fm.name, "name").toBe(a.file.replace(/\.md$/, ""));
    expect(String(a.fm.description ?? "").length, "description").toBeGreaterThan(40);
    const tools = String(a.fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    expect(tools.length, "declares tools").toBeGreaterThan(0);
    for (const t of tools) expect(BUILTINS.has(t), `unknown tool "${t}"`).toBe(true);
  });

  test(`${a.file}: no dead nicobailon key`, () => {
    // tintinweb never reads it (custom-agents.ts) — a key that does nothing reads like a setting.
    expect("inheritGlobalContext" in a.fm).toBe(false);
  });

  test(`${a.file}: a max_turns cap, generous enough not to truncate real work`, () => {
    // Frontmatter is authoritative in tintinweb — the model cannot raise it per call.
    const tools = String(a.fm.tools).split(",").map((t) => t.trim());
    const readOnly = tools.every((t) => READ_ONLY.has(t));
    expect(a.fm.max_turns).toBe(readOnly ? 50 : 80);
  });

  test(`${a.file}: reads the project's AGENTS.md itself`, () => {
    // Every child is built with noContextFiles: true (agent-runner.ts), and replace mode
    // is env header + this body — so nothing else ever shows a child AGENTS.md.
    expect(a.body.slice(0, 600)).toMatch(/AGENTS\.md/);
  });
}
