import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chipsFor, folderHasCode, ONBOARDING_COPY, rankProviders, shouldShowOnboarding } from "../src/renderer/src/onboarding";

/**
 * §22 onboarding round (2026-09-01).
 *
 * The renderer suite has no DOM (vitest.config.ts includes `tests/**\/*.test.ts`
 * only), so a visual/wiring contract is pinned in two halves: the copy and the
 * predicates ship as pure exports and are asserted directly, and the FACTS about
 * the components are comment-stripped, whitespace-collapsed source scans — the
 * tests/modal-layer.test.ts idiom, which survives JSX line-wrapping.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const read = (rel: string): string => fs.readFileSync(path.join(R, rel), "utf8");

/** Comments stripped and whitespace collapsed, so line-wrapping cannot hide a match. */
export const flat = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*/gm, "")
    .replace(/\s+/g, " ");

const APP = read("App.tsx");

/**
 * Assert a substring WITHOUT feeding vitest the haystack: `expect(src).toContain(x)`
 * on a 3,000-line file prints the whole file on failure, which buries the one
 * line that matters. The boolean carries the needle as its message instead.
 */
export const has = (src: string, needle: string): boolean => src.includes(needle);

describe("credential state is pushed, not pulled once", () => {
  it("App re-reads the gate when main says providers changed", () => {
    // hv:providers-changed already existed (ipc.ts) and ONLY ChatView consumed
    // it, so a sign-in completed anywhere else left App's keyState stale — and
    // the wizard's step-1 checkmark derives from exactly that state.
    const src = flat(APP);
    expect(has(src, "window.hv.onProvidersChanged"), "onProvidersChanged").toBe(true);
    expect(has(src, "refreshKeyState"), "refreshKeyState").toBe(true);
  });

  it("the subscription re-reads the gate rather than only refreshing models", () => {
    const src = flat(APP);
    const reader = src.slice(src.indexOf("const refreshKeyState"), src.indexOf("const refreshKeyState") + 240);
    expect(has(reader, "window.hv.hasAnyProvider()"), "the reader calls the gate").toBe(true);
  });
});

describe("shouldShowOnboarding", () => {
  it("shows only on a truly untouched install", () => {
    expect(shouldShowOnboarding({ seen: false, workspaces: 0, sessions: 0 })).toBe(true);
  });

  it("never shows once the flag is set", () => {
    expect(shouldShowOnboarding({ seen: true, workspaces: 0, sessions: 0 })).toBe(false);
  });

  it("never shows to an install with history — the flag alone is NOT the migration", () => {
    // onboardingSeen was only ever written when the OLD overlay was dismissed,
    // and that overlay only appeared at first-session creation. Everyone past
    // that moment still reads false.
    expect(shouldShowOnboarding({ seen: false, workspaces: 1, sessions: 0 })).toBe(false);
    expect(shouldShowOnboarding({ seen: false, workspaces: 0, sessions: 1 })).toBe(false);
    expect(shouldShowOnboarding({ seen: false, workspaces: 2, sessions: 9 })).toBe(false);
  });
});

describe("chipsFor", () => {
  it("offers a tour when the folder has code and a build when it does not", () => {
    expect(chipsFor(true)).toHaveLength(3);
    expect(chipsFor(false)).toHaveLength(3);
    expect(chipsFor(true)).not.toEqual(chipsFor(false));
    expect(chipsFor(true).join(" ")).toContain("tour");
  });

  it("the empty branch asks the agent to CREATE something — that is why no sample project ships", () => {
    expect(chipsFor(false).join(" ")).toMatch(/Build|Make|Start/);
  });
});

describe("folderHasCode", () => {
  it("ignores dotfiles — a folder holding only .git is empty to a beginner", () => {
    expect(folderHasCode([])).toBe(false);
    expect(folderHasCode([{ name: ".git" }, { name: ".DS_Store" }])).toBe(false);
    expect(folderHasCode([{ name: ".git" }, { name: "index.html" }])).toBe(true);
  });
});

