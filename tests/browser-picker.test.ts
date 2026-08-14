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

  it("falls back to the selector when the page gave no usable label", () => {
    const picked = parsePicked(JSON.stringify({ selector: "main > div", outerHTML: "<div/>" }));
    expect(picked!.label).toBe("main > div");
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
});
