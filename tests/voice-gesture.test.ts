import { describe, it, expect } from "vitest";
import {
  initialGesture,
  gestureReducer,
  triggerCode,
  type GestureEvent,
  type GestureAction,
} from "../src/renderer/src/voice/gesture";
import { appendToComposer } from "../src/renderer/src/composerText";

const KEY = "MetaRight";

function run(events: GestureEvent[]): { actions: GestureAction[]; state: ReturnType<typeof initialGesture> } {
  let state = initialGesture();
  const actions: GestureAction[] = [];
  for (const e of events) {
    const r = gestureReducer(state, e, { code: KEY });
    state = r.state;
    actions.push(r.action);
  }
  return { actions, state };
}

describe("the dictation trigger key", () => {
  it("is the right-hand modifier, and it is per-platform", () => {
    // Right Cmd does not travel: MetaRight raises the Start menu on Windows.
    expect(triggerCode("darwin")).toBe("MetaRight");
    expect(triggerCode("win32")).toBe("ControlRight");
    expect(triggerCode("linux")).toBe("ControlRight");
  });
});

describe("dictation gesture", () => {
  it("hold: records on press, stops on a release past the threshold", () => {
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 900 },
    ]);
    expect(actions).toEqual(["start", "stop"]);
    expect(state.recording).toBe(false);
  });

  it("tap: a release under the threshold LATCHES recording on", () => {
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 120 },
    ]);
    expect(actions).toEqual(["start", null]);
    expect(state.recording).toBe(true);
    expect(state.latched).toBe(true);
  });

  it("a second tap stops the latched recording", () => {
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 120 },
      { type: "keydown", code: KEY, at: 2000 },
      { type: "keyup", code: KEY, at: 2100 },
    ]);
    expect(actions).toEqual(["start", null, null, "stop"]);
    expect(state.recording).toBe(false);
  });

  it("ABANDONS when another key joins the trigger — right-Cmd+S must not dictate", () => {
    // The whole reason this is a tested pure function: the failure is silent.
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keydown", code: "KeyS", at: 50 },
      { type: "keyup", code: "KeyS", at: 90 },
      { type: "keyup", code: KEY, at: 140 },
    ]);
    expect(actions).toEqual(["start", "cancel", null, null]);
    expect(state.recording).toBe(false);
    expect(state.latched).toBe(false);
  });

  it("recovers cleanly: a real gesture right after an abandoned one still works", () => {
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keydown", code: "KeyS", at: 50 },
      { type: "keyup", code: KEY, at: 140 },
      { type: "keydown", code: KEY, at: 500 },
      { type: "keyup", code: KEY, at: 620 },
    ]);
    expect(actions).toEqual(["start", "cancel", null, "start", null]);
    expect(state.recording).toBe(true);
  });

  it("does not abandon a LATCHED recording when the user types", () => {
    // Tap to latch, then keep typing the file path — §3.4's mixed-mode prompt.
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 100 },
      { type: "keydown", code: "KeyA", at: 300 },
      { type: "keyup", code: "KeyA", at: 340 },
    ]);
    expect(actions).toEqual(["start", null, null, null]);
    expect(state.recording).toBe(true);
  });

  it("ignores the other-hand modifier entirely", () => {
    const { actions } = run([
      { type: "keydown", code: "MetaLeft", at: 0 },
      { type: "keyup", code: "MetaLeft", at: 900 },
    ]);
    expect(actions).toEqual([null, null]);
  });

  it("escape cancels and discards, in either mode", () => {
    expect(
      run([
        { type: "keydown", code: KEY, at: 0 },
        { type: "keyup", code: KEY, at: 100 },
        { type: "escape", at: 500 },
      ]).actions,
    ).toEqual(["start", null, "cancel"]);

    expect(
      run([
        { type: "keydown", code: KEY, at: 0 },
        { type: "escape", at: 500 },
      ]).actions,
    ).toEqual(["start", "cancel"]);
  });

  it("escape is inert when nothing is recording, so it can sit last in the chain", () => {
    // §3.3: search / slash menu / mention dropdown each get Escape first.
    // Dictation-cancel must be a no-op when idle or it would swallow theirs.
    const { actions } = run([{ type: "escape", at: 10 }]);
    expect(actions).toEqual([null]);
  });

  it("the 5-minute cap stops a forgotten hot mic", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 100 },
      { type: "tick", at: 299_999 },
      { type: "tick", at: 300_001 },
    ]);
    expect(actions).toEqual(["start", null, null, "stop"]);
  });
});

describe("appendToComposer", () => {
  it("is the identity on an empty composer", () => {
    expect(appendToComposer("", "hello")).toBe("hello");
    expect(appendToComposer("   ", "hello")).toBe("hello");
  });

  it("separates existing text with exactly one blank line", () => {
    expect(appendToComposer("first", "second")).toBe("first\n\nsecond");
  });

  it("does not stack blank lines on trailing whitespace", () => {
    expect(appendToComposer("first\n\n", "second")).toBe("first\n\nsecond");
    expect(appendToComposer("first   ", "second")).toBe("first\n\nsecond");
  });

  it("matches what ChatView already did, so Send-to-chat is unchanged", () => {
    const legacy = (prev: string, text: string): string =>
      (prev.trim() ? `${prev.replace(/\s*$/, "")}\n\n` : "") + text;
    for (const prev of ["", "  ", "a", "a\n", "a\n\n", "a  ", "line1\nline2"]) {
      expect(appendToComposer(prev, "X")).toBe(legacy(prev, "X"));
    }
  });
});
