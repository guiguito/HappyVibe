import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * §12/§26 (2026-08-30): the rail's GEOMETRY and its ABSENCES.
 *
 * The renderer suite has no DOM, so the half of this feature that cannot be
 * asserted by rendering is asserted by scanning the source — the
 * tests/modal-layer.test.ts pattern. Each case here corresponds to a trap this
 * app has already paid for once (see CLAUDE.md).
 */
const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
const term = readFileSync("src/renderer/src/components/TerminalRunCard.tsx", "utf8");
const rail = chat.slice(chat.indexOf("function RunRail"), chat.indexOf("export const GAUGE_TONE"));

describe("the run rail replaced the two card stacks", () => {
  it("ChatView renders RunRail and no longer renders either stack", () => {
    expect(chat).toContain("<RunRail");
    expect(chat).not.toContain("<DelegationSection");
    expect(chat).not.toContain("<TerminalStack");
  });

  it("the terminal cap and its summary strip are gone", () => {
    for (const dead of ["STACK_CAP", "visibleRuns", "summaryLabel", "TerminalStack"]) {
      expect(term).not.toContain(dead);
    }
  });

  it("TerminalRunCard is exported so the rail can host it", () => {
    expect(term).toMatch(/export function TerminalRunCard\b/);
  });

  it("the rail found a RunRail body to scan", () => {
    // Guards every other case in this file: an empty slice would pass the
    // negative assertions vacuously.
    expect(rail.length).toBeGreaterThan(1000);
  });
});

