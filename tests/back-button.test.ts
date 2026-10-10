import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ONBOARDING_COPY } from "../src/renderer/src/onboarding";
import { FEEDBACK_COPY } from "../src/renderer/src/components/feedbackCopy";

/** One back-button pattern across the app (2026-10-10): an icon-only chevron, label = tooltip + aria-label. */
const DIR = path.join(__dirname, "..", "src", "renderer", "src", "components");
const read = (f: string): string => fs.readFileSync(path.join(DIR, f), "utf8");
const GLYPH = "M15 18l-6-6 6-6";

describe("BackButton", () => {
  it("is icon-only: its label is the tooltip AND the accessible name, and it positions nothing", () => {
    const src = read("BackButton.tsx");
    expect(src).toContain(`export const BACK_PATH = "${GLYPH}";`);
    expect(src).toContain("title={label}");
    expect(src).toContain("aria-label={label}");
    expect(/\b(absolute|fixed)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "no overlay classes").toBe(false);
  });

  it("its ring is keyboard-only and inset, so no scroll box clips it", () => {
    const src = read("BackButton.tsx");
    expect(src).toContain("focus-visible:ring-2 focus-visible:ring-inset");
    expect(/(^|\s)focus:ring/.test(src), "no ring on mouse focus").toBe(false);
    for (const f of ["OnboardingKit.tsx", "OnboardingDialog.tsx", "ContextPanel.tsx", "FeedbackDialog.tsx"]) {
      const uses = read(f).match(/<BackButton [^>]*>/g) ?? [];
      for (const u of uses) expect(/-m[lx]-/.test(u), `${f}: a negative margin pushes it past the clip edge`).toBe(false);
    }
  });

  it("every back control renders it; the browser toolbar draws the same glyph", () => {
    for (const f of ["OnboardingKit.tsx", "OnboardingDialog.tsx", "ContextPanel.tsx", "FeedbackDialog.tsx"]) {
      const src = read(f);
      expect(src, f).toContain('import { BackButton } from "./BackButton";');
      expect(src, f).toContain("<BackButton ");
    }
    expect(read("BrowserTab.tsx")).toContain("<path d={BACK_PATH} />");
  });

  it("one copy of the glyph, and no text '← Back' anywhere in the components or their copy", () => {
    for (const f of fs.readdirSync(DIR).filter((n) => /\.tsx?$/.test(n))) {
      const src = read(f);
      if (f !== "BackButton.tsx") expect(src.includes(GLYPH), `${f} re-draws the back glyph`).toBe(false);
      expect(src.includes("←"), `${f} has a text arrow`).toBe(false);
    }
    for (const [k, v] of Object.entries({ ...ONBOARDING_COPY, ...FEEDBACK_COPY })) expect(String(v).includes("←"), k).toBe(false);
  });
});
