import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * PRD §30. The convention is only self-enforcing if something asserts it, and
 * the load-bearing one is the FIRST test below: the top released entry must
 * equal `package.json`'s version, so a version cannot ship with no notes.
 *
 * Key-free by construction — it reads three files and nothing else, so it runs
 * in the non-live suite and in CI.
 */
const ROOT = path.join(__dirname, "..");
const MD = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const PKG = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };

/** Every `## [x.y.z] — YYYY-MM-DD` (or `## [Unreleased]`) heading, in file order. */
function headings(): Array<{ version: string; date: string | null }> {
  const out: Array<{ version: string; date: string | null }> = [];
  for (const line of MD.split("\n")) {
    const m = /^## \[([^\]]+)\](?:\s+[—-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (m) out.push({ version: m[1], date: m[2] ?? null });
  }
  return out;
}

const cmp = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe("CHANGELOG.md — PRD §30", () => {
  const hs = headings();

  it("has at least one entry", () => {
    expect(hs.length).toBeGreaterThan(0);
  });

  // §30's invariant: a version cannot ship with no notes.
  it("the top RELEASED entry equals package.json's version", () => {
    const released = hs.filter((h) => h.version !== "Unreleased");
    expect(released.length).toBeGreaterThan(0);
    expect(released[0].version).toBe(PKG.version);
  });

  it("every released version is valid semver and the list strictly descends", () => {
    const released = hs.filter((h) => h.version !== "Unreleased").map((h) => h.version);
    for (const v of released) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    for (let i = 1; i < released.length; i++) {
      expect(cmp(released[i - 1], released[i])).toBeGreaterThan(0);
    }
  });

  it("every released entry carries a date, and only the TOP heading may be Unreleased", () => {
    hs.forEach((h, i) => {
      if (h.version === "Unreleased") expect(i).toBe(0);
      else expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // Rule 1 of the voice, enforced mechanically: no conventional-commit prose.
  it("contains no conventional-commit prose", () => {
    const offenders = MD.split("\n").filter((l) =>
      /^\s*[-*]\s*(feat|fix|chore|docs|refactor|test|perf|style|ci)\s*[(:]/.test(l),
    );
    expect(offenders).toEqual([]);
  });

  // Rule 5: the runtime pins line is the ONE piece of technical detail that
  // stays, because §3's promise IS the pinned runtime — so it has to match what
  // is actually vendored, not what someone typed once.
  it("names the runtime pins currently vendored", () => {
    const d = JSON.parse(readFileSync(path.join(ROOT, "pi-runtime", "package.json"), "utf8"))
      .dependencies as Record<string, string>;
    const line =
      `Runtime: Pi ${d["@earendil-works/pi-coding-agent"]}` +
      ` · sub-agents ${d["pi-subagents"]}` +
      ` · MCP adapter ${d["pi-mcp-adapter"]}`;
    expect(MD).toContain(line);
  });
});
