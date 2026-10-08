import { expect, test } from "vitest";
import fs from "node:fs";
import { forkMarkerCopy, forkMarkerIndex, PRE_FORK_CARD_COPY } from "../src/renderer/src/fork";

test("the marker sits before the first item newer than the fork", () => {
  expect(forkMarkerIndex([{ ts: 1 }, { ts: 5 }, { ts: 9 }], 5)).toBe(2);
  expect(forkMarkerIndex([{ ts: 1 }, {}, { ts: 3 }], 9)).toBe(3); // a duplicate: at the end
  expect(forkMarkerIndex([], 1)).toBe(0);
});

test("marker copy names the original, or says it's gone", () => {
  expect(forkMarkerCopy("Fix login")).toBe("Forked from Fix login");
  expect(forkMarkerCopy(null)).toBe("Forked from a deleted session");
});

test("a pre-fork sub-agent card never expands and names where it lives", () => {
  expect(PRE_FORK_CARD_COPY).toBe("From the original session");
  const src = fs.readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  expect(src).toContain("preFork");
});

test("Duplicate is disabled while the session is working", () => {
  const ts = fs.readFileSync("src/renderer/src/components/TabStrip.tsx", "utf8");
  expect(ts).toMatch(/disabled=\{!canDuplicate/);
});
