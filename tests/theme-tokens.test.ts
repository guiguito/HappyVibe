import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Docs round (2026-09-28): the design tokens live in ONE file that the app and
 * the user guide (docs/guide) both import. `static` makes Tailwind emit every
 * token as a CSS variable, used or not: the guide maps Starlight's colours onto
 * them and would silently fall back to Starlight's own if one were pruned.
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("design tokens (Docs round, 2026-09-28)", () => {
  it("live in theme.css, emitted whether or not the app uses them", () => {
    expect(R("src/renderer/src/theme.css")).toMatch(/^@theme static \{/m);
  });

  it("styles.css imports them and keeps no copy", () => {
    const css = R("src/renderer/src/styles.css");
    expect(css).toContain('@import "./theme.css";');
    expect(css).not.toMatch(/^@theme/m);
  });

  it("reach the built bundle", () => {
    const dir = path.join(process.cwd(), "out/renderer/assets");
    // ponytail: meaningful only after `npm run build`; `npm run gate` builds first.
    if (!fs.existsSync(dir)) return;
    const built = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("");
    expect(built).toMatch(/--color-paper:\s*#faf4e8/);
  });
});
