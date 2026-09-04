/** PRD §33 — the permission prompt renders a memory as a FACT, not as JSON. Data-only, because
 *  the renderer suite has no DOM. */
import { describe, expect, it } from "vitest";
import { MEMORY_TYPE_LABEL, memoryFactFrom, memoryFactRows, memoryPromptTitle } from "../src/renderer/src/memoryFact";

describe("memoryFactFrom", () => {
  it("reads a save's five fields", () => {
    expect(
      memoryFactFrom("memory_save", { scope: "workspace", type: "project", name: "tests-run-serially", description: "d", content: "body" })
    ).toEqual({ scope: "workspace", type: "project", name: "tests-run-serially", description: "d", content: "body" });
  });

  it("defaults an unknown or missing scope to global rather than inventing one", () => {
    expect(memoryFactFrom("memory_forget", { name: "n" })?.scope).toBe("global");
    expect(memoryFactFrom("memory_forget", { scope: "universe", name: "n" })?.scope).toBe("global");
  });

  it("is null for a non-memory tool and for a memory call with no name", () => {
    expect(memoryFactFrom("write", { name: "n", scope: "global" })).toBeNull();
    expect(memoryFactFrom("memory_save", { scope: "global" })).toBeNull();
    expect(memoryFactFrom("memory_save", undefined)).toBeNull();
  });
});

describe("memoryFactRows", () => {
  it("names what it is, where it applies and what it says — in that order", () => {
    const rows = memoryFactRows({ scope: "global", type: "user", name: "n", description: "d", content: "c" });
    expect(rows.map((r) => r[0])).toEqual(["Name", "Kind", "Scope", "Summary"]);
    expect(rows[1][1]).toBe("About you");
    expect(rows[2][1]).toBe("About you, in every project");
  });

  it("says WHERE a workspace memory applies, in words rather than the raw scope", () => {
    const rows = memoryFactRows({ scope: "workspace", name: "n" });
    expect(rows.find((r) => r[0] === "Scope")![1]).toBe("About this project only");
    expect(rows.map((r) => r[1]).join(" ")).not.toContain("workspace");
  });

  it("drops rows it has no value for, rather than showing an empty one", () => {
    expect(memoryFactRows({ scope: "global", name: "n" }).map((r) => r[0])).toEqual(["Name", "Scope"]);
  });

  it("falls back to the raw type rather than dropping an unknown one", () => {
    expect(memoryFactRows({ scope: "global", type: "mystery", name: "n" })[1][1]).toBe("mystery");
  });

  it("labels all four of Claude Code's types", () => {
    expect(Object.keys(MEMORY_TYPE_LABEL).sort()).toEqual(["feedback", "project", "reference", "user"]);
  });
});

describe("memoryPromptTitle", () => {
  it("an update says REPLACE — hiding the overwrite is what the diff exists to prevent", () => {
    expect(memoryPromptTitle("memory_save", true)).toContain("REPLACE");
    expect(memoryPromptTitle("memory_save", false)).toContain("remember");
    expect(memoryPromptTitle("memory_forget", false)).toContain("forget");
  });
});
