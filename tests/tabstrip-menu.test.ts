import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §28 round 1 — the pane `+` menu must act on the PRESS, not the click.
 *
 * Reported twice as "none of this item menu is clickable". The first diagnosis
 * (the composited browser view covering it) was real and fixed, and the symptom
 * survived: pressing a menu item does not focus it, so the wrapper's `onBlur`
 * fires with `relatedTarget === null`, its containment guard cannot tell that the
 * pointer is still inside, and the menu unmounts between mousedown and mouseup.
 * The click then has nothing to land on.
 *
 * Measured in the running app, before the fix: after `Input.dispatchMouseEvent`
 * mousePressed on "New terminal", the menu was already gone and `activeElement`
 * had fallen to BODY; no terminal was created. After it: the same sequence
 * creates one.
 *
 * A DOM test would need a React renderer this suite does not have, so this pins
 * the SHAPE of the fix — cheap, and it fails the moment someone "tidies" the
 * handler back to onClick.
 *
 * §29 (2026-09-21): the row moved to `MenuItem.tsx`, shared with the SIDEBAR's
 * project `+`. The assertions follow it there, so one check now guards both
 * menus — which is the reason for sharing it rather than copying it.
 */
const ITEM = fs.readFileSync(
  path.join(process.cwd(), "src/renderer/src/components/MenuItem.tsx"),
  "utf8",
);
const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/renderer/src/components/TabStrip.tsx"),
  "utf8",
);

describe("the pane + menu (§28 round 1)", () => {
  it("acts on mousedown, because the menu is gone by mouseup", () => {
    expect(ITEM).toContain("onMouseDown");
  });

  it("does NOT act on click — that is the handler that never ran", () => {
    // The attribute, not the word: the comment above the handler names onClick
    // precisely to explain why it is not used.
    expect(ITEM).not.toContain("onClick={");
  });

  it("is SHARED, so the sidebar's + menu cannot drift back to onClick", () => {
    const sidebar = fs.readFileSync(
      path.join(process.cwd(), "src/renderer/src/components/Sidebar.tsx"),
      "utf8",
    );
    for (const f of [SRC, sidebar]) {
      expect(f).toContain('from "./MenuItem"');
      expect(f).toContain("<MenuItem");
    }
  });

  it("prevents the default focus shift that starts the race", () => {
    expect(ITEM).toMatch(/onMouseDown=\{\(e\) => \{\s*e\.preventDefault\(\)/);
  });

  it("still offers every row, with New browser among them", () => {
    for (const label of ["New session", "New terminal", "New browser", "Open file…"]) {
      expect(SRC, label).toContain(`label="${label}"`);
    }
  });
});
