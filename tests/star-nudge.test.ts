import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAR_COPY, STAR_DELAY_MS, STAR_SNOOZE_DAYS, STAR_URL, starDue } from "../src/renderer/src/starNudge";
import { STAR_NUDGE_BOX } from "../src/renderer/src/components/StarNudge";
import { paneIsCovered, type Candidate, type Rect } from "../src/renderer/src/browserCoverage";

const CARD = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/components/StarNudge.tsx"), "utf8");
/**
 * Just the card's CLASS lists, never its prose. Scanning the whole file would
 * fail on the header comment that explains why `inset-0` and `z-100` are wrong
 * here — i.e. the documentation would break the rule it documents.
 */
const CARD_CLASSES = [...CARD.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)].map((m) => m[1]).join(" ");
const APP = fs.readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe("starDue", () => {
  it("a stamp that was never written is due", () => {
    expect(starDue(null, NOW)).toBe(true);
  });

  it("a stamp in the future is not due, one in the past is", () => {
    expect(starDue(iso(60 * 60_000), NOW)).toBe(false);
    expect(starDue(iso(-60 * 60_000), NOW)).toBe(true);
  });

  it("the exact instant counts as due — the boundary belongs to the ask", () => {
    expect(starDue(iso(0), NOW)).toBe(true);
  });

  it("fails OPEN on a stamp it cannot parse", () => {
    // Treating garbage as "stay silent" turns one corrupt write into a feature
    // that is off forever with nothing on screen saying so. Being asked once
    // too often is the cheaper mistake.
    expect(starDue("not-a-date", NOW)).toBe(true);
    expect(starDue("", NOW)).toBe(true);
  });
});

describe("the schedule", () => {
  it("waits ten minutes into a run, then backs off 30 days on a star and 3 on a later", () => {
    expect(STAR_DELAY_MS).toBe(600_000);
    expect(STAR_SNOOZE_DAYS).toEqual({ starred: 30, later: 3 });
  });

  it("points at this repo over https — hv:open-external refuses any other scheme", () => {
    expect(STAR_URL).toBe("https://github.com/guiguito/HappyVibe");
    expect(STAR_URL.startsWith("https://")).toBe(true);
  });
});

describe("STAR_COPY", () => {
  it("has no dead keys — every string reaches the card", () => {
    // §20's rule: unreferenced copy is the drift these records exist to end.
    expect(Object.keys(STAR_COPY).filter((k) => !CARD.includes(`STAR_COPY.${k}`))).toEqual([]);
  });

  it("earns the ask rather than just making it", () => {
    // The body must say what the star is FOR. A bare "please star us" is the
    // version this copy was written to replace.
    expect(STAR_COPY.body).toMatch(/open source/i);
    expect(STAR_COPY.body).toMatch(/find it/i);
  });

  it('the ✕ has an accessible name — it is the only control with no visible label', () => {
    expect(CARD).toContain("aria-label={STAR_COPY.close}");
  });
});

describe("the card's box (§28)", () => {
  // 1512×949, the viewport tests/browser-coverage.test.ts uses.
  const VW = 1512;
  const VH = 949;
  // bottom-6 right-6 w-[340px], and a height it will never exceed in practice.
  const card: Rect = {
    left: VW - STAR_NUDGE_BOX.inset - STAR_NUDGE_BOX.width,
    top: VH - STAR_NUDGE_BOX.inset - 200,
    right: VW - STAR_NUDGE_BOX.inset,
    bottom: VH - STAR_NUDGE_BOX.inset,
  };
  const candidate = (rect: Rect): Candidate => ({ rect, isSelf: false, isDrawer: false, visible: true });

  it("does NOT span the viewport — a pane on the left half stays visible", () => {
    // This is the assertion that would have caught the voice pill, whose box
    // was `fixed inset-x-0` around small centred content and blanked every
    // pane on screen. It is also what stops someone wrapping this card in a
    // `fixed inset-0` positioner later, which is how the deleted onboarding
    // card was built.
    const leftPane: Rect = { left: 0, top: 88, right: VW / 2, bottom: VH };
    expect(paneIsCovered(leftPane, [candidate(card)])).toBe(false);
  });

  it("does cover a pane in its own corner — the accepted, documented ceiling", () => {
    const rightPane: Rect = { left: VW / 2, top: 88, right: VW, bottom: VH };
    expect(paneIsCovered(rightPane, [candidate(card)])).toBe(true);
    // And it is written down where the next reader will hit it.
    expect(CARD).toContain("ponytail:");
    expect(CARD).toMatch(/ACCEPTED/);
  });

  it("the card positions itself and never gets a full-screen wrapper", () => {
    expect(CARD_CLASSES).toContain("fixed bottom-6 right-6");
    expect(CARD_CLASSES).not.toMatch(/\binset-0\b|\binset-[xy]-0\b/);
  });

  it("sits below the modal layer, so a permission prompt paints over it", () => {
    // .hv-overlay/.hv-dialog own z-index 100 (tests/modal-layer.test.ts).
    expect(CARD_CLASSES).toContain("z-40");
    expect(CARD_CLASSES).not.toMatch(/\bz-\[?(100|[5-9]\d)\]?\b/);
  });
});

describe("App wiring", () => {
  it("stamps the short snooze at SHOW, so quitting with the card up does not re-ask", () => {
    expect(APP).toContain("snoozeStarNudge(STAR_SNOOZE_DAYS.later)");
  });

  it("re-reads the stamp when the timer fires, so a second window stays quiet", () => {
    const effect = APP.slice(APP.indexOf("§36 — arm the star nudge"), APP.indexOf("§34 — may this session"));
    expect(effect).toContain("window.hv.getStarNudge()");
    expect(effect).toContain("starDue(");
  });

  it("writes the long snooze only after the browser actually opened", () => {
    // A rejected openExternal means they never reached GitHub; going quiet for
    // a month over a failed launch would be the wrong read of a failed click.
    const handler = APP.slice(APP.indexOf("const starClicked"), APP.indexOf("const starLater"));
    expect(handler).toMatch(/openExternal\(STAR_URL\)[\s\S]*snoozeStarNudge\(STAR_SNOOZE_DAYS\.starred\)/);
  });
});
