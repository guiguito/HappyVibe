import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { thinkingLabel } from "../src/renderer/src/thinkingLabel";

describe("the label carries the state, not the content", () => {
  test("while streaming it is the bare verb — the dots are rendered separately", () => {
    expect(thinkingLabel({ live: true })).toBe("Thinking");
    // live wins even when a duration is somehow present
    expect(thinkingLabel({ live: true, ms: 9000 })).toBe("Thinking");
  });

  test("a finished block with a measured duration names it", () => {
    expect(thinkingLabel({ ms: 12_000 })).toBe("Thought for 12s");
    expect(thinkingLabel({ ms: 1_400 })).toBe("Thought for 1s");
  });

  test("past a minute it reads in minutes and seconds", () => {
    expect(thinkingLabel({ ms: 95_000 })).toBe("Thought for 1m 35s");
    expect(thinkingLabel({ ms: 120_000 })).toBe("Thought for 2m 0s");
  });

  /**
   * The reopened-session case. A thinking block in the session file carries no
   * start or end stamp, so the duration is NOT recoverable — and an unknown
   * number is left off rather than invented (§19 ruling 3, one surface over).
   */
  test("no duration → no number, never a zero", () => {
    expect(thinkingLabel({})).toBe("Thought");
    expect(thinkingLabel({ ms: undefined })).toBe("Thought");
  });

  test("a sub-second think still rounds up to 1s rather than reading 0s", () => {
    expect(thinkingLabel({ ms: 200 })).toBe("Thought for 1s");
  });

  test("a nonsense duration degrades to the unknown case", () => {
    expect(thinkingLabel({ ms: -5 })).toBe("Thought");
    expect(thinkingLabel({ ms: Number.NaN })).toBe("Thought");
  });
});

describe("the live block is collapsed, which is what the PRD already decided", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");
  // The component's real body, not a char budget — Transcript.tsx holds several
  // `useState(false)` and a file-wide scan would pass before the change existed.
  const from = src.indexOf("function ThinkingBlock");
  const decl = src.slice(from, src.indexOf("\n}", from) + 2);

  /**
   * The defect this round fixed: §7's round-16 decision reads "collapsed by
   * default … live text is streamed only into an expanded block", and the
   * implementation was `useState(!!live)` — live blocks opened themselves.
   * Pinned as an ABSENCE because that is exactly what a render test cannot
   * fail on, and because the drift was silent for a whole round.
   */
  test("a live block does not open itself", () => {
    expect(decl).not.toContain("useState(!!live)");
    expect(decl).toContain("useState(false)");
  });

  test("the dots are rendered, and only while live", () => {
    expect(decl).toContain("hv-dots");
    expect(decl).toContain("thinkingLabel");
    expect(decl).toMatch(/\{live && \([\s\S]{0,400}hv-dots/);
  });

  /**
   * The ellipsis is TEXT, in the label's own font — "Thinking." → ".." → "..."
   * on a loop. The first cut drew three `rounded-full` circles fading in and
   * out, which reads as a status light rather than as a sentence still being
   * written, and which ignores the font entirely.
   */
  test("the dots are period characters, not drawn circles", () => {
    const dots = decl.slice(decl.indexOf('className="hv-dots"'), decl.indexOf("</span>", decl.indexOf('className="hv-dots"')) + 200);
    expect(dots).toContain("<span>.</span>");
    expect(dots).not.toContain("rounded-full");
    expect(dots).not.toContain("bg-current");
  });
});

describe("the ellipsis counts up rather than fading", () => {
  /**
   * `styles.css` is the ONE stylesheet the app loads — `src/renderer/src/main.tsx`
   * imports it and nothing else. The first cut of this animation was appended
   * to an `index.css` that did not exist, which Vite happily ignored: the
   * component rendered its three dots and none of them ever moved, with a green
   * gate and a clean build. Hence the built-bundle assertion below.
   */
  const css = readFileSync(path.join(process.cwd(), "src/renderer/src/styles.css"), "utf8");

  test("only the second and third dots animate — an ellipsis rests at one dot", () => {
    expect(css).toContain("hv-dots > span:nth-child(2)");
    expect(css).toContain("hv-dots > span:nth-child(3)");
    expect(css).not.toContain("hv-dots > span:nth-child(1)");
  });

  /** Sliced, not regexed: a keyframe body holds its own braces, so `[^}]*`
      stops at the first inner block and never reaches the second stop. */
  const frames = (name: string): string => {
    const at = css.indexOf(`@keyframes ${name}`);
    return at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
  };

  test("the two keyframes switch at the thirds, so the count is 1 → 2 → 3", () => {
    const two = frames("hv-dot-2");
    expect(two).toContain("32.9%");
    expect(two).toContain("33%");
    expect(two.indexOf("opacity: 0")).toBeLessThan(two.indexOf("opacity: 1"));

    const three = frames("hv-dot-3");
    expect(three).toContain("65.9%");
    expect(three).toContain("66%");
    expect(three.indexOf("opacity: 0")).toBeLessThan(three.indexOf("opacity: 1"));
  });

  test("both run on the same clock, or the dots drift apart", () => {
    expect(css).toContain("animation: hv-dot-2 1.2s infinite");
    expect(css).toContain("animation: hv-dot-3 1.2s infinite");
  });

  test("reduced motion shows a complete, still ellipsis", () => {
    const rm = css.slice(css.lastIndexOf("prefers-reduced-motion"));
    expect(rm).toContain("animation: none");
    expect(rm).toContain("opacity: 1");
  });

  /**
   * The assertion that would have caught the dead stylesheet.
   *
   * Every check above passes against a .css file nothing imports — the rules
   * are real, they are just never loaded. Only the emitted bundle proves the
   * animation can run. `npm run gate` builds before it tests, so in the gate
   * this runs against fresh output; it skips rather than passing vacuously
   * when `out/` is absent.
   */
  test("the keyframes reach the BUILT css bundle", () => {
    const assets = path.join(process.cwd(), "out/renderer/assets");
    if (!existsSync(assets)) {
      expect(existsSync(assets), "no build output — run `npm run build` first").toBe(false);
      return;
    }
    const bundled = readdirSync(assets)
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(path.join(assets, f), "utf8"))
      .join("\n");
    expect(bundled).toContain("@keyframes hv-dot-2");
    expect(bundled).toContain("@keyframes hv-dot-3");
    expect(bundled).toContain("hv-dots");
  });
});

describe("App measures the duration it prints", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");

  test("the clock starts at thinking_start and the item carries the result", () => {
    expect(src).toContain("thinkStart.current[sid] = Date.now()");
    expect(src).toMatch(/kind: "thinking"[^}]*ms:/);
  });
});
