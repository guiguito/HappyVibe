import { describe, expect, it, test } from "vitest";
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

// ── §28 feedback round 1: the browser takes ⌘B, the sidebar moves to ⌘\ ──────
describe("newBrowser (§28)", () => {
  it("defaults to ⌘B, and the sidebar moved out of its way", () => {
    const b = resolveBindings(null);
    expect(b.newBrowser).toBe("Mod-b");
    expect(b.toggleSidebar).toBe("Mod-\\");
  });

  it("renders as ⌘B and ⌘\\ on the shortcuts page", () => {
    expect(formatBinding("Mod-b")).toBe("⌘B");
    expect(formatBinding("Mod-\\")).toBe("⌘\\");
  });

  it("still refuses a collision between the two", () => {
    const b = resolveBindings(null);
    // Trying to give the sidebar ⌘B back must report the browser as the holder.
    expect(findConflict(b, "toggleSidebar", "Mod-b")).toBe("newBrowser");
    expect(findConflict(b, "newBrowser", "Mod-\\")).toBe("toggleSidebar");
  });

  it("is an ordinary editable action, so the settings page picks it up for free", () => {
    expect(SHORTCUT_ACTIONS.some((a) => a.id === "newBrowser")).toBe(true);
  });
});

describe("§7 round 18 — finding a session is its own action", () => {
  it("findSession is registered and defaults to Mod-k", () => {
    const a = SHORTCUT_ACTIONS.find((x) => x.id === "findSession");
    expect(a?.defaultKey).toBe("Mod-k");
  });

  it("it did NOT take Mod-f — that belongs to the conversation search", () => {
    // Round 8 modelled `search` as one action with two focus-scoped consumers
    // precisely so the default ⌘F could not conflict with itself. A third
    // claim on it would reopen that.
    expect(SHORTCUT_ACTIONS.find((x) => x.id === "findSession")?.defaultKey).not.toBe("Mod-f");
    expect(SHORTCUT_ACTIONS.find((x) => x.id === "search")?.defaultKey).toBe("Mod-f");
  });

  it("Mod-k was free — no other action claims it", () => {
    expect(findConflict(resolveBindings(null), "findSession", "Mod-k")).toBeNull();
  });

  it("§29: New worktree is registered, so the Shortcuts page lists it for free", () => {
    const a = SHORTCUT_ACTIONS.find((x) => x.id === "newWorktree");
    expect(a?.defaultKey).toBe("Mod-Shift-t");
    expect(a?.label).toMatch(/worktree/i);
  });

  it("§29: and its default avoids the two combos Electron's app menu owns", () => {
    // CmdOrCtrl+Shift+N (New Window) and CmdOrCtrl+Shift+W (close window) are
    // ACCELERATORS — served before the renderer sees the key, and invisible to
    // findConflict, which only knows this list. A default that took one of them
    // would simply never fire, with nothing anywhere saying why.
    const d = SHORTCUT_ACTIONS.find((x) => x.id === "newWorktree")?.defaultKey;
    expect(d).not.toBe("Mod-Shift-n");
    expect(d).not.toBe("Mod-Shift-w");
  });

  it("§29: it is a Shift combo, because macOS composes Alt into a dead key", () => {
    // e.key for ⌘⌥N can arrive as "˜", which no binding string would match.
    for (const a of SHORTCUT_ACTIONS) expect(a.defaultKey, a.id).not.toMatch(/Alt/);
  });

  it("every default binding is still unique", () => {
    const keys = SHORTCUT_ACTIONS.map((a) => a.defaultKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is an ordinary editable action, so the shortcuts page picks it up for free", () => {
    expect(SHORTCUT_ACTIONS.some((a) => a.id === "findSession")).toBe(true);
  });
});
