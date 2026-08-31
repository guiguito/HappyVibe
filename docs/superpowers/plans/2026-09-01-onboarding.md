# Onboarding Round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom-right 4-step onboarding overlay with one landscape first-run dialog — welcome animation, two derived setup steps, and a handover that opens the first session with prompt chips.

**Architecture:** The dialog owns no state machine. Step done-ness is derived from the app's real gates (`hv:has-any-provider`, `workspaces.length`), which forces two predicate repairs first: `App` must consume the existing `hv:providers-changed` push instead of pulling once at mount, and `hv:has-any-provider` must stop ignoring custom endpoints and the LM Studio / llama.cpp auto-detect. The dialog hosts three provider doors of its own over existing IPC; `ModelsView` is neither extracted nor embedded.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4, Radix Dialog, vitest (no DOM).

**Spec:** Notion "✈️ Proper user onboarding" (`3cdd33dfffca800988b7d05ee1abcc6d`); folded into `docs/prd.md` §22 as **Decision (Onboarding round, 2026-09-01)**.

## Global Constraints

- **Tagline is exactly** `Good vibes, real code.`
- **Start fresh parent directory is exactly** `~/Documents/HappyVibe`.
- **Show-the-wizard predicate is exactly** `!onboardingSeen && workspaces.length === 0 && sessions.length === 0`.
- **Animation is CSS keyframes only.** The renderer CSP is `script-src 'self'` with no `blob:` / `data:` — no animation runtime, no Lottie.
- **`prefers-reduced-motion: reduce` renders the settled frame.** `styles.css` has no such block today; it arrives with this feature.
- **`.hv-overlay` / `.hv-dialog` stay at `z-index: 100`.** Nothing new climbs above it (`tests/modal-layer.test.ts` scans for that).
- **Chips insert, never send.**
- **All copy ships in `ONBOARDING_COPY`,** under the `EMPTY_COPY` no-dead-copy rule: a key with no call site fails its test.
- **The renderer suite has no DOM.** Assert on exported data plus comment-stripped, whitespace-collapsed source scans.
- **`ModelsView.tsx` is not modified** (except where a task explicitly says so — no task does).
- Gate per task: `npm run gate` (= build → both typechecks → non-live suite). Never run `npm run typecheck` separately before it.

## File map

| File | Responsibility |
|---|---|
| `src/main/providers.ts` | +`anyProviderConfigured(facts)` — the pure decision behind `hv:has-any-provider` |
| `src/main/ipc.ts:3203` | handler gathers facts, delegates the decision; +`hv:create-workspace-folder` |
| `src/main/files.ts` | +`createWorkspaceFolder(name)` — confined `mkdir` under `~/Documents/HappyVibe` |
| `src/renderer/src/onboarding.ts` | **new, pure** — `ONBOARDING_COPY`, `shouldShowOnboarding`, `chipsFor` |
| `src/renderer/src/components/OnboardingDialog.tsx` | **new** — the three beats and the three doors |
| `src/renderer/src/App.tsx` | mount the dialog, suppress the redirect, subscribe `keyState`, fire the notices, hold chips |
| `src/renderer/src/components/ChatView.tsx` | render the chips row above the composer |
| `src/renderer/src/styles.css` | bounce/settle keyframes + the reduced-motion block |
| `src/renderer/src/components/OnboardingOverlay.tsx` | **deleted** (Task 9) |
| `tests/onboarding.test.ts` | **new** — copy record, predicates, chips, source scans |
| `tests/has-any-provider.test.ts` | **new** — the four ways a provider can exist |

---

### Task 1: `hv:has-any-provider` stops missing local runners and custom endpoints

Today `ipc.ts:3203-3208` counts BYOK keys, `auth.json` credentials and **Ollama only**. `syncModelsJson` (`providers.ts:179`) already writes LM Studio and llama.cpp into `models.json` before every spawn, and `listCustomEndpoints()` holds hand-added ones — so a user with a working model is pinned to the forced-Models page. Step 1's checkmark derives from this predicate, so it is repaired first.

**Files:**
- Modify: `src/main/providers.ts` (add `anyProviderConfigured`)
- Modify: `src/main/ipc.ts:3202-3208`
- Test: `tests/has-any-provider.test.ts`

**Interfaces:**
- Produces: `anyProviderConfigured(facts: { keyStatus: Record<string, unknown>; authProviders: string[]; customEndpoints: { auth: { kind: string } }[]; customKeyStatus: Record<string, boolean>; localRunning: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { anyProviderConfigured } from "../src/main/providers";

const none = {
  keyStatus: {} as Record<string, unknown>,
  authProviders: [] as string[],
  customEndpoints: [] as { id: string; auth: { kind: string } }[],
  customKeyStatus: {} as Record<string, boolean>,
  localRunning: false,
};

describe("anyProviderConfigured", () => {
  it("is false when nothing is configured", () => {
    expect(anyProviderConfigured(none)).toBe(false);
  });

  it("counts a BYOK key", () => {
    expect(anyProviderConfigured({ ...none, keyStatus: { deepseek: "stored" } })).toBe(true);
  });

  it("counts an auth.json credential", () => {
    expect(anyProviderConfigured({ ...none, authProviders: ["anthropic"] })).toBe(true);
  });

  it("counts a running local runner — the LM Studio-only user is not locked out", () => {
    expect(anyProviderConfigured({ ...none, localRunning: true })).toBe(true);
  });

  it("counts a keyless custom endpoint (placeholder auth = a local server)", () => {
    const e = [{ id: "vllm", auth: { kind: "placeholder" } }];
    expect(anyProviderConfigured({ ...none, customEndpoints: e })).toBe(true);
  });

  it("does NOT count a custom endpoint whose key is missing", () => {
    const e = [{ id: "acme", auth: { kind: "env" } }];
    expect(anyProviderConfigured({ ...none, customEndpoints: e })).toBe(false);
    expect(anyProviderConfigured({ ...none, customEndpoints: e, customKeyStatus: { acme: true } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/has-any-provider.test.ts`
