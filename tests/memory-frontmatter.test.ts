/**
 * PRD §33 — a memory file is Claude Code's REAL frontmatter, not the flat shape the proposal
 * first drew. These fixtures are the three variants measured on disk (124 files, 3 projects):
 * metadata.type alone · plus node_type + originSessionId · plus modified.
 */
import { describe, expect, it } from "vitest";
import { MEMORY_TYPES, parseMemoryFile, serializeMemoryFile } from "../src/main/memory/frontmatter";

const V1 = `---\nname: user-goals\ndescription: "Goals — community + portfolio"\nmetadata:\n  type: user\n---\n\nBody one.\n`;
const V2 = `---\nname: x\ndescription: d\nmetadata:\n  node_type: memory\n  type: project\n  originSessionId: abc\n---\nBody two.`;
const V3 = `---\nname: y\ndescription: d\nmetadata:\n  node_type: memory\n  type: feedback\n  originSessionId: abc\n  modified: 2026-09-03T21:09:02.483Z\n---\nBody three.`;

describe("parseMemoryFile reads every shape Claude Code writes", () => {
  it("variant 1: metadata.type only", () => {
    expect(parseMemoryFile(V1)).toMatchObject({ name: "user-goals", type: "user", body: "Body one." });
  });

  it("variant 2 + 3: node_type / originSessionId / modified", () => {
    expect(parseMemoryFile(V2)).toMatchObject({ type: "project", originSessionId: "abc" });
    expect(parseMemoryFile(V3)).toMatchObject({ type: "feedback", modified: "2026-09-03T21:09:02.483Z" });
  });

  it("rejects: no frontmatter, missing name/description, unknown type, FLAT type", () => {
    expect(parseMemoryFile("just text")).toBeNull();
    expect(parseMemoryFile(`---\nname: a\n---\nb`)).toBeNull();
    expect(parseMemoryFile(`---\nname: a\ndescription: d\nmetadata:\n  type: secret\n---\nb`)).toBeNull();
    // The flat shape is refused ON PURPOSE — accepting it would create a second format.
    expect(parseMemoryFile(`---\nname: a\ndescription: d\ntype: user\n---\nb`)).toBeNull();
  });

  it("malformed YAML degrades to null, never throws", () => {
    expect(parseMemoryFile(`---\nname: [\n---\nb`)).toBeNull();
  });
});

describe("serializeMemoryFile writes OUR nested shape and round-trips", () => {
  it("round-trips through parse, quoting what needs quoting", () => {
    const doc = {
      name: "a-b",
      description: "D: with colon",
      type: "reference" as const,
      originSessionId: "s1",
      modified: "2026-09-04T00:00:00.000Z",
      body: "Hello\n\nworld",
    };
    const text = serializeMemoryFile(doc);
    expect(text.startsWith("---\nname: a-b\n")).toBe(true);
    expect(text).toContain("metadata:");
    expect(text).toContain("  type: reference");
    expect(text).toContain("  originSessionId: s1");
    expect(text.endsWith("Hello\n\nworld\n")).toBe(true);
    expect(parseMemoryFile(text)).toEqual(doc);
  });

  it("omits originSessionId when absent (a human edit or an import has none)", () => {
    const text = serializeMemoryFile({ name: "a", description: "d", type: "user", modified: "2026-01-01T00:00:00.000Z", body: "b" });
    expect(text).not.toContain("originSessionId");
    expect(parseMemoryFile(text)?.originSessionId).toBeUndefined();
  });

  it("MEMORY_TYPES is Claude Code's four, in order", () => {
    expect(MEMORY_TYPES).toEqual(["user", "feedback", "project", "reference"]);
  });
});