describe("ONBOARDING_COPY", () => {
  it("carries the locked tagline verbatim", () => {
    expect(ONBOARDING_COPY.tagline).toBe("Good vibes, real code.");
  });

  it("does not promise the agent stays inside the folder — bash is not path-inspected", () => {
    // §10 asks before FILE access outside the workspace root; it does not
    // confine bash. "asks first" is the honest clause; "nowhere else" is not.
    expect(ONBOARDING_COPY.step2Body).toContain("asks first");
    expect(ONBOARDING_COPY.step2Body).not.toMatch(/never leaves|nowhere else|only inside|can't touch/i);
  });

  it("every entry is a non-empty string", () => {
    for (const [k, v] of Object.entries(ONBOARDING_COPY)) {
      expect(typeof v, k).toBe("string");
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});

const DIALOG = read("components/OnboardingDialog.tsx");
const DOORS = read("components/OnboardingDoors.tsx");
const CHAT = read("components/ChatView.tsx");
const CSS = fs.readFileSync(path.join(R, "styles.css"), "utf8");

describe("the welcome animation obeys the CSP and reduced motion", () => {
  it("is CSS keyframes — three beats, in order", () => {
    for (const k of ["hv-logo-travel", "hv-logo-hop", "hv-word-drop", "hv-tag-in"]) {
      expect(has(CSS, `@keyframes ${k}`), k).toBe(true);
    }
  });

  it("the hop eases per keyframe, or it reads as a slide rather than gravity", () => {
    // A ball accelerates falling and decelerates rising. One transform cannot
    // express that without a timing function INSIDE each keyframe — the
    // interval that starts there. Symmetrical arcs are the tell.
    const hop = CSS.slice(CSS.indexOf("@keyframes hv-logo-hop"));
    const block = hop.slice(0, hop.indexOf("\n}"));
    expect((block.match(/animation-timing-function: ease-in/g) ?? []).length, "falls").toBeGreaterThan(2);
    expect((block.match(/animation-timing-function: ease-out/g) ?? []).length, "rises").toBeGreaterThan(2);
  });

  it("travel and hop are separate animations — X and Y need different easing", () => {
    expect(has(CSS, ".hv-logo-travel { animation:"), "travel").toBe(true);
    expect(has(CSS, ".hv-logo-hop    { animation:"), "hop").toBe(true);
  });

  it("the whole film stays inside §22's locked 2.5s budget", () => {
    // tagline is the last beat: delay + duration must land under 2500ms.
    const tag = CSS.slice(CSS.indexOf(".hv-tag-in "), CSS.indexOf(".hv-tag-in ") + 80);
    const [dur, delay] = (tag.match(/(\d+)ms/g) ?? []).map((x) => parseInt(x, 10));
    expect(dur + delay, `${dur}+${delay}`).toBeLessThanOrEqual(2500);
  });

  it("reduced motion renders the settled frame rather than a faster bounce", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(has(block, "animation: none"), "animation: none").toBe(true);
    expect(has(block, "rotate(-3deg)"), "the settled tilt").toBe(true);
  });

  it("a click lands the settled frame instead of playing faster", () => {
    expect(has(CSS, ".hv-logo-settled"), "settled class").toBe(true);
    expect(has(flat(DIALOG), 'welcome ? "hv-logo-hop" : "hv-logo-settled"'), "swapped on skip").toBe(true);
  });

  it("brings no animation runtime — the CSP is script-src 'self' with no blob: or data:", () => {
    const src = flat(DIALOG);
    expect(/lottie|gsap|framer-motion|createObjectURL|new Blob/i.test(src), "no runtime").toBe(false);
  });
});

describe("the dialog is a workbench, and a fixed one", () => {
  it("wears the sidebar's own surface, not a white sheet", () => {
    // bg-paper-deep + .pegboard is Sidebar.tsx's surface — the workshop board
    // the app is built on, reused rather than a fourth background invented.
    const src = flat(DIALOG);
    expect(has(src, "bg-paper-deep pegboard"), "pegboard").toBe(true);
    const SIDEBAR = read("components/Sidebar.tsx");
    expect(has(flat(SIDEBAR), "bg-paper-deep pegboard"), "same as the sidebar").toBe(true);
  });

  it("is a FIXED size — beats change the panel, never the frame", () => {
    // Growing for step 1 and shrinking for the celebration re-anchors the
    // dialog under the pointer three times in one flow.
    const src = flat(DIALOG);
    // The SHAPE, not the numbers: a tweak to the size is a design call, but
    // going back to a max/auto height is the regression this guards.
    expect(/w-\[min\(\d+rem,calc\(100vw-[\d.]+rem\)\)\]/.test(src), "fixed width").toBe(true);
    expect(/h-\[min\(\d+rem,calc\(100vh-[\d.]+rem\)\)\]/.test(src), "fixed height").toBe(true);
    // No max-h: a max is a size that still moves.
    expect(/max-h-\[/.test(src), "no max-height").toBe(false);
  });

  it("is two columns — brand left, work right", () => {
    expect(has(flat(DIALOG), "grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]"), "two columns").toBe(true);
  });

  it("clips the logo while it is still off frame", () => {
    // The travel starts at 60rem. Without overflow-hidden the brand mark is
    // visible sitting outside the dialog before the film starts.
    expect(has(flat(DIALOG), "overflow-hidden"), "overflow-hidden").toBe(true);
  });

  it("the celebration lands in the right panel, so the brand column never moves", () => {
    const src = flat(DIALOG);
    const brand = src.indexOf("hv-logo-travel");
    const party = src.indexOf("C.doneTitle");
    expect(party, "celebration after the brand column").toBeGreaterThan(brand);
    // It renders INSIDE the right panel, not as a sibling that replaces the
    // whole grid — that is what keeps the left column and the frame still.
    const panel = src.indexOf("hv-rise-in h-full overflow-y-auto");
    expect(panel, "the right panel exists").toBeGreaterThan(-1);
    expect(party, "inside the right panel").toBeGreaterThan(panel);
  });

  it("closes with a subtle cross that still names itself", () => {
    const src = flat(DIALOG);
    expect(has(src, "✕"), "the glyph").toBe(true);
    // text-ink-soft/hover:text-ink is the app's existing close idiom
    // (TerminalRunCard, ChatView search), not a new colour.
    expect(has(src, "text-ink-soft hover:text-ink"), "house colours").toBe(true);
    // A bare glyph must not be the whole explanation.
    expect(has(src, "title={C.skip}"), "named").toBe(true);
    expect(has(src, "aria-label={C.skip}"), "labelled").toBe(true);
  });
});

describe("the dialog is a real modal on the shipped layer", () => {
  it("uses the two dialog classes rather than inventing a layer", () => {
    const src = flat(DIALOG);
    expect(has(src, "hv-overlay"), "hv-overlay").toBe(true);
    expect(has(src, "hv-dialog"), "hv-dialog").toBe(true);
  });

  it("the first Escape lands the animation and only the second dismisses", () => {
    const src = flat(DIALOG);
    expect(has(src, "if (welcome) { setWelcome(false); return; }"), "escape chain").toBe(true);
  });
});

describe("first run suppresses the forced-Models redirect", () => {
  it("App stops pinning the view while the wizard is up", () => {
    // Leaving it on would put the SAME three doors behind the scrim the wizard
    // is already showing, and dismissing would land on a page already there.
    expect(has(flat(APP), 'needsSetup && !onboarding ? "models" : view'), "conditioned redirect").toBe(true);
  });
});

describe("the wizard's provider doors", () => {
  it("reuse the shipped auth modal rather than a second sign-in UI", () => {
    const src = flat(DOORS);
    expect(has(src, "AuthFlowModal"), "AuthFlowModal").toBe(true);
    expect(has(src, "window.hv.authLogin"), "authLogin").toBe(true);
  });

  it("never re-list the sign-in providers — main owns that list", () => {
    const src = flat(DOORS);
    for (const hardcoded of ["ChatGPT", "GitHub Copilot", "anthropic", "openai-codex"]) {
      expect(has(src, hardcoded), `hand-listed ${hardcoded}`).toBe(false);
    }
  });

  it("offer a local runner only when one holds models", () => {
    // Don't show what cannot work: a listening port with no models is a button
    // that fails on click, and the Models page owns the "not found" story.
    const src = flat(DOORS);
    expect(has(src, "models.length > 0"), "models gate").toBe(true);
    expect(/not found|Install from ollama\.com|Check again/.test(src), "no dead rows").toBe(false);
  });

  it("do not fork ModelsView", () => {
    expect(has(flat(DOORS), "ModelsView"), "no ModelsView").toBe(false);
  });

  it("keep the key probe honest at entry", () => {
    expect(has(flat(DOORS), "window.hv.setProviderKey"), "setProviderKey").toBe(true);
  });
});

describe("the first-prompt chips", () => {
  it("insert into the composer and never send", () => {
    const src = flat(CHAT);
    const i = src.indexOf("onChip?.(");
    expect(i, "onChip call site").toBeGreaterThan(-1);
    // promptSession IS the send. It must be nowhere near the chip handler.
    expect(has(src.slice(i - 400, i + 400), "promptSession"), "chip does not send").toBe(false);
  });

  it("App branches them on what the folder actually holds", () => {
    const src = flat(APP);
    expect(has(src, "chipsFor(folderHasCode(entries))"), "derived branch").toBe(true);
    expect(has(src, "window.hv.fsList"), "fsList probe").toBe(true);
  });

  it("are cleared by the first send and never restored", () => {
    const src = flat(APP);
    expect(has(src, "if (chips) setChips(null);"), "cleared on send").toBe(true);
    expect((src.match(/setChips\(/g) ?? []).length, "only two writers").toBe(2);
  });
});

describe("the two wow notices", () => {
  it("fire once each, as the existing transcript capsule", () => {
    const src = flat(APP);
    expect(has(src, 'kind: "notice", text: ONBOARDING_COPY.noticeTools'), "tools notice").toBe(true);
    expect(has(src, 'kind: "notice", text: ONBOARDING_COPY.noticeContext'), "context notice").toBe(true);
    expect(has(src, "wowShown.current.tools = true"), "once").toBe(true);
    expect(has(src, "wowShown.current.context = true"), "once").toBe(true);
  });

  it("are scoped to the session the wizard opened, not to any first session", () => {
    const src = flat(APP);
    expect((src.match(/sid === firstRunSession\.current/g) ?? []).length, "both gated").toBe(2);
  });
});

describe("the bottom-right overlay is gone", () => {
  it("has no file and no import", () => {
    expect(fs.existsSync(path.join(R, "components/OnboardingOverlay.tsx")), "file").toBe(false);
    expect(has(APP, "OnboardingOverlay"), "import").toBe(false);
  });

  it("takes its four steps with it — the wizard and the notices own them now", () => {
    const all: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (/\.tsx?$/.test(e.name)) all.push(fs.readFileSync(q, "utf8"));
      }
    };
    walk(R);
    const src = flat(all.join("\n"));
    for (const dead of ["Get to the good part", "Ask the agent to explore it", "Watch the live trace"]) {
      expect(has(src, dead), dead).toBe(false);
    }
  });
});

describe("no dead copy", () => {
  it("every ONBOARDING_COPY key has a call site in the renderer", () => {
    // Unreferenced copy is exactly the drift these records exist to end —
    // the EMPTY_COPY rule (§20 round 17), applied here.
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name)) sources.push(fs.readFileSync(p, "utf8"));
      }
    };
    walk(R);
    const all = sources.join("\n");
    for (const key of Object.keys(ONBOARDING_COPY)) {
      const used = all.includes(`C.${key}`) || all.includes(`ONBOARDING_COPY.${key}`);
      expect(used, `dead copy: ${key}`).toBe(true);
    }
  });
});

