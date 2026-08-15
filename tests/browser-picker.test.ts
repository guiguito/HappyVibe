import { describe, it, expect } from "vitest";
import { MAX_OUTER_HTML, PICKER_SCRIPT, parsePicked, trimOuterHtml } from "../src/main/browserPicker";

describe("trimOuterHtml (§28 picker payload)", () => {
  it("leaves a small element alone", () => {
    const html = '<button class="save">Save</button>';
    expect(trimOuterHtml(html)).toBe(html);
  });

  it("keeps the OPENING tag whole when it trims", () => {
    // Identity lives in the opening tag — a cut landing mid-attribute produces
    // something that reads like markup and is not.
    const open = '<section id="hero" class="a b c" data-testid="hero-section">';
    const html = open + "x".repeat(5000) + "</section>";
    const out = trimOuterHtml(html, 200);
    expect(out.startsWith(open)).toBe(true);
    expect(out).toMatch(/\[trimmed \d+ chars\]$/);
    expect(out.length).toBeLessThan(300);
  });

  it("defaults to a bound that fits in a prompt", () => {
    expect(MAX_OUTER_HTML).toBe(2000);
    expect(trimOuterHtml("y".repeat(10_000)).length).toBeLessThan(2100);
  });
});

describe("parsePicked", () => {
  it("reads what the injected script resolved with", () => {
    const raw = JSON.stringify({ selector: "#save", outerHTML: "<button id='save'>Save</button>", label: "<button#save> Save" });
    expect(parsePicked(raw)).toEqual({
      selector: "#save",
      outerHTML: "<button id='save'>Save</button>",
      label: "<button#save> Save",
    });
  });

  it("treats a cancel as no selection", () => {
    expect(parsePicked("null")).toBeNull();
    expect(parsePicked("")).toBeNull();
    expect(parsePicked(undefined)).toBeNull();
  });

  it("never throws on page garbage — the payload is page-CONTROLLED", () => {
    expect(parsePicked("{not json")).toBeNull();
    expect(parsePicked(JSON.stringify({ selector: 42 }))).toBeNull();
    expect(parsePicked(JSON.stringify({ nothing: true }))).toBeNull();
  });

  it("trims the markup and caps a hostile label", () => {
    const picked = parsePicked(JSON.stringify({
      selector: "div",
      outerHTML: "<div>" + "z".repeat(9000) + "</div>",
      label: "L".repeat(500),
    }));
    expect(picked!.outerHTML.length).toBeLessThan(2100);
    expect(picked!.label.length).toBe(120);
  });

  it("falls back to a plain word, never the selector", () => {
    // Falling back to "main > div" would put the path back in front of the user,
    // which is the whole thing the label exists to avoid.
    const picked = parsePicked(JSON.stringify({ selector: "main > div", outerHTML: "<div/>" }));
    expect(picked!.label).toBe("element");
    expect(picked!.label).not.toContain(">");
  });
});

describe("PICKER_SCRIPT", () => {
  it("is self-removing and re-entrant-safe — a second Comment click must not stack listeners", () => {
    expect(PICKER_SCRIPT).toContain("__hvPickerActive");
    expect(PICKER_SCRIPT).toContain("removeEventListener");
  });

  it("exposes a cancel handle, because our chrome owns the Cancel button", () => {
    expect(PICKER_SCRIPT).toContain("__hvPickerCancel");
  });

  it("escapes with Escape as well as the button", () => {
    expect(PICKER_SCRIPT).toContain('e.key === "Escape"');
  });

  // §28 round 1: the chip said "<a.nav-play> PLAY". A tag and a class are the
  // developer's handle on an element; the person who clicked it means "PLAY".
  it("labels an element by what it SAYS, not by what it is made of", () => {
    expect(PICKER_SCRIPT).toContain("innerText");
    // No tag-soup assembly left in the label path.
    expect(PICKER_SCRIPT).not.toContain('"<" + el.tagName.toLowerCase()');
  });

  it("falls back to the accessible name, then to a plain English kind", () => {
    for (const attr of ["aria-label", "alt", "placeholder", "title"]) {
      expect(PICKER_SCRIPT, attr).toContain(`"${attr}"`);
    }
    for (const word of ["link", "button", "image", "heading", "dropdown"]) {
      expect(PICKER_SCRIPT, word).toContain(`"${word}"`);
    }
  });
});

// ── §28 round 1: the rect that pins the comment popup ───────────────────────
describe("parsePicked — rect", () => {
  const base = { selector: "#save", outerHTML: "<button/>", label: "<button#save>" };

  it("keeps a valid rect", () => {
    const picked = parsePicked(JSON.stringify({ ...base, rect: { x: 10, y: 20, width: 30, height: 40 } }));
    expect(picked!.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("drops a rect the page made up, rather than pinning the popup off-screen", () => {
    // The payload is page-controlled: NaN/Infinity/strings must degrade to
    // "no rect" (the popup centres) instead of positioning at NaN.
    for (const rect of [
      { x: NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: Infinity, width: 1, height: 1 },
      { x: "10", y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1 },
      "nope",
      null,
    ]) {
      expect(parsePicked(JSON.stringify({ ...base, rect })).rect, JSON.stringify(rect)).toBeUndefined();
    }
  });

  it("still parses a payload with no rect at all", () => {
    expect(parsePicked(JSON.stringify(base))).toMatchObject({ selector: "#save" });
  });

  it("the injected script actually sends one", () => {
    expect(PICKER_SCRIPT).toContain("getBoundingClientRect");
    expect(PICKER_SCRIPT).toContain("rect:");
  });
});
