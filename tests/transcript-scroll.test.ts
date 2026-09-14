import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { isNearBottom } from "../src/renderer/src/components/Transcript";

const el = (
  scrollTop: number,
  scrollHeight = 1000,
  clientHeight = 400,
): { scrollTop: number; scrollHeight: number; clientHeight: number } => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

test("at the very bottom → near bottom", () => {
  expect(isNearBottom(el(600))).toBe(true);
});

test("within the slack window → still near bottom (so streaming keeps following)", () => {
  expect(isNearBottom(el(520))).toBe(true); // 80px from the bottom, slack 120
});

test("scrolled up past the slack → NOT near bottom (the bug: this must not re-pin)", () => {
  expect(isNearBottom(el(200))).toBe(false);
});

test("content shorter than the viewport is always near bottom", () => {
  expect(isNearBottom(el(0, 300, 400))).toBe(true);
});

test("the slack boundary is inclusive", () => {
  expect(isNearBottom(el(480))).toBe(true); // exactly 120 away
  expect(isNearBottom(el(479))).toBe(false); // 121 away
});

/**
 * Why position-after-commit could not work, and why following now tracks the
 * USER instead.
 *
 * Reported 2026-08-22: "as the agent codes and progresses it does not autoscroll".
 * Text streaming followed fine; tool cards did not.
 *
 * The cause is arithmetic, not a race. The follow effect ran AFTER the new
 * content was committed, so for a reader pinned at the bottom `scrollTop` had not
 * moved while `scrollHeight` had — making `scrollHeight - scrollTop -
 * clientHeight` equal the height of the card JUST ADDED. Any card taller than the
 * 120px slack therefore read exactly like "the user scrolled up", and following
 * stopped until the next send. Code cards are the tall ones, which is why coding
 * looked broken and prose did not.
 */
test("a tall card appended while pinned at the bottom LOOKS like a scroll-up", () => {
  // Pinned at the bottom of a 1000px transcript in a 400px viewport…
  expect(isNearBottom(el(600, 1000, 400))).toBe(true);
  // …then a 400px tool card lands. scrollTop is unchanged; scrollHeight grew.
  expect(isNearBottom(el(600, 1400, 400))).toBe(false);
  // ^ THIS is the bug. Nothing about the user changed between those two lines.
});

test("a short append stays within slack — why streaming text never broke", () => {
  expect(isNearBottom(el(600, 1000, 400))).toBe(true);
  expect(isNearBottom(el(600, 1080, 400))).toBe(true); // 80px of prose
});

test("following is decided by a user-scroll flag, not by post-commit geometry", () => {
  // isNearBottom stays exactly as it was — it is the right question to ask of a
  // SCROLL EVENT (did the user move away?) and the wrong one to ask of a render.
  // The follow effect must therefore consult the flag, not measure the box.
  const src = readFileSync(
    path.join(__dirname, "..", "src", "renderer", "src", "components", "Transcript.tsx"), "utf8");
  expect(src, "a ref holds the user's intent").toMatch(/follow\s*=\s*useRef/);
  expect(src, "the scroll EVENT is what updates it").toMatch(/onScroll/);
  // The old shape must be gone: measuring the box inside the follow effect is
  // what the arithmetic above disproves.
  expect(src).not.toMatch(/if \(box && !isNearBottom\(box\)\) return;/);
});

test("a send re-latches following, per the reported expectation", () => {
  const src = readFileSync(
    path.join(__dirname, "..", "src", "renderer", "src", "components", "Transcript.tsx"), "utf8");
  // "When a prompt is sent autoscroll restarts" — the nonce effect must set the
  // flag, not merely scroll once.
  // §7 round 24: the write goes through `setFollow`, which sets the ref AND the
  // state the Jump-to-latest button reads. Same intent, one more consumer.
  expect(src).toMatch(/scrollNonce[\s\S]{0,400}setFollow\(true\)/);
});

/**
 * §7 round 24 — the follow flag became observable so it can be SHOWN.
 *
 * Round 11 made following track a scroll EVENT rather than post-commit
 * geometry, which was right and left one gap: the flag lived in a ref, so
 * nothing on screen ever said the follow had stopped, and re-latching meant
 * landing inside a 120 px window whose bottom edge keeps moving away while the
 * agent writes. The button IS the indicator — it exists only while the follow
 * is off — so its absence is as load-bearing as its presence.
 */
describe("jump to latest", () => {
  const src = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");

  test("the follow flag drives a render, not just the effect", () => {
    expect(src).toContain("setFollow");
    expect(src).toContain("const [following, setFollowing]");
  });

  test("the ref is still the source of truth the scroll effect reads", () => {
    // A state read inside that effect would be a frame stale, which is the bug
    // round 11 spent a round removing. setFollow writes BOTH.
    expect(src).toContain("if (!follow.current) return;");
    expect(src).toMatch(/follow\.current = v;/);
  });

  test("the button renders only while the follow is OFF", () => {
    expect(src).toContain("{!following && (");
    expect(src).toContain("Jump to latest");
  });

  /**
   * Deliberately absent. The stream commits once per animation frame, so a
   * smooth scroll is interrupted ~60 times a second and stutters worse than
   * the instant one. The search highlighter's own smooth scroll is a different
   * call site and stays.
   */
  test("the follow does NOT use smooth scrolling", () => {
    const follow = src.slice(src.indexOf("const onScroll"), src.indexOf("const [tailExpanded"));
    expect(follow).not.toContain("smooth");
  });

  test("the scroll container keeps its own handler after the wrapper lands", () => {
    expect(src).toContain("ref={scrollRef} onScroll={onScroll}");
  });
});