describe("a key the provider refused survives step 1 checking itself", () => {
  it("the note is owned by the dialog, not by the doors that unmount", () => {
    // setProviderKey SAVES the key whatever the answer, so a typo'd key flips
    // the gate, collapses step 1 and unmounts ProviderDoors. Measured before
    // the fix: a bogus Anthropic key checked step 1 and showed nothing at all.
    expect(has(flat(DIALOG), "note={keyNote}"), "StepRow renders the note").toBe(true);
    expect(has(flat(DIALOG), "onNote={setKeyNote}"), "the dialog owns it").toBe(true);
    expect(has(flat(DOORS), "onNote(note)"), "the doors report it up").toBe(true);
  });

  it("the row renders its note whether or not it is done", () => {
    const src = flat(DIALOG);
    const i = src.indexOf("{note && <p");
    expect(i, "note render").toBeGreaterThan(-1);
    // It must sit OUTSIDE the `active &&` guard, or it dies with the doors.
    expect(i, "before the active guard").toBeLessThan(src.indexOf("{active && <div"));
  });
});

describe("main's refusal reaches the user as main wrote it", () => {
  it("the IPC preamble is stripped from one shared definition", () => {
    // ipcRenderer.invoke wraps a thrown Error in "Error invoking remote method
    // '<channel>': " — measured leaking verbatim into the Start fresh field.
    const src = flat(read("ipcError.ts"));
    expect(has(src, "Error invoking remote method"), "the cleaner").toBe(true);
    expect(has(flat(DIALOG), "ipcMessage(err)"), "the dialog uses it").toBe(true);
    expect(has(flat(APP), "ipcMessage(err)"), "surface() uses it").toBe(true);
    // And nobody re-types the expression.
    const R2 = path.resolve(__dirname, "../src/renderer/src");
    const all: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (/\.tsx?$/.test(e.name) && e.name !== "ipcError.ts") all.push(fs.readFileSync(q, "utf8"));
      }
    };
    walk(R2);
    expect(has(all.join("\n"), "invoking remote method"), "no second copy").toBe(false);
  });
});

