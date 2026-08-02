import { describe, it, expect } from "vitest";
import {
  rememberTyped,
  pairExpanded,
  commandName,
  type CommandPairState,
} from "../pi-runtime/extensions/hv-commands";

/**
 * §24: the typed↔expanded pairing that lets a command render as a card instead
 * of a wall of expanded prompt. The interesting cases are all the ones where a
 * pair must NOT be produced — a false pair would mislabel an ordinary message.
 */
describe("hv-commands pairing", () => {
  it("pairs a slash prompt with its expansion", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "/review src/foo.ts");
    expect(pairExpanded(s, "Review src/foo.ts for correctness bugs.")).toEqual({
      typed: "/review src/foo.ts",
      expanded: "Review src/foo.ts for correctness bugs.",
    });
  });

  it("returns null when the text came through unchanged (an extension command, not a template)", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "/hv-tools");
    expect(pairExpanded(s, "/hv-tools")).toBeNull();
  });

  it("ignores an ordinary non-slash prompt", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "hello there");
    expect(pairExpanded(s, "hello there")).toBeNull();
  });

  it("never pairs the same invocation twice", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "/review");
    expect(pairExpanded(s, "Review the diff.")).not.toBeNull();
    // A second turn with no fresh `input` must not re-use the consumed slot.
    expect(pairExpanded(s, "Review the diff.")).toBeNull();
  });

  it("a plain prompt arriving after a command does not inherit the pairing", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "/review");
    rememberTyped(s, "actually, never mind");
    expect(pairExpanded(s, "actually, never mind")).toBeNull();
  });

  it("survives a non-string expansion without throwing (the hook must fail open)", () => {
    const s: CommandPairState = {};
    rememberTyped(s, "/review");
    expect(pairExpanded(s, undefined as unknown as string)).toBeNull();
  });

  it("extracts the command name", () => {
    expect(commandName("/review src/foo.ts")).toBe("review");
    expect(commandName("/review")).toBe("review");
    expect(commandName("not a command")).toBeNull();
  });
});
