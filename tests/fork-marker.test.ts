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
  // The clickable-title variant shares the prefix instead of re-typing it.
  const tr = fs.readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  expect(tr).toContain("{FORK_MARKER_PREFIX}");
  expect(tr).not.toMatch(/>\s*Forked from/);
});

test("a pre-fork sub-agent card never expands and names where it lives", () => {
  expect(PRE_FORK_CARD_COPY).toBe("From the original session");
  const src = fs.readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  // The toggle is guarded, the chevron is gone, and the link is outside the toggle button.
  expect(src).toContain("onClick={() => !preFork && setOpen(!open)}");
  expect(src).toMatch(/\{!preFork && \(\s*<span[^>]*aria-hidden>\s*\{open \? "▾" : "▸"\}/);
  expect(src).toMatch(/<button type="button" onClick=\{onOpenOriginal\}[^>]*>\s*\{PRE_FORK_CARD_COPY\}/);
  // Plain text once the original is gone.
  expect(src).toMatch(/\) : \(\s*PRE_FORK_CARD_COPY\s*\)/);
});

test("Duplicate is disabled while the session is working", () => {
  const ts = fs.readFileSync("src/renderer/src/components/TabStrip.tsx", "utf8");
  expect(ts).toMatch(/disabled=\{!canDuplicate/);
});
