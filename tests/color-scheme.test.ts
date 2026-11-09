import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, isColorScheme, resolveColorScheme, WINDOW_BACKGROUND } from "../src/main/colorScheme";
import { contrastRatio } from "../src/renderer/src/terminalTheme";

/**
 * Appearance › Theme. Dark is the colour TOKENS redefined in one unlayered rule
 * (`:root[data-theme="dark"]`, styles.css), switched by `data-theme` on the root.
 * No DOM in this suite: the palette is pinned as data (every token has a dark
 * value, and every text colour is measured), the wiring by source scan, and the
 * built CSS when there is one.
 */
const R = path.join(import.meta.dirname, "..", "src");
const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

const styles = read("renderer/src/styles.css");
const theme = read("renderer/src/theme.css");

/** The `--name: value;` declarations of the first rule whose selector is `selector`. */
function decls(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = decls(theme, "@theme static");
const lightExtra = decls(styles, ":root");
const dark = decls(styles, ':root[data-theme="dark"]');
const D = (token: string): string => dark[`--color-${token}`];

describe("theme — the choices", () => {
  it("light, dark and match-system; light is the default, so nobody's app changes on its own", () => {
    expect(COLOR_SCHEMES.map((s) => s.id)).toEqual(["light", "dark", "system"]);
    expect(DEFAULT_COLOR_SCHEME).toBe("light");
  });

  it("anything else is not a theme (a stale or hand-edited config falls back)", () => {
    expect(isColorScheme("system")).toBe(true);
    for (const v of ["Dark", "auto", "", null, undefined, 1]) expect(isColorScheme(v)).toBe(false);
  });

  it("match-system resolves to what the computer says; the others ignore it", () => {
    expect(resolveColorScheme("system", true)).toBe("dark");
    expect(resolveColorScheme("system", false)).toBe("light");
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("dark", false)).toBe("dark");
  });
});

