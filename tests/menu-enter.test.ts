import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2 (Animations round, 2026-09-10) — every menu enters from its anchor, and
 * they all share ONE class so the timing cannot drift between them.
 *
 * The value of this test is the menu nobody has written yet. So it does not
 * hold a list of sites (a list is the thing that rots — §20 Principle 11, and
 * the live-test count in CLAUDE.md that drifted twice): it DERIVES what a menu
 * is from the idiom this app actually uses, and fails on any new one.
 *
 * A menu here is: a floating element (`absolute`/`fixed`) with the app's panel
 * chrome (`shadow-sticker-lg` or `shadow-pop`) that is either anchored to its
 * trigger (`top-full` / `bottom-full`) or is a pointer-positioned context menu
 * (`fixed` + `z-50` + `min-w-`). That deliberately excludes the drawer, the
 * dialogs, the toasts and the in-pane toolbars, which are not menus and have
 * their own motion.
 */
const CLASS_ATTR = /className=(\{`|\{"|"|`)/g;

/**
 * The RAW text of every `className` value in a file, including the branches of
 * a ternary inside a template literal — `ModelSelect` picks `bottom-full` or
 * `top-full` that way, and a naive quote-to-quote scan stops at the first inner
 * `"` and would silently classify it as "not a menu".
 */
function classStrings(src: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  for (const m of src.matchAll(CLASS_ATTR)) {
    const braced = m[1].startsWith("{");
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (braced) {
        if (c === "{") depth++;
        else if (c === "}" && depth === 0) break;
        else if (c === "}") depth--;
        else if ((c === "`" || c === '"') && depth === 0 && src[i - 1] !== "\\") {
          // closing quote of the value itself, followed by the attribute's `}`
          const rest = src.slice(i + 1, i + 3);
          if (rest.trimStart().startsWith("}")) break;
        }
      } else if (c === m[1] && src[i - 1] !== "\\") break;
    }
    out.push({ text: src.slice(m.index, i), line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

const isMenu = (c: string): boolean => {
  const floating = /\babsolute\b|\bfixed\b/.test(c);
  const chrome = c.includes("shadow-sticker-lg") || c.includes("shadow-pop");
  const anchored = c.includes("top-full") || c.includes("bottom-full");
  const contextMenu = c.includes("fixed") && c.includes("z-50") && c.includes("min-w-");
  return floating && chrome && (anchored || contextMenu);
};

const tsxFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(full));
    else if (e.name.endsWith(".tsx")) out.push(full);
  }
  return out;
};

const FILES = tsxFiles(path.join(process.cwd(), "src/renderer/src"));

describe("menus enter from their anchor (B2)", () => {
  it("finds the menus at all — a scan that matches nothing passes vacuously", () => {
    const n = FILES.flatMap((f) => classStrings(fs.readFileSync(f, "utf8"))).filter((c) => isMenu(c.text)).length;
    expect(n).toBeGreaterThanOrEqual(12);
  });

  it("every one of them carries hv-menu-in", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      for (const c of classStrings(fs.readFileSync(f, "utf8"))) {
        if (isMenu(c.text) && !c.text.includes("hv-menu-in")) {
          missing.push(`${path.relative(process.cwd(), f)}:${c.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every one of them names its own transform-origin", () => {
    // The class cannot set it: only the call site knows whether the menu drops
    // down or opens upward, and scaling from the wrong corner reads as the menu
    // sliding rather than unfolding from the thing you clicked.
    const missing: string[] = [];
    for (const f of FILES) {
      for (const c of classStrings(fs.readFileSync(f, "utf8"))) {
        if (isMenu(c.text) && !/\borigin-(top|bottom)-(left|right)\b/.test(c.text)) {
          missing.push(`${path.relative(process.cwd(), f)}:${c.line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("the stylesheet leaves transform-origin to the call sites", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/styles.css"), "utf8");
    const block = css.slice(css.indexOf(".hv-menu-in {"), css.indexOf("}", css.indexOf(".hv-menu-in {")));
    expect(block).not.toContain("transform-origin");
  });

  it("the run rail's two surfaces are NOT menus and keep their own timing (A3)", () => {
    // The overlay grows from the circle that opened it (160 ms) and the hover
    // readout has no exit at all, because the STOP inside it must never be
    // reachable late. Folding either into the shared menu class would silently
    // change both.
    const chat = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components/ChatView.tsx"), "utf8");
    const overlay = chat.slice(chat.indexOf("RUN_RAIL_OVERLAY ="), chat.indexOf("RUN_RAIL_OVERLAY =") + 160);
    expect(overlay).not.toContain("hv-menu-in");
  });
});
