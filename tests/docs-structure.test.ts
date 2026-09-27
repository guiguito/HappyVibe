import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GROUPS, NAV } from "../src/renderer/src/components/Sidebar";
import { DOC_SLUG } from "../src/renderer/src/docsLinks";

/**
 * Docs round (2026-09-28): the guide's sidebar mirrors the app's, so a reader
 * never learns a second structure, and a screen added to the app without a
 * guide page fails here by name.
 */
const GUIDE = path.join(import.meta.dirname, "..", "docs", "guide");
type Item = string | { label: string; items: string[] };
const SIDEBAR: Item[] = JSON.parse(fs.readFileSync(path.join(GUIDE, "sidebar.json"), "utf8"));
const group = (label: string): string[] =>
  (SIDEBAR.find((i) => typeof i !== "string" && i.label === label) as { items: string[] }).items;
const title = (slug: string): string => {
  const file = path.join(GUIDE, "src", "content", "docs", `${slug}.md`);
  if (!fs.existsSync(file)) return `(no page at ${slug}.md)`;
  return fs.readFileSync(file, "utf8").match(/^title: (.+)$/m)?.[1] ?? "(no title)";
};

describe("the guide mirrors the app's sidebar (Docs round, 2026-09-28)", () => {
  it("Get started first, then Models pinned, then the app's groups in order", () => {
    expect(SIDEBAR.map((i) => (typeof i === "string" ? i : i.label))).toEqual([
      "Get started",
      "models",
      ...GROUPS.map((g) => g.label),
    ]);
  });

  it("each group lists its screens in the app's order", () => {
    for (const g of GROUPS) {
      expect(group(g.label), g.label).toEqual(NAV.filter((n) => n.group === g.id).map((n) => DOC_SLUG[n.view]));
    }
  });

  it("every screen's page exists and is titled with the screen's label", () => {
    for (const n of NAV) expect(title(DOC_SLUG[n.view]!), n.view).toBe(n.label);
  });

  it("Get started holds the five pages the spec names", () => {
    expect(group("Get started")).toEqual(["install", "first-launch", "connect-a-model", "first-session", "approve-a-tool-call"]);
  });
});