describe("an empty folder is not asked to document itself", () => {
  it("the AGENTS.md offer needs actual content, not just a missing file", () => {
    // After the wizard hands over into a freshly created empty folder, this
    // banner was the FIRST sentence a new user read: "No AGENTS.md found — add
    // project context so the agent understands this codebase?" about a codebase
    // that does not exist yet.
    const src = flat(CHAT);
    expect(has(src, "content === null && folderHasCode(entries)"), "gated on content").toBe(true);
  });

  it("uses the same dotfile rule as the chips, not a second one", () => {
    expect(has(flat(CHAT), 'folderHasCode } from "../onboarding"'), "shared predicate").toBe(true);
  });
});

describe("opening the wizard does not focus the way out", () => {
  it("auto-focus is redirected off the dismiss button", () => {
    // Radix focuses the first tabbable, which is ✕ — so the dialog opened with
    // a focus ring around it and Enter cancelled onboarding outright.
    const src = flat(DIALOG);
    expect(has(src, "onOpenAutoFocus"), "handled").toBe(true);
    expect(has(src, "contentRef.current?.focus()"), "focus lands on the dialog").toBe(true);
  });

  it("keeps a real focus target rather than just suppressing the ring", () => {
    // Hiding the outline would have cost keyboard users their only indicator.
    const src = flat(DIALOG);
    const btn = src.slice(src.indexOf("aria-label={C.skip}"), src.indexOf("aria-label={C.skip}") + 260);
    expect(/focus:outline-none|focus-visible:outline-none/.test(btn), "ring not suppressed").toBe(false);
  });
});