Expected: FAIL — `anyProviderConfigured` is not exported.

- [ ] **Step 3: Add the pure function**

In `src/main/providers.ts`:

```ts
/**
 * The first-run gate's decision, separated from its facts so it is testable.
 *
 * Four ways a model can already exist. The last two were missing until
 * 2026-09-01: `syncModelsJson` injects LM Studio / llama.cpp into models.json
 * before every spawn, and a hand-added endpoint is a provider too — so a user
 * with a working model was pinned to the setup page forever.
 *
 * A custom endpoint counts only if it can actually authenticate: `placeholder`
 * auth IS the keyless-local-server case (see CustomEndpoint.auth), anything
 * else needs its stored key present.
 */
export function anyProviderConfigured(facts: {
  keyStatus: Record<string, unknown>;
  authProviders: string[];
  customEndpoints: { id: string; auth: { kind: string } }[];
  customKeyStatus: Record<string, boolean>;
  localRunning: boolean;
}): boolean {
  if (Object.values(facts.keyStatus).some(Boolean)) return true;
  if (facts.authProviders.length > 0) return true;
  if (facts.localRunning) return true;
  return facts.customEndpoints.some(
    (e) => e.auth?.kind === "placeholder" || facts.customKeyStatus[e.id] === true,
  );
}
```

- [ ] **Step 4: Rewire the handler**

Replace `ipc.ts:3202-3208` with:

```ts
  // First-run gate: any BYOK key, any auth.json credential, any usable custom
  // endpoint, or a local runner listening (Ollama / LM Studio / llama.cpp).
  ipcMain.handle("hv:has-any-provider", async () => {
    const [ollama, ...runners] = await Promise.all([
      detectOllama(),
      ...LOCAL_RUNNERS.map((r) => detectLocalRunner(r)),
    ]);
    return anyProviderConfigured({
      keyStatus: providerKeyStatus(),
      authProviders: authJsonProviders(agentDir()),
      customEndpoints: listCustomEndpoints(),
      customKeyStatus: customKeyStatus(),
      localRunning: ollama.running || runners.some((r) => r.running),
    });
  });
```

Add `anyProviderConfigured` to the `providers.ts` import list at `ipc.ts:55`, and make sure `customKeyStatus` and `listCustomEndpoints` are imported from `./config` (both are already used at `ipc.ts:2744-2747`).

- [ ] **Step 5: Green + gate**

Run: `npx vitest run tests/has-any-provider.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 6: Commit**

```bash
git add src/main/providers.ts src/main/ipc.ts tests/has-any-provider.test.ts
git commit -m "fix(providers): a working LM Studio stops reading as no model at all"
```

---

### Task 2: `App` learns that credentials changed

`hv:providers-changed` already exists (`ipc.ts:857`, `preload/index.ts:481`) and only `ChatView.tsx:500` consumes it. `App` pulls once at mount (`:636`) and hand-sets `"present"` from `ModelsView`'s `onSaved` (`:2404`). The wizard's step-1 checkmark cannot flip without the subscription.

**Files:**
- Modify: `src/renderer/src/App.tsx:634-637`
- Test: `tests/onboarding.test.ts` (created here; extended by Task 3)

**Interfaces:**
- Consumes: `window.hv.onProvidersChanged(cb): () => void` (already in `hv.d.ts:668`)

- [ ] **Step 1: Write the failing source-scan test**

The renderer suite has no DOM, so a wiring fact is asserted as a source scan — the `tests/modal-layer.test.ts` idiom.

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = fs.readFileSync(
  path.resolve(__dirname, "../src/renderer/src/App.tsx"),
  "utf8",
);
/** Comments stripped and whitespace collapsed, so JSX line-wrapping cannot hide a match. */
const flat = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ");

describe("credential state is pushed, not pulled once", () => {
  it("App re-reads hasAnyProvider when main says providers changed", () => {
    const src = flat(APP);
    expect(src).toContain("window.hv.onProvidersChanged");
    // The subscription must actually re-read the gate, not just refresh models.
    expect(src).toMatch(/onProvidersChanged\([^)]*\)|const refreshKeyState/);
    expect(src.match(/hasAnyProvider\(\)/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: FAIL — `window.hv.onProvidersChanged` absent from `App.tsx`.

- [ ] **Step 3: Subscribe**

In `App.tsx`, replace the single pull at `:636` with a named reader and a subscription:

```tsx
  const refreshKeyState = useCallback((): void => {
    void window.hv.hasAnyProvider().then((ok) => setKeyState(ok ? "present" : "missing"));
  }, []);

  useEffect(() => {
    // Round 19: the gate is a PUSH. main already broadcasts hv:providers-changed
    // on every key, OAuth and endpoint change and only ChatView consumed it, so a
    // sign-in completed anywhere but the Models page left this state stale — and
    // the onboarding wizard's derived checkmark reads exactly this.
    refreshKeyState();
    return window.hv.onProvidersChanged(refreshKeyState);
  }, [refreshKeyState]);