describe("the overlay's geometry is the one that was specced", () => {
  it("the sticky container is a positioning ancestor", () => {
    // An `absolute` overlay inside the sticky header positions against the
    // nearest POSITIONED ancestor. Without `relative` here it escapes to the
    // pane and lands somewhere else entirely.
    expect(chat).toContain('className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full"');
  });

  it("the overlay is left-anchored, not centred", () => {
    const overlay = chat.slice(chat.indexOf("RUN_RAIL_OVERLAY ="), chat.indexOf("RUN_RAIL_OVERLAY =") + 200);
    expect(overlay).toContain("absolute");
    expect(overlay).toContain("left-0");
    expect(overlay).not.toContain("mx-auto");
  });

  it("nothing in the rail climbs above the cards' own layer", () => {
    // PRD §12 (2026-08-30): a readout, deliberately not dialog tier.
    // .hv-overlay/.hv-dialog own 100 and tests/modal-layer.test.ts guards it.
    expect(rail).not.toMatch(/z-\[?(3\d|[4-9]\d|\d{3,})/);
    expect(rail).toContain("z-20");
  });
});

describe("the dismissal traps this app has already been bitten by", () => {
  it("there is no full-viewport click-catcher", () => {
    // browserCoverage.ts gathers candidates by class word and judges them by
    // BOX, so a `fixed inset-0` catcher reads as covering every browser pane.
    expect(rail).not.toContain("fixed inset-0");
  });

  it("the rail does not dismiss on blur", () => {
    // A blur-dismissed surface unmounts between mousedown and mouseup and loses
    // its own click — reported twice as "none of this menu is clickable".
    expect(rail).not.toContain("onBlur");
  });

  it("the hover readout's STOP acts on mousedown", () => {
    expect(rail).toContain("onMouseDown");
  });

  it("Escape closes the overlay", () => {
    expect(rail).toContain('e.key === "Escape"');
  });
});

describe("the avatar's hue cannot be a Tailwind class", () => {
  it("is applied as an inline style", () => {
    // The JIT scanner never sees a computed class name and emits nothing, so a
    // `bg-[hsl(...)]` template would render every circle unstyled.
    expect(rail).toContain("style={{ backgroundColor: `hsl(");
    expect(rail).not.toMatch(/className=\{`[^`]*\$\{a\.hue\}/);
  });
});

describe("the card the rail opens IS the expanded state (2026-08-31)", () => {
  const delCard = chat.slice(chat.indexOf("function DelegationRunCard"), chat.indexOf("function AgentsChip"));

  it("found a DelegationRunCard body to scan", () => {
    expect(delCard.length).toBeGreaterThan(2000);
  });

  it("the delegation card has no collapsed state to toggle back to", () => {
    // The circle is what "collapsed" means now. A card that opened shut was one
    // click short of showing anything, which is what this replaced.
    expect(delCard).not.toContain("setOpen((o) => !o)");
    expect(delCard).toContain("const open = true");
  });

  it("both cards close with ✕, not a chevron", () => {
    expect(delCard).toContain("✕");
    expect(term).toContain("✕");
    for (const s of [delCard, term]) {
      expect(s).not.toContain('open ? "▾" : "▸"');
    }
  });

  it("✕ closes the overlay rather than collapsing in place", () => {
    expect(delCard).toContain("onClick={onClose}");
    expect(term).toContain("onClick={onClose}");
  });

  it("the rail hands ✕ only to the overlay card, never to a promoted one", () => {
    // A promoted (needs_attention) card has no circle to return to, and that
    // state must not be dismissible — PRD §12, 2026-08-30.
    expect(rail).toContain("cardFor(a.key, false)");
    // A3 (2026-09-10) renamed the argument: the overlay is held mounted for its
    // exit, so it draws `shownOpen` (the key it was showing) rather than
    // `open`, which is already null by then. `closable: true` is the invariant.
    expect(rail).toContain("cardFor(shownOpen, true)");
    expect(rail).toContain("onClose={closable ?");
  });

  it("neither card's header title is a toggle any more", () => {
    // A stray click on the title used to close the emulator you had just opened.
    expect(term).not.toContain("onClick={onToggle}");
    expect(delCard).not.toContain('title={open ? "Collapse');
  });

  it("the terminal card always hosts its emulator and always offers Open as tab", () => {
    expect(term).toContain("<LiveTerminal terminalId={run.terminalId} settings={settings} />");
    expect(term).not.toContain("{open && <LiveTerminal");
    expect(term).not.toContain("{open && (");
  });

  it("the three-line tail moved to the rail's hover readout, it did not disappear", () => {
    // PRD §26 (2026-08-30) says so explicitly; the collapsed card that used to
    // host it no longer exists.
    expect(term).toMatch(/export function TerminalTail\b/);
    expect(rail).toContain('a.kind === "terminal" && <TerminalTail terminalId={a.key} />');
    // …and it must read MAIN's rendered grid, never re-parse raw PTY bytes.
    expect(term).toContain("window.hv.termText(terminalId, 3)");
  });
});

/**
 * A1 / A2 / A3 (Animations round, 2026-09-10) — the flight, and the circle's
 * own motion.
 *
 * The renderer suite has no DOM, so what is pinned here is the SHAPE of the
 * code: the traps this design can fall into are all visible in the source, and
 * each one below has a specific way of failing silently in the running app.
 */
describe("the card→circle flight (A1)", () => {
  it("the ghost is positioned INLINE, never by the class word", () => {
    // §28's coverage check gathers candidates by the class words `absolute` /
    // `fixed` (BrowserTab.tsx) and judges them by bounding box. A ghost
    // carrying either word is a full-size candidate crossing the screen, and
    // it would blank a browser pane for the length of every flight.
    const motion = readFileSync("src/renderer/src/motion.ts", "utf8");
    expect(motion).toContain('position: "fixed"');
    expect(motion).not.toMatch(/classList\.add\(|className\s*=\s*["'`]/);
  });

  it("the flight never scrolls the transcript to make itself possible", () => {
    // The card is where the user left it. Moving the conversation so an
    // animation can play is the animation deciding what you are reading.
    expect(rail).not.toContain("scrollIntoView");
    expect(rail).not.toContain("scrollTo(");
  });

  it("both take-off points and the landing point are marked in the DOM", () => {
    const card = readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
    // Two card roots: the delegation card and the generic one `terminal_run`
    // uses. Miss either and that family silently never flies.
    expect(card.match(/data-hv-run-card=/g)?.length).toBe(2);
    expect(chat).toContain("data-hv-run-avatar={a.domKey}");
  });

  it("the circle is keyed on domKey, not on the map key", () => {
    // The map key changes mid-run when an async delegation is re-keyed, which
    // destroys the DOM node the flight is aiming at.
    expect(rail).toContain("key={a.domKey}");
  });
});

describe("the circle's enter, exit and shift (A2)", () => {
  it("enters with a scale-up and leaves by shrinking, both motion-safe", () => {
    expect(rail).toContain("motion-safe:starting:scale-[.6]");
    expect(rail).toContain("data-[leaving]:scale-[.15]");
  });

  it("the exit does NOT touch opacity — the pulse owns it", () => {
    // Measured twice, after "the kill is almost invisible" was reported twice.
    // `RUN_STATE_RING` puts `animate-pulse` on the live states, which animates
    // the same opacity an exit would fade, and a CSS animation beats a
    // transition outright: with the pulse running the fade never happened at
    // all, and killing the animation instead snapped opacity to 0 in one frame.
    // Scale is uncontested and traces cleanly, so the exit is scale only.
    // Scoped to the CIRCLE's own class string: the rail's expanded overlay is
    // in this slice too and fades quite correctly — it has no pulse to fight.
    const circle = rail.slice(rail.indexOf("data-hv-run-avatar={a.domKey}"));
    const cls = circle.slice(circle.indexOf("className={`size-9"), circle.indexOf("`}", circle.indexOf("className={`size-9")));
    expect(cls).toContain("data-[leaving]:scale-[.15]");
    expect(cls).not.toContain("data-[leaving]:opacity");
  });

  it("it shrinks far enough that removal is not a pop", () => {
    // The circle is deleted at the end of this. Stopping at .6 and vanishing
    // reads as a disappearance; .15 reads as having gone.
    const m = /data-\[leaving\]:scale-\[\.(\d+)\]/.exec(rail.slice(rail.indexOf("data-hv-run-avatar={a.domKey}")));
    expect(m).toBeTruthy();
    expect(Number(`0.${m![1]}`)).toBeLessThanOrEqual(0.2);
  });

  it("siblings close the gap with FLIP rather than teleporting", () => {
    expect(rail).toContain("flipChildren");
    expect(rail).toContain("snapshotRects");
  });

  it("the ring colour transitions, and the map stays data", () => {
    expect(rail).toMatch(/transition-\[[^\]]*border-color/);
    const runRail = readFileSync("src/renderer/src/runRail.ts", "utf8");
    expect(runRail).toContain("export const RUN_STATE_RING");
  });
});

describe("the overlay and the hover readout (A3)", () => {
  it("the overlay grows from the circle that opened it", () => {
    expect(rail).toContain("transformOrigin");
  });

  it("the hover readout has NO exit", () => {
    // The STOP lives inside this panel. An exit animation means the panel is
    // still on screen after the pointer has left it, so a click aimed at STOP
    // can land on a panel that is already dying — or worse, feel like it
    // worked. Instant is the safe direction here.
    const readout = rail.slice(rail.indexOf("hover === a.key && open !== a.key"));
    expect(readout.slice(0, 900)).toContain("pt-1");
    expect(readout.slice(0, 900)).not.toContain("data-[leaving]");
  });

  it("still has no click-catcher and nothing above z-20", () => {
    // Unchanged from 2026-08-31 and re-asserted because this round touched
    // every line around them: a `fixed inset-0` catcher reads as covering every
    // browser pane (browserCoverage judges by BOX), and z-20 is the rail's
    // ceiling.
    expect(rail).not.toContain("fixed inset-0");
    expect(rail).not.toMatch(/\bz-(?:3\d|4\d|5\d|\[\d{3}\])\b/);
  });

  it("the sticky wrapper string is untouched", () => {
    expect(chat).toContain('className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full"');
  });
});

/**
 * A run's circle must still be on screen while it fades (2026-09-10).
 *
 * The exit is a CSS duration on the circle; the removal is a `setTimeout` in
 * App. Nothing connects them, so the 1.5x rescale moved the fade to 220ms and
 * left both delete timers where they were — cutting every exit off partway,
 * which looks exactly like no animation at all. That is how a killed terminal
 * was reported as "almost invisible".
 *
 * Both timers are expressed in terms of `DUR` now, so the two move together.
 */
describe("a circle outlives its own exit animation", () => {
  const motion = readFileSync("src/renderer/src/motion.ts", "utf8");
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");
  const DUR_BASE = Number(/base:\s*(\d+)/.exec(motion)?.[1]);

  it("the CSS exit duration is the same token the timers use", () => {
    expect(DUR_BASE).toBeGreaterThan(0);
    expect(chat).toContain(`motion-safe:data-[leaving]:duration-${DUR_BASE}`);
  });

  it("a terminal is removed no sooner than its fade ends", () => {
    // Was `DUR.fast`, which is shorter than the fade — the circle vanished
    // mid-animation.
    const drop = app.slice(app.indexOf("const dropAgentTerminal"), app.indexOf("const dropAgentTerminal") + 1400);
    expect(drop).toContain("leaving: true");
    expect(drop).toContain("}, DUR.base);");
  });

  it("a delegation raises `leaving` a full exit before it is deleted", () => {
    // The pair must stay a pair: a hardcoded gap silently stops matching the
    // fade the moment the scale changes, which is exactly what happened.
    expect(app).toContain("}, 2_500 - DUR.base);");
    expect(app.match(/\}, 2_500 - DUR\.base\);/g)?.length).toBe(2);
    expect(app.match(/\}, 2_500\);/g)?.length).toBe(2);
  });
});
