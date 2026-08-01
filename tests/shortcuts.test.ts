import { expect, test } from "vitest";
import {
  SHORTCUT_ACTIONS, eventToBinding, matchesBinding, formatBinding,
  resolveBindings, findConflict, type ShortcutId,
} from "../src/renderer/src/shortcuts";

const ev = (o: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

test("eventToBinding builds the canonical CodeMirror form", () => {
  expect(eventToBinding(ev({ key: "e", metaKey: true, shiftKey: true }))).toBe("Mod-Shift-e");
  expect(eventToBinding(ev({ key: "N", metaKey: true }))).toBe("Mod-n");
  expect(eventToBinding(ev({ key: ",", ctrlKey: true }))).toBe("Mod-,");
});

test("meta and ctrl both mean Mod — the app never distinguished them", () => {
  expect(eventToBinding(ev({ key: "b", metaKey: true }))).toBe(eventToBinding(ev({ key: "b", ctrlKey: true })));
});

test("a bare key or a lone modifier is not a binding", () => {
  expect(eventToBinding(ev({ key: "a" }))).toBeNull();
  expect(eventToBinding(ev({ key: "Meta", metaKey: true }))).toBeNull();
  expect(eventToBinding(ev({ key: "Shift", shiftKey: true }))).toBeNull();
});

test("matchesBinding is the exact inverse of capture", () => {
  const e = ev({ key: "E", metaKey: true, shiftKey: true });
  expect(matchesBinding(e, "Mod-Shift-e")).toBe(true);
  expect(matchesBinding(e, "Mod-e")).toBe(false);
});

test("formatBinding renders mac glyphs, and words elsewhere", () => {
  expect(formatBinding("Mod-Shift-e")).toBe("⌘⇧E");
  expect(formatBinding("Mod-,")).toBe("⌘,");
  expect(formatBinding("Mod-n", false)).toBe("Ctrl+N");
});

test("resolveBindings falls back to defaults and ignores unknown ids", () => {
  const defaults = resolveBindings(null);
  for (const a of SHORTCUT_ACTIONS) expect(defaults[a.id]).toBe(a.defaultKey);
  const overridden = resolveBindings({ newSession: "Mod-Shift-n", bogusAction: "Mod-x", save: "" });
  expect(overridden.newSession).toBe("Mod-Shift-n");
  expect(overridden.save).toBe("Mod-s"); // empty string is not an override
  expect("bogusAction" in overridden).toBe(false);
});

test("findConflict names the action that already owns a combo", () => {
  const b = resolveBindings(null);
  expect(findConflict(b, "newSession" as ShortcutId, b.toggleSidebar)).toBe("toggleSidebar");
  expect(findConflict(b, "newSession" as ShortcutId, b.newSession)).toBeNull(); // itself is not a conflict
  expect(findConflict(b, "newSession" as ShortcutId, "Mod-Shift-y")).toBeNull();
});