```

Leave the existing mount effect's other calls (`listWorkspaces`, `listSessions`, layout restore) untouched; only the `hasAnyProvider` line moves out.

- [ ] **Step 4: Green + gate**

Run: `npx vitest run tests/onboarding.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx tests/onboarding.test.ts
git commit -m "fix(models): signing in anywhere flips the gate, not only on the Models page"
```

---

### Task 3: The copy record and the pure predicates

**Files:**
- Create: `src/renderer/src/onboarding.ts`
- Test: `tests/onboarding.test.ts` (extend)

**Interfaces:**
- Produces:
  - `ONBOARDING_COPY` — a flat `Record<string, string>` of every wizard string
  - `shouldShowOnboarding(s: { seen: boolean; workspaces: number; sessions: number }): boolean`
  - `chipsFor(hasCode: boolean): readonly string[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/onboarding.test.ts`:

```ts
import { chipsFor, ONBOARDING_COPY, shouldShowOnboarding } from "../src/renderer/src/onboarding";

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
  });
});

describe("chipsFor", () => {
  it("offers a tour when the folder has code and a build when it does not", () => {
    expect(chipsFor(true)).toHaveLength(3);
    expect(chipsFor(false)).toHaveLength(3);
    expect(chipsFor(true)).not.toEqual(chipsFor(false));
    expect(chipsFor(true).join(" ")).toContain("tour");
  });
});

describe("ONBOARDING_COPY", () => {
  it("carries the locked tagline verbatim", () => {
    expect(ONBOARDING_COPY.tagline).toBe("Good vibes, real code.");
  });

  it("does not promise the agent stays inside the folder — bash is not path-inspected", () => {
    // §10 asks for outside-workspace FILE access; it does not confine bash. The
    // step-2 line must say "asks first", never "nowhere else".
    expect(ONBOARDING_COPY.step2Body).toContain("asks first");
    expect(ONBOARDING_COPY.step2Body).not.toMatch(/never leaves|nowhere else|only in/i);
  });
});

