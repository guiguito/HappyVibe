import { describe, expect, it } from "vitest";
import {
  activeCommandQuery, commandSubtitle, completeCommand, composerCommands, filterCommands,
  type SlashCommand,
} from "../src/renderer/src/mentions";

const cmd = (name: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({ name, source: "skill", ...extra });

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
  const NAMES = [cmd("skill:pdf-tools"), cmd("skill:brand-guidelines"), cmd("skill:frontend-design")];
  const names = (cs: SlashCommand[]): string[] => cs.map((c) => c.name);

  it("returns everything for an empty query", () => {
    expect(filterCommands(NAMES, "")).toHaveLength(3);
  });

  it("ranks prefix matches before mid-string matches", () => {
    expect(filterCommands([cmd("a-design"), cmd("design-b")], "design")[0].name).toBe("design-b");
  });

  it("is case-insensitive and substring-based", () => {
    expect(names(filterCommands(NAMES, "PDF"))).toEqual(["skill:pdf-tools"]);
    expect(names(filterCommands(NAMES, "design"))).toEqual(["skill:frontend-design"]);
  });

  it("returns nothing when no command matches", () => {
    expect(filterCommands(NAMES, "zzz")).toEqual([]);
  });
});

// §24: the composer's `/` menu is the only place a user discovers commands, so
// it must offer prompt templates as well as skills — and say which is which.
describe("composerCommands", () => {
  it("keeps skills AND prompt templates, and drops everything else", () => {
    const all = [cmd("skill:pdf-tools"), cmd("review", { source: "prompt" }), cmd("hv-plan", { source: "extension" })];
    expect(composerCommands(all).map((c) => c.name)).toEqual(["skill:pdf-tools", "review"]);
  });
});

describe("commandSubtitle", () => {
  it("tells a skill row what picking it does", () => {
    expect(commandSubtitle(cmd("skill:pdf-tools", { description: "ignored" }))).toBe("Load this skill");
  });

  it("shows a prompt command's argument hint and description", () => {
    expect(commandSubtitle(cmd("review", { source: "prompt", description: "Review the diff", argumentHint: "[path]" })))
      .toBe("[path] · Review the diff");
    expect(commandSubtitle(cmd("review", { source: "prompt", argumentHint: "[path]" }))).toBe("[path]");
    expect(commandSubtitle(cmd("review", { source: "prompt", description: "Review the diff" }))).toBe("Review the diff");
  });

  it("falls back to naming the kind when a command carries neither", () => {
    expect(commandSubtitle(cmd("review", { source: "prompt" }))).toBe("Prompt template");
  });
});

describe("completeCommand", () => {
  it("replaces the typed prefix and leaves a trailing space for arguments", () => {
    expect(completeCommand("/ski", 4, "skill:pdf-tools")).toEqual({ text: "/skill:pdf-tools ", caret: 17 });
  });

  it("preserves text after the query without doubling the space", () => {
    expect(completeCommand("/ski rest", 4, "skill:x")).toEqual({ text: "/skill:x rest", caret: 9 });
  });

  it("uses the query END, not a caret the user has since moved", () => {
    // Regression: replacing everything before the LIVE caret turned
    // "/graph" + ArrowLeft x3 + pick into "/graphify aph".
    expect(completeCommand("/graph", 6, "graphify")).toEqual({ text: "/graphify ", caret: 10 });
  });
});
