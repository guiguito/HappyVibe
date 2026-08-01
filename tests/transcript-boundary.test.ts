import { describe, expect, it } from "vitest";
import { boundaryLabel } from "../src/renderer/src/components/Transcript";

describe("boundaryLabel", () => {
  it("states the plain fact when the reason is unknown", () => {
    expect(boundaryLabel(1, null)).toBe("Earlier messages were compacted into a summary.");
  });

  it("names an automatic compaction so it reads as not-your-doing", () => {
    expect(boundaryLabel(1, "threshold")).toBe(
      "Earlier messages were compacted into a summary — automatically, when the context filled up.",
    );
    expect(boundaryLabel(1, "overflow")).toBe(
      "Earlier messages were compacted into a summary — automatically, when the context overflowed.",
    );
  });

  it("names a manual compaction", () => {
    expect(boundaryLabel(1, "manual")).toBe("Earlier messages were compacted into a summary — you asked for this one.");
  });

  it("counts multiple compactions (only the last one bounds context)", () => {
    expect(boundaryLabel(3, null)).toBe(
      "Earlier messages were compacted into a summary. 3 compactions in this session.",
    );
  });
});