describe("no dead copy", () => {
  it("every ONBOARDING_COPY key has a call site in the renderer", () => {
    const R = path.resolve(__dirname, "../src/renderer/src");
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
      expect(all, key).toContain(`ONBOARDING_COPY.${key}`);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: FAIL — module `../src/renderer/src/onboarding` not found.

- [ ] **Step 3: Write the module**

```ts
/**
 * §22 onboarding round (2026-09-01). Every wizard string in one place, plus the
 * two predicates the dialog derives from — nothing here touches React, so the
 * no-DOM suite can assert the whole contract.
 */

export const ONBOARDING_COPY = {
  tagline: "Good vibes, real code.",
  setupHeader: "Two things and you're in.",
  step1Title: "Connect a model",
  step1Body: "The brain. Sign in with a plan you already pay for, run a free one on this Mac, or paste an API key.",
  step1SignIn: "Sign in with your plan",
  step1Local: "Free, on this Mac",
  step1Key: "Paste an API key",
  step1Escape: "Every option lives on the Models page",
  step2Title: "Pick a project",
  step2Body: "A folder on your Mac. The agent works in there — and asks first before touching anything outside it.",
  step2Open: "Open a folder…",
  step2Fresh: "Start fresh…",
  skip: "I'll set up myself",
  doneTitle: "You're in.",
  doneBody: "Opening your first session…",
  noticeTools: "Each card is a tool the agent ran — expand one to see exactly what it did.",
  noticeContext: "Everything the model knows is in the context gauge at the top — open it to see, and prune, what it holds.",
} as const;

export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;

/**
 * `onboardingSeen` alone is NOT a migration: it is only written when the old
 * bottom-right overlay was dismissed, and that overlay only ever appeared at
 * the instant of first-session creation — so every user already past that
 * moment still reads `false`. Any history at all means "not a first run".
 */
export function shouldShowOnboarding(s: {
  seen: boolean;
  workspaces: number;
  sessions: number;
}): boolean {
  return !s.seen && s.workspaces === 0 && s.sessions === 0;
}

const CHIPS_CODE = [
  "Give me a tour of this codebase",
  "What does this project do?",
  "Find one small thing to improve — explain it before changing anything",
] as const;

const CHIPS_EMPTY = [
  "Build a tiny homepage about me",
  "Make a snake game I can open in my browser",
  "Start a blank web project and explain every file you create",
] as const;

/** An empty folder needs a chip that CREATES the codebase a tour would need. */
export function chipsFor(hasCode: boolean): readonly string[] {
  return hasCode ? CHIPS_CODE : CHIPS_EMPTY;
}
```

- [ ] **Step 4: Run — the no-dead-copy test will FAIL, which is correct**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: the three predicate/copy blocks PASS; `no dead copy` FAILS because no `.tsx` references the keys yet. Note the failure and move to Task 4; it goes green there and in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/onboarding.ts tests/onboarding.test.ts
git commit -m "feat(onboarding): one copy record and two derived predicates"
```

---

### Task 4: The dialog — beats 1 and 2, and the redirect suppression

**Files:**
- Create: `src/renderer/src/components/OnboardingDialog.tsx`
- Modify: `src/renderer/src/styles.css` (after the `hv-shimmer` block, ~`:233`)
- Modify: `src/renderer/src/App.tsx` (`:2167-2168`, `:2951`, state)
- Test: `tests/onboarding.test.ts` (extend), `tests/modal-layer.test.ts` (must stay green)

**Interfaces:**
- Consumes: `ONBOARDING_COPY`, `shouldShowOnboarding` (Task 3); `keyState` push (Task 2)
- Produces: `<OnboardingDialog modelReady workspaceReady onOpenFolder onStartFresh onSkip onDone />`

- [ ] **Step 1: Write the failing tests**

```ts
const CSS = fs.readFileSync(path.resolve(__dirname, "../src/renderer/src/styles.css"), "utf8");
const DIALOG = fs.readFileSync(
  path.resolve(__dirname, "../src/renderer/src/components/OnboardingDialog.tsx"),
  "utf8",
);

describe("the welcome animation obeys the CSP and reduced motion", () => {
  it("is CSS keyframes, and the settled frame is reachable without motion", () => {
    expect(CSS).toMatch(/@keyframes hv-bounce-in/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("brings no animation runtime — the CSP is script-src 'self'", () => {
    expect(flat(DIALOG)).not.toMatch(/lottie|gsap|framer-motion|new Blob|URL\.createObjectURL/i);
  });
});

describe("the dialog is a real modal", () => {
  it("uses the z-100 classes rather than inventing a layer", () => {
    const src = flat(DIALOG);
    expect(src).toContain("hv-overlay");
    expect(src).toContain("hv-dialog");
    expect(src).not.toMatch(/z-\[\d{3,}\]/);
  });
});

describe("first run suppresses the forced-Models redirect", () => {
  it("App does not pin the view to models while the wizard is up", () => {
    const src = flat(APP);
    // The redirect must be conditioned on the wizard, not left absolute.
    expect(src).toMatch(/needsSetup && !onboarding \? "models"|onboarding \? view : needsSetup/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/onboarding.test.ts` → FAIL (file missing, keyframes missing).

- [ ] **Step 3: Add the keyframes**

Append to `src/renderer/src/styles.css`:

```css
/**
 * §22 onboarding (2026-09-01). The welcome beat is CSS-only on purpose: the
 * renderer CSP is `script-src 'self'` with no blob:/data:, so an animation
 * runtime cannot load at all — the same wall §27's audio worklet hit.
 */
@keyframes hv-bounce-in {
  0%   { transform: translateX(-140%) rotate(-18deg); }
  45%  { transform: translateX(0) rotate(3deg) scaleY(0.8) scaleX(1.15); }
  60%  { transform: translateY(-22%) rotate(-2deg) scaleY(1.05) scaleX(0.95); }
  78%  { transform: translateY(0) rotate(2deg) scaleY(0.9) scaleX(1.08); }
  90%  { transform: translateY(-7%) rotate(-3deg); }
  100% { transform: translateY(0) rotate(-3deg); }
}
@keyframes hv-rise-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.hv-bounce-in { animation: hv-bounce-in 1200ms cubic-bezier(0.3, 0.7, 0.4, 1) both; }
.hv-rise-in   { animation: hv-rise-in 320ms ease-out both; }

/* Reduced motion renders the settled frame outright — not a faster animation. */
@media (prefers-reduced-motion: reduce) {
  .hv-overlay,
  .hv-dialog,
  .hv-bounce-in,
  .hv-rise-in { animation: none !important; }
  .hv-bounce-in { transform: rotate(-3deg); }
}
```

- [ ] **Step 4: Write the dialog (beats 1 and 2 only — beat 3 lands in Task 7)**

```tsx
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BrandLogo } from "./BrandLogo";
import { GoTo } from "./GoTo";
import { ONBOARDING_COPY as C } from "../onboarding";
import { ProviderDoors } from "./OnboardingDoors";

/**
 * §22 onboarding round (2026-09-01). One landscape dialog, three beats.
 *
 * It owns NO step state: `modelReady` and `workspaceReady` are the app's real
 * gates handed down, so quitting mid-way and coming back re-derives rather than
 * restarting, and a machine where a model already resolves is honestly one step
 * long. The only state here is which beat is on screen.
 */
export function OnboardingDialog({
  modelReady,
  workspaceReady,
  onOpenFolder,
  onStartFresh,
  onSkip,
}: {
  modelReady: boolean;
  workspaceReady: boolean;
  onOpenFolder: () => void;
  onStartFresh: () => void;
  onSkip: () => void;
}): React.JSX.Element {
  // Beat 1 is a timer, not a gate: any click or key lands it early, and
  // reduced-motion users see the settled frame from the first paint anyway.
  const [welcome, setWelcome] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWelcome(false), 2500);
    const land = (): void => setWelcome(false);
    window.addEventListener("keydown", land, { once: true });
    window.addEventListener("mousedown", land, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", land);
      window.removeEventListener("mousedown", land);
    };
  }, []);

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(52rem,calc(100vw-3rem))] rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-8 focus:outline-none"
          onEscapeKeyDown={(e) => {
            // First Esc lands the animation; only the second one dismisses.
            if (welcome) { e.preventDefault(); setWelcome(false); return; }
            onSkip();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-5">
            <div className={welcome ? "hv-bounce-in" : "-rotate-3"}>
              <BrandLogo size="lg" />
            </div>
            <div>
              <Dialog.Title className="font-black text-3xl tracking-tight">
                Happy<span className="text-tangerine">Vibe</span>
              </Dialog.Title>
              <Dialog.Description className="hv-rise-in text-ink-soft mt-1">
                {C.tagline}
              </Dialog.Description>
            </div>
          </div>

          {!welcome && (
            <div className="hv-rise-in mt-8">
              <h2 className="font-black text-xl tracking-tight mb-4">{C.setupHeader}</h2>

              <StepRow n="1" done={modelReady} title={C.step1Title} body={C.step1Body} active={!modelReady}>
                <ProviderDoors />
                <div className="mt-3 text-xs text-ink-soft">
                  <GoTo view="models">{C.step1Escape}</GoTo>
                </div>
              </StepRow>

              <StepRow n="2" done={workspaceReady} title={C.step2Title} body={C.step2Body} active={modelReady && !workspaceReady}>
                <div className="flex gap-2">
                  <button type="button" onClick={onOpenFolder} className={primaryBtn}>{C.step2Open}</button>
                  <button type="button" onClick={onStartFresh} className={ghostBtn}>{C.step2Fresh}</button>
                </div>
              </StepRow>

              <button type="button" onClick={onSkip} className="mt-6 text-sm text-ink-soft hover:text-ink cursor-pointer underline">
                {C.skip}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`StepRow`, `primaryBtn` and `ghostBtn` are local to this file: a row is the checkmark, the title, the soft line, and its children rendered only while `active`. Copy the button class strings from `AuthFlowModal.tsx:22-25` so the wizard uses the house buttons rather than a fork.

Task 5 creates `OnboardingDoors.tsx`; until then stub `ProviderDoors` as a `<div/>` in the same file so this task builds and its own tests run.

- [ ] **Step 5: Mount it in `App.tsx` and suppress the redirect**

```tsx
  // §22 round 19: first run is the wizard, not the forced Models page. The
  // redirect at :2168 exists for a CONFIGURED user who later removes every
  // provider; on a first run it would put the same three doors behind the
  // scrim the wizard is already showing. Dismissing re-arms it.
  const activeView: View = needsSetup && !onboarding ? "models" : view;
```

and, where the overlay renders today (`:2951`):

```tsx
      {onboarding && (
        <OnboardingDialog
          modelReady={keyState === "present"}
          workspaceReady={workspaces.length > 0}
          onOpenFolder={() => void addWorkspace()}
          onStartFresh={() => setStartFresh(true)}
          onSkip={dismissOnboarding}
        />
      )}
```

Replace the `firstEver` trigger inside `newSession` (`:1803`, `:1814`) with a mount-time decision, since the wizard now precedes the first session:

```tsx
  useEffect(() => {
    if (keyState === "loading") return;
    void window.hv.getOnboardingSeen().then((seen) => {
      seenOnboarding.current = seen;
      setOnboarding(shouldShowOnboarding({ seen, workspaces: workspaces.length, sessions: sessions.length }));
    });
    // Deliberately once: the wizard is a first-run decision, and re-running it
    // as the user adds their first workspace would re-open a dismissed dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyState === "loading"]);
```

Keep `dismissOnboarding` exactly as it is (`:1820-1824`).

Nav is still dead while `needsSetup` (`:2315`) — leave it: the wizard's own `GoTo` is the intended door, and Task 5's `onSkip` fires before any navigation.

- [ ] **Step 6: Green + gate**

Run: `npx vitest run tests/onboarding.test.ts tests/modal-layer.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(onboarding): one landscape dialog, and first run stops being a settings page"
```

---

### Task 5: Step 1's three doors

Three buttons over existing IPC. `ModelsView.tsx` is not touched.

**Files:**
- Create: `src/renderer/src/components/OnboardingDoors.tsx`
- Modify: `src/renderer/src/components/OnboardingDialog.tsx` (import it, drop the stub)
- Test: `tests/onboarding.test.ts` (extend)

**Interfaces:**
- Consumes: `window.hv.getProviders()`, `detectOllama()`, `detectLocalRunners()`, `authLogin(id)`, `authLoginCancel(id)`, `onUiRequest` + `parseAuth`, `respondInput`, `setProviderKey(id, key)`
- Produces: `<ProviderDoors />` — self-contained; the checkmark flips via Task 2's push, not via a callback

- [ ] **Step 1: Write the failing tests**

```ts
const DOORS = fs.readFileSync(
  path.resolve(__dirname, "../src/renderer/src/components/OnboardingDoors.tsx"),
  "utf8",
);

describe("the wizard's provider doors", () => {
  it("reuses the shipped auth modal rather than a second sign-in UI", () => {
    expect(flat(DOORS)).toContain("AuthFlowModal");
    expect(flat(DOORS)).toContain("window.hv.authLogin");
  });

  it("shows a local runner only when one is actually listening", () => {
    // "Don't show what cannot work" — a greyed-out Ollama row teaches nothing.
    expect(flat(DOORS)).toMatch(/running/);
    expect(flat(DOORS)).not.toMatch(/not found|Install from ollama\.com/);
  });

  it("does not fork ModelsView — no extraction, no import of it", () => {
    expect(flat(DOORS)).not.toContain("ModelsView");
  });

  it("keeps the key probe honest at entry", () => {
    expect(flat(DOORS)).toContain("window.hv.setProviderKey");
  });
});

describe("ModelsView is out of scope this round", () => {
  it("is byte-identical to main", () => {
    // Guard rail, not a unit test: this round explicitly refuses to extract it.
    // Run manually if it fails: git diff main -- src/renderer/src/components/ModelsView.tsx
    expect(true).toBe(true);
  });
});
```

Delete that last placeholder block before committing — it asserts nothing. The real guard is the reviewer and `git diff --stat`.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/onboarding.test.ts` → FAIL (file missing).

- [ ] **Step 3: Write `OnboardingDoors.tsx`**

Three doors, in order:

1. **Sign in** — render the OAuth providers from `getProviders().oauth`; the first three (ChatGPT, Claude, GitHub Copilot as they arrive from main — never re-listed here) as buttons, the rest behind a `<details>` labelled `more`. A click calls `window.hv.authLogin(id)` and mounts `<AuthFlowModal>` with the event stream parsed by `parseAuth` off `window.hv.onUiRequest`, exactly as `ModelsView.tsx:171-216` does. Render `p.caveat` under a provider that has one — the same string main ships, not a friendlier fork. `AuthFlowModal` must mount **after** the wizard in the tree: both are `.hv-dialog` at `z-index: 100`, so document order is what puts it on top.
2. **Free, on this Mac** — `await Promise.all([window.hv.detectOllama(), window.hv.detectLocalRunners()])`; render a button per runner **only where `running` is true**, labelled `Use ${label} — found on this Mac`. Clicking it needs no save: `syncModelsJson` already writes the entry before every spawn, so it calls `window.hv.hasAnyProvider()` once to nudge, and Task 1 now returns `true`.
3. **Paste an API key** — a `<select>` over `providers.byok.filter((p) => p.featured)` plus one password field; save with `window.hv.setProviderKey(id, key)` and render the returned `HvKeyProbe` inline: `bad` shows its `error`, `unverified` shows `Saved — couldn't verify this key.`, `ok` shows nothing (the checkmark is the feedback).

Every door ends by letting the `hv:providers-changed` push do the rest — no door calls back into the dialog to say "done".

- [ ] **Step 4: Green + gate**

Run: `npx vitest run tests/onboarding.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/OnboardingDoors.tsx src/renderer/src/components/OnboardingDialog.tsx tests/onboarding.test.ts
git commit -m "feat(onboarding): three doors to a model, none of them a second Models page"
```

---

### Task 6: Beat 3 — celebrate, open the session, offer the chips

**Files:**
- Modify: `src/renderer/src/components/OnboardingDialog.tsx` (the done beat)
- Modify: `src/renderer/src/App.tsx` (auto-create, chip state, `hasCode` probe)
- Modify: `src/renderer/src/components/ChatView.tsx` (the chip row)
- Test: `tests/onboarding.test.ts` (extend)

**Interfaces:**
- Consumes: `chipsFor` (Task 3), `window.hv.fsList(workspaceId, ".")`, `window.hv.createSession(workspaceId)`, App's existing `composerInsert` state (`App.tsx:387`)
- Produces: `ChatView` prop `chips?: readonly string[]` and `onChip(text: string): void`

- [ ] **Step 1: Write the failing tests**

```ts
const CHAT = fs.readFileSync(
  path.resolve(__dirname, "../src/renderer/src/components/ChatView.tsx"),
  "utf8",
);

describe("the first-prompt chips", () => {
  it("insert into the composer and never send", () => {
    const src = flat(CHAT);
    expect(src).toContain("onChip");
    // A chip must not reach the send path. promptSession IS the send.
    const chipRegion = src.slice(src.indexOf("onChip"), src.indexOf("onChip") + 400);
    expect(chipRegion).not.toContain("promptSession");
  });

  it("App picks the branch from what the folder actually holds", () => {
    const src = flat(APP);
    expect(src).toContain("chipsFor");
    expect(src).toContain("window.hv.fsList");
  });
});

describe("the celebration beat", () => {
  it("says the locked line", () => {
    expect(flat(DIALOG)).toContain("ONBOARDING_COPY.doneTitle");
    expect(flat(DIALOG)).toContain("ONBOARDING_COPY.doneBody");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/onboarding.test.ts` → FAIL.

- [ ] **Step 3: The done beat**

In `OnboardingDialog`, when `modelReady && workspaceReady`, replace the two step rows with a celebration frame — `C.doneTitle` in the big black display size over `C.doneBody` in `text-ink-soft`, the logo doing one `hv-bounce-in` again, and a 🎉 rendered as text (no asset: `img-src` is `'self' data:` and every other glyph in the app is inline). After ~1200 ms it calls a new `onDone` prop. Reduced-motion still shows the frame, just without the bounce — the media query already handles it.

- [ ] **Step 4: The handover in `App.tsx`**

```tsx
  const finishOnboarding = async (): Promise<void> => {
    const ws = workspaces[0];
    dismissOnboarding();
    if (!ws) return;
    // What the folder holds decides the chips: an empty folder gets prompts
    // that CREATE a codebase, which is why no sample project is bundled.
    const entries = await window.hv.fsList(ws, ".").catch(() => []);
    const hasCode = entries.some((e) => !e.name.startsWith("."));
    setChips(chipsFor(hasCode));
    await newSession(ws);
    void window.hv.log?.append?.({ type: "onboarding.completed" });
  };
```

`setChips` is new state cleared on the first send (in the existing send handler, beside `setComposerInsert`) and on session switch. The chip click reuses the external-write path already in the file:

```tsx
    onChip={(text) => setComposerInsert((prev) => ({ sid: selectedId!, text, nonce: (prev?.nonce ?? 0) + 1 }))}
```

If `window.hv` has no log-append surface, emit the envelope from main instead — add `hv:onboarding-event` to `ipc.ts` calling `log.append({ type })` with `onboarding.completed` / `onboarding.dismissed`, and call it from `finishOnboarding` and `dismissOnboarding`. Check `src/preload/index.ts` before writing this line; do not invent an IPC that already exists under another name.

- [ ] **Step 5: The chip row in `ChatView`**

Above the composer, rendered only when `chips?.length`: a `flex flex-wrap gap-2` of small pill buttons in the house style, each `onClick={() => onChip(c)}`. No dismiss control — the row disappears on the first send.

- [ ] **Step 6: Green + gate**

Run: `npx vitest run tests/onboarding.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(onboarding): the wizard finishes by opening the session it set you up for"
```

---

### Task 7: The two wow notices

**Files:**
- Modify: `src/renderer/src/App.tsx` (the `tool_execution_end` and `agent_end` paths)
- Test: `tests/onboarding.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
describe("the wow notices", () => {
  it("fire once, as the existing notice capsule", () => {
    const src = flat(APP);
    expect(src).toContain("ONBOARDING_COPY.noticeTools");
    expect(src).toContain("ONBOARDING_COPY.noticeContext");
    // They must reuse the transcript capsule, not a new component.
    expect(src).toMatch(/kind: "notice", text: ONBOARDING_COPY\.notice/);
  });
});
```

- [ ] **Step 2: Run and watch it fail** → FAIL.

- [ ] **Step 3: Fire them**

A single `wowShown` ref (`{ tools: boolean; context: boolean }`) guarded by `seenOnboarding.current === false` at the time the wizard completed — a `firstRunSession` ref holding the session id is the honest gate, so a *second* session on day one does not repeat them. In the existing tool-result handler, after the first tool result for that session, `appendItem(sid, { kind: "notice", text: ONBOARDING_COPY.noticeTools })`; in the `agent_end` handler, the same with `noticeContext`. Neither persists and neither is dismissible — they scroll away, which is the whole reason they are notices and not a card.

- [ ] **Step 4: Green + gate**

Run: `npx vitest run tests/onboarding.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(onboarding): the trace and the gauge introduce themselves, once"
```

---

### Task 8: Delete `OnboardingOverlay`

**Files:**
- Delete: `src/renderer/src/components/OnboardingOverlay.tsx`
- Modify: `src/renderer/src/App.tsx:20` (the import)
- Test: `tests/onboarding.test.ts` (extend)

- [ ] **Step 1: Write the failing absence test**

```ts
describe("the bottom-right overlay is gone", () => {
  it("has no file and no import", () => {
    const p = path.resolve(__dirname, "../src/renderer/src/components/OnboardingOverlay.tsx");
    expect(fs.existsSync(p)).toBe(false);
    expect(APP).not.toContain("OnboardingOverlay");
  });

  it("takes its four steps with it — the wizard and the notices own them now", () => {
    const R = path.resolve(__dirname, "../src/renderer/src");
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
    expect(src).not.toContain("Get to the good part");
    expect(src).not.toContain("Ask the agent to explore it");
  });
});
```

- [ ] **Step 2: Run and watch it fail** → FAIL (file still present).

- [ ] **Step 3: Delete**

```bash
git rm src/renderer/src/components/OnboardingOverlay.tsx
```

Remove the import at `App.tsx:20`. Nothing else references it (`grep -rn OnboardingOverlay src/`).

- [ ] **Step 4: Green + gate** → `npm run gate`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(onboarding): the four-step card goes, its steps already live elsewhere"
```

---

### Task 9: "Start fresh…" — create the folder

**Files:**
- Modify: `src/main/files.ts` (+`createWorkspaceFolder`)
- Modify: `src/main/ipc.ts` (+`hv:create-workspace-folder`)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Modify: `src/renderer/src/components/OnboardingDialog.tsx` (the name input)
- Test: `tests/start-fresh.test.ts`

**Interfaces:**
- Produces: `createWorkspaceFolder(name: string, parent?: string): string` — returns the absolute path, throws on an escaping or empty name
- Produces IPC: `window.hv.createWorkspaceFolder(name: string): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceFolder } from "../src/main/files";

describe("createWorkspaceFolder", () => {
  it("creates the folder under the given parent and returns its path", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "hv-fresh-"));
    const p = createWorkspaceFolder("my first vibe", parent);
    expect(p).toBe(path.join(parent, "my first vibe"));
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it("creates the parent on demand", () => {
    const parent = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-fresh-")), "HappyVibe");
    expect(fs.existsSync(createWorkspaceFolder("x", parent))).toBe(true);
  });

  it("refuses a name that escapes the parent", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "hv-fresh-"));
    for (const bad of ["../evil", "a/b", "/abs", "", "   ", "."]) {
      expect(() => createWorkspaceFolder(bad, parent), bad).toThrow();
    }
  });

  it("refuses to take over an existing folder", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "hv-fresh-"));
    createWorkspaceFolder("dup", parent);
    expect(() => createWorkspaceFolder("dup", parent)).toThrow(/already/i);
  });
});
```

- [ ] **Step 2: Run and watch it fail** → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
/** §22 onboarding: the door for a user with no repo. The name is a single
 *  path SEGMENT — never a path — so nothing here can write outside `parent`. */
export function createWorkspaceFolder(
  name: string,
  parent = path.join(os.homedir(), "Documents", "HappyVibe"),
): string {
  const clean = name.trim();
  if (!clean || clean === "." || clean === "..") throw new Error("Give the project a name.");
  if (clean !== path.basename(clean) || clean.includes(path.sep)) {
    throw new Error("A project name can't contain a slash.");
  }
  const dir = path.join(parent, clean);
  if (fs.existsSync(dir)) throw new Error(`“${clean}” already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

IPC (beside `hv:add-workspace` at `ipc.ts:1973`):

```ts
  ipcMain.handle("hv:create-workspace-folder", (_e, name: string) => {
    const dir = createWorkspaceFolder(String(name));
    workspaces.add(dir);
    return dir;
  });
```

Preload: `createWorkspaceFolder: (name: string) => ipcRenderer.invoke("hv:create-workspace-folder", name)`, plus its line in `hv.d.ts`.

- [ ] **Step 4: The dialog door**

`Start fresh…` swaps step 2's buttons for a name field + `Create`. On success the workspace list refetches and `workspaceReady` derives true on its own; on a thrown error, render `err.message` inline under the field — never swallow it (the §27 "Could not start recording." lesson).

- [ ] **Step 5: Green + gate**

Run: `npx vitest run tests/start-fresh.test.ts` → PASS
Run: `npm run gate`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(onboarding): a user with no repo can start one"
```

---

## Verification — what must be TRUE on screen

`npm run live:why` decides the live batch: **this round touches no `pi-runtime/extensions/`, no `src/main/pi/`, and no live test file**, so `npm run test:live` is not required. Run `npm run live:why` after the last commit and say so explicitly if it prints nothing.

### How to trigger a first run at all

The wizard shows only on an untouched install, so the GUI pass needs a clean profile. Do NOT edit the real one:

```bash
# Back up, blank the three facts the predicate reads, relaunch, restore after.
CFG="$HOME/Library/Application Support/HappyVibe/config.json"
cp "$CFG" "$CFG.bak"
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/Library/Application Support/HappyVibe/config.json")
c = json.load(open(p)); c["onboardingSeen"] = False; c["workspaces"] = []
json.dump(c, open(p, "w"), indent=2)
PY
# sessions index too — the predicate counts them
```

Restore with `mv "$CFG.bak" "$CFG"` when the pass is done. Confirm the restore before finishing.

### Observable claims — Onboarding dialog (first launch, no provider, no workspace)

- The **logo bounces in from the left and settles tilted**; the wordmark and `Good vibes, real code.` follow. Clicking anywhere during it jumps straight to the settled frame.
- **Absence:** the first-run **Models page is NOT behind the scrim** — the backdrop is the empty sidebar and `Pick a project, make a vibe.`, and the words `Hook up a model provider to wake the agent up` appear nowhere on screen.
- **Absence:** with no Ollama, LM Studio or llama.cpp listening, **no local door renders at all** — the strings `not found` and `Install from ollama.com` are absent from the dialog (they belong to the Models page, which is not what you are looking at).
- Step 1 shows three doors; step 2 is collapsed and greyed until step 1 checks.

### Observable claims — the doors (same surface)

- Clicking **Sign in with your plan → Claude** opens `AuthFlowModal` **on top of** the wizard, not underneath it. Both are `z-100`, so this is the one that regresses silently.
- Pasting a deliberately wrong key shows the provider's own refusal **inline under the field**, and step 1 stays unchecked.
- Pasting a good key **checks step 1 and expands step 2 without a reload** — this is Task 2's push doing its job. Observe it here, not on the Models page.

### Observable claims — Models page (a different surface, where the wrong default hides)

- With LM Studio listening on `:1234` and **no key anywhere**, the app **starts into the wizard, not the forced Models page**, and step 1 is **pre-checked**. This is Task 1; it is observed by launching, not by reading the Models page.
- `ModelsView` is unchanged: `git diff main -- src/renderer/src/components/ModelsView.tsx` prints nothing.

### Observable claims — the handover (chat surface)

- Completing both steps shows `You're in.` with the celebration, then the dialog closes and **a session is already open in the workspace**, composer focused.
- Chips sit above the composer. Clicking one **puts its text in the composer and does not send** — the transcript stays empty until you press ⏎.
- In an **empty** folder the chips are the build set (`Make a snake game…`); in a folder with files they are the tour set.
- **Absence:** after the first send the chip row is **gone and does not come back** on the next turn.
- **Absence:** the bottom-right `Get to the good part` card **never appears again, in any state**.
- After the first tool card renders, one notice capsule appears naming the cards; after the turn ends, a second names the context gauge. Neither has a dismiss control.

### The regression this design risks — perform this sequence

1. Complete the wizard, send one prompt, quit the app.
2. Relaunch. **The wizard must not return**, the chip row must not return, and neither notice must fire again.
3. In Settings → Models, remove every provider. **The forced-Models page must return** — and it must be the *page*, not the wizard.
4. Delete the last workspace. **`Pick a project, make a vibe.` must return** — again not the wizard.

Steps 3 and 4 are where "first run owns first run only" either holds or is quietly false.

### Second regression — the abandoned first run

1. Trigger a first run, complete step 1 only, quit during step 2.
2. Relaunch. The wizard **resumes with step 1 already checked** — one checkmark, not a restarted animation-and-both-steps script.
