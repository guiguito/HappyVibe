import { describe, expect, it } from "vitest";
import { activeCommandQuery, completeCommand, filterCommands } from "../src/renderer/src/mentions";

describe("activeCommandQuery", () => {
  it("matches a command being typed at the start of the message", () => {
    expect(activeCommandQuery("/ski", 4)).toEqual({ start: 0, query: "ski" });
    expect(activeCommandQuery("/", 1)).toEqual({ start: 0, query: "" });
    expect(activeCommandQuery("/skill:pdf-tools", 16)).toEqual({ start: 0, query: "skill:pdf-tools" });
  });

  it("does not match once the command token has ended", () => {
    expect(activeCommandQuery("/skill:x now do it", 18)).toBeNull();
  });

  it("does not match a slash that isn't at the start (a path, not a command)", () => {
    expect(activeCommandQuery("see src/main", 12)).toBeNull();
    expect(activeCommandQuery("  /skill", 8)).toBeNull();
  });
});

describe("filterCommands", () => {
  const NAMES = ["skill:pdf-tools", "skill:brand-guidelines", "skill:frontend-design"];

  it("returns everything for an empty query", () => {
    expect(filterCommands(NAMES, "")).toHaveLength(3);
  });

  it("ranks prefix matches before mid-string matches", () => {
    expect(filterCommands(["a-design", "design-b"], "design")[0]).toBe("design-b");
  });

  it("is case-insensitive and substring-based", () => {
    expect(filterCommands(NAMES, "PDF")).toEqual(["skill:pdf-tools"]);
    expect(filterCommands(NAMES, "design")).toEqual(["skill:frontend-design"]);
  });

  it("returns nothing when no command matches", () => {
    expect(filterCommands(NAMES, "zzz")).toEqual([]);
  });
});

describe("completeCommand", () => {
  it("replaces the typed prefix and leaves a trailing space for arguments", () => {
    expect(completeCommand("/ski", 4, "skill:pdf-tools")).toEqual({ text: "/skill:pdf-tools ", caret: 17 });
  });

  it("preserves text after the caret", () => {
    expect(completeCommand("/ski rest", 4, "skill:x")).toEqual({ text: "/skill:x  rest", caret: 9 });
  });
});