describe("theme — the dark palette", () => {
  it("is unlayered, so it beats Tailwind's theme layer, and tells the browser it is dark", () => {
    const before = styles.slice(0, styles.indexOf(':root[data-theme="dark"]'));
    expect((before.match(/{/g) ?? []).length).toBe((before.match(/}/g) ?? []).length);
    const at = styles.indexOf(':root[data-theme="dark"] {');
    expect(styles.slice(at, styles.indexOf("}", at))).toContain("color-scheme: dark;");
  });

  it("gives EVERY colour token a dark value — a token added to theme.css alone fails here", () => {
    const tokens = Object.keys(light).filter((k) => k.startsWith("--color-"));
    expect(tokens.length).toBeGreaterThan(20);
    for (const t of tokens) expect(dark[t], t).toMatch(/^#[0-9a-f]{6}$/);
    // …and the non-token colours declared beside them (run-rail chips, editor syntax).
    for (const k of Object.keys(lightExtra)) expect(dark[k], k).toBeDefined();
  });

  it("in light, the job-named tokens ARE ink and paper — the light app paints exactly as before", () => {
    expect(light["--color-scrim"]).toBe(light["--color-ink"]);
    expect(light["--color-code"]).toBe(light["--color-ink"]);
    expect(light["--color-code-ink"]).toBe(light["--color-paper"]);
  });

  it("every colour used as text reads at 4.5:1 on every dark surface", () => {
    const surfaces = ["paper", "paper-deep", "card"];
    const text = ["ink", "ink-soft", "tangerine", "tangerine-deep", "honey", "leaf", "berry", "sky", "plum", "teal", "rose"];
    for (const t of text) for (const s of surfaces) expect(contrastRatio(D(t), D(s)), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it("a soft fill keeps its own hue and the ink readable on it", () => {
    for (const c of ["leaf", "berry", "sky", "plum", "teal", "rose"]) {
      expect(contrastRatio(D(c), D(`${c}-soft`)), `${c} on ${c}-soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(D("ink"), D(`${c}-soft`)), `ink on ${c}-soft`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(D("tangerine-deep"), D("honey-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("a label on a solid fill (`text-paper` on a button) is the dark paper, and reads on every fill", () => {
    for (const f of ["tangerine", "berry", "leaf", "sky", "honey", "ink"]) {
      expect(contrastRatio(D("paper"), D(f)), `paper on ${f}`).toBeGreaterThanOrEqual(4.5);
    }
    // Honey stays bright in the dark, so what sits on it (a button, selected text) is the
    // paper, not the inherited ink.
    expect(styles).toMatch(/:root\[data-theme="dark"\] \.bg-honey,\s*:root\[data-theme="dark"\] ::selection \{\s*color: var\(--color-paper\);/);
    expect(styles).toMatch(/::selection \{\s*background: var\(--color-honey\);/);
  });

  it("a code block stays a dark slab, and the editor's syntax reads on the dark card", () => {
    expect(contrastRatio(D("code-ink"), D("code"))).toBeGreaterThanOrEqual(4.5);
    for (const k of ["--syntax-number", "--syntax-property", "--syntax-type", "--syntax-punctuation"]) {
      expect(contrastRatio(dark[k], D("card")), k).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the window's background before the page paints is each scheme's paper", () => {
    expect(WINDOW_BACKGROUND.light).toBe(light["--color-paper"]);
    expect(WINDOW_BACKGROUND.dark).toBe(D("paper"));
  });
});

describe("theme — nothing paints around the tokens", () => {
  const files = (dir: string): string[] =>
    fs.readdirSync(path.join(R, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );
  const renderer = files("renderer/src");

  it("a modal's veil is the scrim, which darkens in both themes (ink would turn it into a light haze)", () => {
    for (const f of renderer) {
      for (const line of read(f).split("\n").filter((l) => l.includes("hv-overlay"))) {
        expect(line, f).not.toMatch(/\bbg-(ink|black)\//);
      }
    }
  });

  it("no Tailwind default palette (it has no dark value) and no white outside the HTML preview", () => {
    for (const f of renderer) {
      const src = read(f);
      expect(src, f).not.toMatch(/\b(bg|text|border|ring)-(red|green|amber|yellow|blue|gray|slate|zinc|stone|neutral|emerald|orange)-\d{2,3}\b/);
      // FileTab's preview renders the user's own HTML document, which expects a white page.
      if (!f.endsWith("FileTab.tsx")) expect(src, f).not.toMatch(/\bbg-white\b/);
    }
  });

  it("the code editor takes its colours from the tokens, not from hex", () => {
    expect(read("renderer/src/components/EditorPane.tsx")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the run rail's computed hue takes its lightness from styles.css", () => {
    expect(read("renderer/src/components/ChatView.tsx")).toContain("hsl(${a.hue} var(--run-chip-bg))");
  });
});

describe("theme — the wiring", () => {
  it("arrives with the boot, applied before the first render, so a dark app never flashes light", () => {
    expect(read("main/index.ts")).toMatch(/e\.returnValue = \{[^}]*colorScheme: getColorScheme\(\)/);
    const main = read("renderer/src/main.tsx");
    const at = main.indexOf("applyColorScheme(window.hv?.boot?.colorScheme)");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(main.indexOf("createRoot("));
  });

  it("Electron's nativeTheme follows it from startup, before the first window", () => {
    const index = read("main/index.ts");
    const set = index.indexOf("nativeTheme.themeSource = getColorScheme()");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(index.indexOf("openWindow({ tabsByWs: {}, ui: {} })", set));
  });

  it("a change is validated, stored, handed to nativeTheme and pushed to every window", () => {
    const ipc = read("main/ipc.ts");
    const h = ipc.slice(ipc.indexOf('"hv:set-color-scheme"'), ipc.indexOf('"hv:set-color-scheme"') + 500);
    expect(h).toContain("isColorScheme(s)");
    expect(h).toContain("setColorScheme(s)");
    expect(h).toContain("nativeTheme.themeSource = s");
    expect(h).toContain('send("hv:color-scheme-changed", s)');
  });

  it("the root carries the RESOLVED scheme, so the CSS never has to know about match-system", () => {
    const a = read("renderer/src/appearance.ts");
    expect(a).toContain("root.dataset.theme = resolveColorScheme(scheme, systemDark?.matches ?? false)");
    expect(a).toMatch(/systemDark\?\.addEventListener\("change"/);
  });

  it("the BUILT stylesheet has the dark rule and the job-named utilities", () => {
    const dir = path.join(import.meta.dirname, "..", "out", "renderer", "assets");
    // Meaningful only after `npm run build`; `npm run gate` builds first.
    if (!fs.existsSync(dir)) return;
    const built = fs.readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(built).toMatch(/:root\[data-theme=["']?dark["']?\]/);
    // CSS escapes the slash: the selector is `.bg-scrim\/40`.
    for (const u of ["bg-scrim\\\\/40", "bg-code", "text-code-ink"]) expect(built, u).toMatch(new RegExp(`\\.${u}\\s*\\{`));
  });
});
