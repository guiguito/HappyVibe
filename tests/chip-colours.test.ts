import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { CHIP_TONE } from "../src/renderer/src/components/ChatView";

/**
 * §7 round 21 — the session-resource chips each get their own colour.
 *
 * The renderer suite has no DOM, so the mapping is pinned as DATA and the
 * absences (a colour that means something else, an undefined token) are pinned
 * by scanning the palette and the source.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("skills, agents and MCP each get a DIFFERENT fill", () => {
  const tones = [CHIP_TONE.skills, CHIP_TONE.agents, CHIP_TONE.mcp];
  expect(new Set(tones).size).toBe(3);
  for (const t of tones) expect(t).toMatch(/^bg-\w+-soft text-\w+$/);
});

test("skills keeps plum — it was already coloured and the colour means skills", () => {
  expect(CHIP_TONE.skills).toBe("bg-plum-soft text-plum");
});

test("no chip borrows a colour that already means something else", () => {
  // leaf = success, berry = danger, sky = plan mode. Reusing one makes a
  // resource chip look like a state.
  for (const t of Object.values(CHIP_TONE)) {
    for (const name of ["leaf", "berry", "sky"]) expect(t).not.toContain(name);
  }
});

test("every colour a chip names is DEFINED in the palette", () => {
  // A Tailwind class for an undefined variable renders with no fill and no
  // error — exactly how `bg-plum` shipped unstyled for several rounds.
  const css = read("src/renderer/src/styles.css");
  for (const t of Object.values(CHIP_TONE)) {
    for (const cls of t.split(" ")) {
      const name = cls.replace(/^(bg|text)-/, "");
      expect(css, `--color-${name} must exist for ${cls}`).toContain(`--color-${name}:`);
    }
  }
});

test("the model and thinking chips stay the neutral mono pair", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  // Both are `font-mono … border-2 border-line bg-card` — the read-me pair.
  expect(src.match(/font-mono text-\[11px\] rounded-full border-2 border-line bg-card/g)?.length).toBe(2);
  // And neither is in the tone map at all.
  expect(Object.keys(CHIP_TONE).sort()).toEqual(["agents", "mcp", "skills"]);
});

test("the agents chip is FILLED, not the outline it used to be", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  const at = src.indexOf("function AgentsChip");
  const body = src.slice(at, at + 1600);
  expect(body).toContain("CHIP_TONE.agents");
  // The 2026-08-30 quiet outline: a single border plus muted ink. An outline is
  // also what an UNDEFINED colour token looks like, so this absence matters.
  expect(body).not.toContain("border border-line text-ink-soft");
});
