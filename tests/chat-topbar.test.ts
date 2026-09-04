import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * §7 round 21 — the chat top bar takes a second line rather than squeezing.
 *
 * Source scan: the renderer suite has no DOM, and what matters here is a
 * handful of layout classes on one container.
 */

const src = readFileSync(path.join(__dirname, "..", "src/renderer/src/components/ChatView.tsx"), "utf8");

/**
 * The top-bar container's className, and ONLY that.
 *
 * Not the surrounding comment: the comment explains why `h-11` was wrong, and a
 * scan over the region matched its own explanation.
 */
const bar = (() => {
  const region = src.slice(src.indexOf("v5.1: search + context bubble"), src.indexOf("§23: compact plan-mode indicator"));
  const m = /<div className="([^"]*border-b-2 border-line bg-paper[^"]*)"/.exec(region);
  if (!m) throw new Error("top-bar container not found — did its classes change?");
  return m[1];
})();

test("the bar wraps instead of squeezing its chips", () => {
  expect(bar).toContain("flex-wrap");
});

test("its height is a MINIMUM, not a fixed one", () => {
  // `h-11` cannot grow, so wrapped chips would overflow the bar's own box and
  // paint over the transcript — the fixed height is the bug, not the wrapping.
  expect(bar).toContain("min-h-11");
  expect(bar).not.toMatch(/(?<![\w-])h-11\b/);
});

test("it stays shrink-0 so a wrapped bar takes room from the transcript, not from itself", () => {
  expect(bar).toContain("shrink-0");
});

test("there is no overflow menu — a hidden control is worse than a taller bar", () => {
  expect(bar).not.toMatch(/⋯|overflowMenu/);
});
