import { describe, expect, it } from "vitest";
import { promptWindowFor } from "../src/main/promptRouting";

describe("promptWindowFor", () => {
  const holder = (m: Record<string, number>) => (sid: string): number | null => m[sid] ?? null;

  it("the window holding the session's chat tab", () => {
    expect(promptWindowFor("s1", holder({ s1: 2 }), 1, 1)).toBe(2);
  });

  it("no holder → the focused window", () => {
    // A session whose chat tab is closed everywhere still has to be answerable,
    // and the window the user is looking at is the only honest guess.
    expect(promptWindowFor("s1", holder({}), 3, 1)).toBe(3);
  });

  it("no holder, no focus → primary; and a session-less prompt always goes primary", () => {
    expect(promptWindowFor("s1", holder({}), null, 1)).toBe(1);
    // The utility client's prompts (login, provider setup) belong to the app,
    // not to any session, so they must not chase a holder.
    expect(promptWindowFor(undefined, holder({ s1: 2 }), 3, 1)).toBe(1);
  });

  it("nothing at all → null, and the caller broadcasts unstamped", () => {
    // Better every window shows a prompt than none does: a permission prompt
    // never times out, so a lost one hangs the agent forever.
    expect(promptWindowFor("s1", holder({}), null, null)).toBeNull();
  });

  it("the holder wins over the focused window", () => {
    // Otherwise typing in window 1 would pull window 2's prompts across, and
    // round 21's pane scoping would put the dialog over the wrong pane.
    expect(promptWindowFor("s1", holder({ s1: 2 }), 1, 1)).toBe(2);
  });
});
