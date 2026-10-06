import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Round 25 (sub_fs890g2hq4w5): the round `>_` over the model search box was the
// run rail's terminal circle. Rail container `sticky z-20`, menu `absolute z-20`
// — a tie that the LATER element (the rail) wins. Pin the relationship, not a literal.
const read = (f: string): string => readFileSync(path.join(process.cwd(), f), "utf8");
const zOf = (src: string, marker: string): number => {
  const line = src.split("\n").find((l) => l.includes(marker));
  expect(line, `no line containing ${marker}`).toBeTruthy();
  const m = /\bz-(\d+)\b/.exec(line!);
  expect(m, `no z- class on: ${line}`).toBeTruthy();
  return Number(m![1]);
};

describe("the model menu paints above the run rail", () => {
  test("menu layer > rail layer", () => {
    const menu = zOf(read("src/renderer/src/components/ModelSelect.tsx"), "hv-menu-in absolute");
    const rail = zOf(read("src/renderer/src/components/ChatView.tsx"), "sticky top-0");
    expect(menu).toBeGreaterThan(rail);
  });
  test("and it matches the header's other menus (z-30), never the dialog layer", () => {
    const menu = zOf(read("src/renderer/src/components/ModelSelect.tsx"), "hv-menu-in absolute");
    expect(menu).toBe(30);
  });
});
