import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chipsFor, folderHasCode, ONBOARDING_COPY, shouldShowOnboarding } from "../src/renderer/src/onboarding";

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
  it("is CSS keyframes, and the settled frame is reachable without motion", () => {
    expect(has(CSS, "@keyframes hv-bounce-in"), "bounce keyframes").toBe(true);
    expect(has(CSS, "@media (prefers-reduced-motion: reduce)"), "reduced-motion block").toBe(true);
  });

  it("reduced motion renders the settled frame rather than a faster bounce", () => {
    // `both` fill means killing the animation leaves the authored transform, so
    // the settled tilt has to be restated inside the query.
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(has(block, "animation: none"), "animation: none").toBe(true);
    expect(has(block, "rotate(-3deg)"), "the settled tilt").toBe(true);
  });

  it("brings no animation runtime — the CSP is script-src 'self' with no blob: or data:", () => {
    const src = flat(DIALOG);
    expect(/lottie|gsap|framer-motion|createObjectURL|new Blob/i.test(src), "no runtime").toBe(false);
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