describe("the frame clips nothing — the panel scrolls instead", () => {
  it("the grid row cannot outgrow the fixed frame", () => {
    // Measured before the fix: dialog scrollHeight-clientHeight = 121px with
    // panel scroll 0. An auto grid row grew past h-full, the panel's h-full
    // resolved to the GROWN height so it never scrolled, and overflow-hidden
    // ate 121px of step 1 in silence.
    const src = flat(DIALOG);
    expect(has(src, "grid-rows-[minmax(0,1fr)]"), "bounded row").toBe(true);
    // min-h-0 on both columns, or the row's children set the floor again.
    expect((src.match(/min-h-0/g) ?? []).length, "both columns").toBeGreaterThanOrEqual(2);
  });
});

describe("rankProviders", () => {
  const rows = [
    { id: "zzz", label: "Zed AI", featured: false },
    { id: "openai", label: "OpenAI", featured: true },
    { id: "aaa", label: "Acme", featured: false },
    { id: "deepseek", label: "DeepSeek", featured: true },
  ];

  it("puts the popular ones first, then everything else A–Z", () => {
    expect(rankProviders(rows, "").map((r) => r.id)).toEqual(["deepseek", "openai", "aaa", "zzz"]);
  });

  it("offers ALL providers, not just the featured five", () => {
    expect(rankProviders(rows, "")).toHaveLength(rows.length);
  });

  it("searches label and id, and keeps popular-first inside the results", () => {
    expect(rankProviders(rows, "e").map((r) => r.id)).toEqual(["deepseek", "openai", "aaa", "zzz"]);
    expect(rankProviders(rows, "acme").map((r) => r.id)).toEqual(["aaa"]);
    expect(rankProviders(rows, "zzz").map((r) => r.id)).toEqual(["zzz"]);
  });

  it("returns nothing for a query that matches nothing — the picker says so", () => {
    expect(rankProviders(rows, "nothingmatches")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    rankProviders(rows, "");
    expect(rows).toEqual(copy);
  });

  it("'popular' is the catalog's own featured flag, not a list invented here", () => {
    const src = flat(read("onboarding.ts"));
    expect(/POPULAR_PROVIDERS|["'](openai|anthropic|deepseek)["']\s*,/.test(src), "no hand-list").toBe(false);
  });
});

describe("step 1 is a choice before it is a list", () => {
  it("offers §16's three ladder rungs and opens on rung 1", () => {
    // All three LISTS at once is what pushed step 2 below the fold; the rungs
    // are the choice, and the recommended one is already open.
    const src = flat(DOORS);
    expect(has(src, 'type Rung = "plan" | "local" | "key"'), "the rungs").toBe(true);
    expect(has(src, 'useState<Rung>("plan")'), "opens on rung 1").toBe(true);
    for (const gate of ['show={rung === "plan"}', 'show={rung === "local"}', 'show={rung === "key"}']) {
      expect(has(src, gate), gate).toBe(true);
    }
  });

  it("switching rungs cannot resize the card", () => {
    // Every rung sits in the SAME grid cell, so the card is always as tall as
    // the tallest one. A fixed pixel height would do this too and then be wrong
    // the day a provider is added.
    const src = flat(DOORS);
    expect(has(src, "col-start-1 row-start-1"), "one cell").toBe(true);
    // `invisible`, not `hidden`: a hidden panel must still be MEASURED, or the
    // cell shrinks to the visible one and the blink comes back.
    expect(has(src, "invisible pointer-events-none"), "measurable when hidden").toBe(true);
    expect(/\bhidden\b/.test(src.slice(src.indexOf("function RungPanel"), src.indexOf("function RungPanel") + 400)), "not display:none").toBe(false);
  });

  it("offers the local rung only when a runner is actually there", () => {
    expect(has(flat(DOORS), "local.length > 0 && ("), "conditional rung").toBe(true);
  });
});

describe("the API-key picker", () => {
  it("offers every catalog provider, not the featured five", () => {
    // p.byok whole, not p.byok.filter(featured) — the old <select> showed 5 of 29.
    const src = flat(DOORS);
    expect(has(src, "setByok(p.byok);"), "all of them").toBe(true);
    expect(/byok\.filter\(\(b\) => b\.featured\)/.test(src), "not pre-filtered").toBe(false);
  });

  it("is searchable and ranks popular first", () => {
    const src = flat(DOORS);
    expect(has(src, "rankProviders(rows, query)"), "ranked").toBe(true);
    expect(has(src, "ONBOARDING_COPY.step1Search") || has(src, "C.step1Search"), "search field").toBe(true);
    expect(has(src, "C.step1Popular"), "popular group").toBe(true);
  });

  it("dismisses with the click-catcher, never onBlur", () => {
    // Pressing a button does not focus it, so a blur guard unmounts the menu
    // BETWEEN mousedown and mouseup and the click lands on nothing.
    const src = flat(DOORS);
    expect(has(src, 'className="fixed inset-0 z-10"'), "catcher").toBe(true);
    expect(/onBlur=/.test(src), "no blur dismissal").toBe(false);
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    expect(has(flat(DOORS), "C.step1NoProvider"), "empty state").toBe(true);
  });
});

describe("the right panel has no white sheet", () => {
  it("the steps sit on the board, like the brand column does", () => {
    const src = flat(DIALOG);
    const panel = src.slice(src.indexOf("hv-rise-in h-full"), src.indexOf("hv-rise-in h-full") + 120);
    expect(/bg-card/.test(panel), "no card background on the panel").toBe(false);
  });
});

describe("the setup panel is clean", () => {
  it("has no header — the numbered cards already say it", () => {
    expect(has(flat(DIALOG), "setupHeader"), "no header").toBe(false);
    expect(Object.keys(ONBOARDING_COPY), "and its copy is gone").not.toContain("setupHeader");
  });

  it("centres the stack rather than pinning it to the top", () => {
    // Top-anchored left a dead strip along the bottom of the panel; the left
    // column centres too, so this is the pair agreeing.
    expect(has(flat(DIALOG), "h-full flex flex-col justify-center gap-3"), "centred").toBe(true);
  });
});

describe("the margin round the content is the same on all four sides", () => {
  it("one padding value, and the column gap matches it", () => {
    // Measured before: 48/44 vertical against 32/28 horizontal. The dialog's
    // own padding is now the whole margin — no per-column padding on top.
    const src = flat(DIALOG);
    expect(has(src, "shadow-pop p-7"), "one padding").toBe(true);
    expect(has(src, "gap-7"), "gap matches it").toBe(true);
    expect(/min-w-0 min-h-0 pl-\d/.test(src), "no extra left padding").toBe(false);
    expect(/overflow-y-auto pr-\d/.test(src), "no extra right padding").toBe(false);
  });
});

describe("the handover beat is actually visible", () => {
  it("pops in three staggered parts rather than fading the whole panel", () => {
    // 340ms of rise on a whole panel reads as nothing happening — you just
    // find "You're in." already sitting there.
    for (const k of ["@keyframes hv-burst", "@keyframes hv-pop-up"]) {
      expect(has(CSS, k), k).toBe(true);
    }
    const src = flat(DIALOG);
    for (const c of ["hv-burst", "hv-done-title", "hv-done-body"]) {
      expect(has(src, c), c).toBe(true);
    }
  });

  it("holds long enough to be read once the pops finish", () => {
    // Staggered delays end ~920ms in; the handover must come after that.
    expect(has(flat(DIALOG), "setTimeout(onDone, 2200)"), "dwell").toBe(true);
  });

  it("is settled instantly under reduced motion, like every other beat", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const c of ["hv-burst", "hv-done-title", "hv-done-body"]) {
      expect(has(block, c), c).toBe(true);
    }
  });
});
