import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { modKey } from "../src/renderer/src/platformCopy";
import { formatBinding } from "../src/renderer/src/shortcuts";

/**
 * PRD §4 (Windows round), key-free — the renderer suite has no DOM, so a visual
 * contract is pinned as data plus a source scan (CLAUDE.md's rule).
 *
 * Shortcut MATCHING already collapsed ⌘/Ctrl to `Mod`, so bindings worked on Windows
 * from the start. What did not travel was the printed text: `formatBinding` defaulted
 * to `mac = true` and every call site omits the argument, so the Shortcuts page, the
 * tab strip's `+` menu and half a dozen tooltips all named a key that is not on the
 * keyboard.
 *
 * The scan is the half that rots: a new `⌘` typed into a tooltip next year is exactly
 * the regression this exists to catch, and an absence cannot be screenshotted.
 */
const SRC = path.join(__dirname, "..", "src", "renderer", "src");

/** Files where the glyph is legitimately spelled out. */
const ALLOW = new Set([
  "platformCopy.ts", // defines it
  "shortcuts.ts", // formatBinding's mac branch
  "voice/useDictation.ts", // already platform-branched, and a press-and-hold, not a binding
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Source with comments removed — an explanatory ⌘ in a comment is fine. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("modKey", () => {
  it("is ⌘ on darwin and Ctrl everywhere else", () => {
    expect(modKey("darwin")).toBe("⌘");
    expect(modKey("win32")).toBe("Ctrl");
    expect(modKey("linux")).toBe("Ctrl");
  });
});

describe("formatBinding", () => {
  it("still renders both forms when told which", () => {
    expect(formatBinding("Mod-k", true)).toContain("⌘");
    expect(formatBinding("Mod-k", false)).toContain("Ctrl");
  });

  it("defaults to the running platform rather than to Mac", () => {
    // The whole bug: every call site omits the argument.
    const src = code(path.join(SRC, "shortcuts.ts"));
    expect(src).toMatch(/formatBinding\(binding: string, mac = IS_MAC\)/);
    expect(src, "a hardcoded default is the regression").not.toMatch(/mac = true/);
  });
});

describe("no literal ⌘ survives in rendered copy", () => {
  it("scans every renderer source file", () => {
    const offenders = walk(SRC)
      .filter((f) => !ALLOW.has(path.relative(SRC, f).split(path.sep).join("/")))
      .filter((f) => code(f).includes("⌘"))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(offenders, "use MOD from platformCopy instead").toEqual([]);
  });

  it("and the allowlist is exactly the three places it belongs", () => {
    // Kept small deliberately: each entry is a place the glyph is CHOSEN, not typed.
    expect([...ALLOW].sort()).toEqual(["platformCopy.ts", "shortcuts.ts", "voice/useDictation.ts"]);
  });
});
