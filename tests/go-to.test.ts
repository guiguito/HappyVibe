import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GOTO_LABELS } from "../src/renderer/src/components/GoTo";

/**
 * §20 round 17 — every cross-page pointer is a link.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const rendered = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("GOTO_LABELS", () => {
  it("every label is the word the sidebar uses", () => {
    // Asserted against Sidebar's SOURCE, not against NAV as an import — the
    // point is to catch a NAV label renamed without its pointers noticing, and
    // an import would make that tautological.
    const nav = rendered(path.join(R, "components/Sidebar.tsx"));
    for (const [view, label] of Object.entries(GOTO_LABELS)) {
      expect(nav, `${view} → ${label}`).toContain(`label: "${label}"`);
    }
  });

  it("covers the destinations the retired phrasings pointed at", () => {
    for (const v of ["models", "permissions", "skills", "promptTemplates"]) {
      expect(Object.keys(GOTO_LABELS)).toContain(v);
    }
  });
});

describe("the five old phrasings are retired", () => {
  const DEAD = [
    "the gear in the sidebar",
    "(Settings → Permissions)",
    "in the Global skills view",
    "configure a provider in Settings",
    "settings from the sidebar",
    // A sixth the audit missed, found while implementing: the cost panel's
    // unknown-price banner pointed at a settings page in prose too.
    "Settings → Custom endpoint",
  ];

  it("none of them survives in rendered source", () => {
    const hits: string[] = [];
    for (const f of tsxFiles(R)) {
      const src = rendered(f);
      for (const d of DEAD) if (src.includes(d)) hits.push(`${path.basename(f)}: ${d}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("navigation is a single callback, not scattered setView calls", () => {
  it("App provides the context", () => {
    const app = rendered(path.join(R, "App.tsx"));
    expect(app).toContain("NavContext.Provider");
  });

  it("navigate opens the settings group, the way ⌘, does", () => {
    // A settings page renders on activeView alone, but landing there with the
    // sidebar's Settings group still collapsed means arriving somewhere with no
    // visible sign of where you are.
    const app = rendered(path.join(R, "App.tsx"));
    const fn = app.slice(app.indexOf("const navigate ="), app.indexOf("const navigate =") + 600);
    expect(fn).toContain("setSettingsOpen");
    expect(fn).toContain("setWsSettings");
  });
});
