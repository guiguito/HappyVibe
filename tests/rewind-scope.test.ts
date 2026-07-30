import { describe, expect, test } from "vitest";
import { rewindActions, tailToolCallIds, type RewindScope } from "../src/renderer/src/rewind";

describe("rewindActions", () => {
  test("conversation scope truncates chat and leaves files alone", () => {
    expect(rewindActions("conversation")).toEqual({ truncateChat: true, restoreFiles: false });
  });

  test("both scope does everything", () => {
    expect(rewindActions("both")).toEqual({ truncateChat: true, restoreFiles: true });
  });

  test("files scope leaves the conversation intact", () => {
    expect(rewindActions("files")).toEqual({ truncateChat: false, restoreFiles: true });
  });

  test("every scope does at least one thing", () => {
    for (const s of ["conversation", "both", "files"] as RewindScope[]) {
      const a = rewindActions(s);
      expect(a.truncateChat || a.restoreFiles).toBe(true);
    }
  });
});

describe("tailToolCallIds", () => {
  const items = [
    { id: 0, kind: "user", text: "first" },
    { id: 1, kind: "tool", card: { toolCallId: "call-a" } },
    { id: 2, kind: "assistant", text: "done" },
    { id: 3, kind: "user", text: "second" },
    { id: 4, kind: "tool", card: { toolCallId: "call-b" } },
    { id: 5, kind: "tool", card: { toolCallId: "call-c" } },
  ] as unknown as Parameters<typeof tailToolCallIds>[0];

  test("collects every toolCallId at and after the anchor index", () => {
    expect(tailToolCallIds(items, 3)).toEqual(["call-b", "call-c"]);
  });

  test("rewinding to the first message collects them all", () => {
    expect(tailToolCallIds(items, 0)).toEqual(["call-a", "call-b", "call-c"]);
  });

  test("a tail with no tool calls yields an empty list", () => {
    expect(tailToolCallIds(items, 6)).toEqual([]);
  });
});
