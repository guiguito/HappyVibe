import { describe, it, expect } from "vitest";
import { isUnhandledBlockingUi, BLOCKING_UI_METHODS } from "../src/main/uiFallback";

describe("unhandled blocking ui-requests", () => {
  it("flags a foreign extension's confirm, whose title is plain prose", () => {
    expect(isUnhandledBlockingUi({ method: "confirm", title: "Trust nklisch/pi-plugins again?" })).toBe(true);
  });

  it("flags a foreign blocking request with no title at all", () => {
    expect(isUnhandledBlockingUi({ method: "input" })).toBe(true);
  });

  it("flags JSON whose kind is not ours, so another host's envelope can't wedge us", () => {
    expect(isUnhandledBlockingUi({ method: "select", title: JSON.stringify({ kind: "plugins.trust" }) })).toBe(true);
  });

  // The critical negative case: our own permission prompt reaches the SAME
  // fallthrough and is answered later, when the user clicks. Treating it as
  // unhandled would auto-deny every permission prompt in the app.
  it("leaves our permission prompt alone", () => {
    const title = JSON.stringify({ kind: "hv.permission", tool: "bash", summary: "rm -rf ./build" });
    expect(isUnhandledBlockingUi({ method: "select", title })).toBe(false);
  });

  it("leaves hv.ask-user and hv.plan-write inputs alone", () => {
    expect(isUnhandledBlockingUi({ method: "input", title: JSON.stringify({ kind: "hv.ask-user" }) })).toBe(false);
    expect(isUnhandledBlockingUi({ method: "input", title: JSON.stringify({ kind: "hv.plan-write" }) })).toBe(false);
  });

  // d1.md:77 — notify is fire-and-forget; responding to one is a protocol error.
  it("never flags fire-and-forget methods, whatever their payload", () => {
    for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]) {
      expect(isUnhandledBlockingUi({ method, title: "anything at all" })).toBe(false);
    }
  });

  it("covers every blocking method Pi awaits a response for", () => {
    expect([...BLOCKING_UI_METHODS].sort()).toEqual(["confirm", "editor", "input", "select"]);
    for (const method of BLOCKING_UI_METHODS) {
      expect(isUnhandledBlockingUi({ method, title: "foreign" })).toBe(true);
    }
  });

  it("treats a non-string kind as foreign rather than trusting it", () => {
    expect(isUnhandledBlockingUi({ method: "confirm", title: JSON.stringify({ kind: 42 }) })).toBe(true);
    expect(isUnhandledBlockingUi({ method: "confirm", title: JSON.stringify({}) })).toBe(true);
  });
});
