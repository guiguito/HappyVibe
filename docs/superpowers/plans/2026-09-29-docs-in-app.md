# The guide, reachable from everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add three doors into the deployed user guide — a Help menu on every platform, a setup-dialog link, and a link on the three model-call errors a guide page fixes.

**Architecture:** All three reuse existing wiring: `openDocs` (`App.tsx`, pane or system browser), `docUrl` (`docsLinks.ts`), and `describeProviderError` (pure, import-free). The only new IPC is one main→renderer event, `hv:open-docs`. No egress change: a user-origin navigation already approves its host (`browsers.ts:302`).

**Tech Stack:** Electron menu API, React, vitest (no DOM — source scans + exported data).

**Spec:** `docs/superpowers/specs/2026-09-29-docs-in-app.md`

## Global Constraints

- `docUrl("mcp")` stays exactly `https://happyvibe.dev/docs/mcp/?embed=1` (`tests/docs-links.test.ts`).
- `src/main/providerError.ts` imports nothing (the renderer imports it). §39: only `kind` leaves the app.
- `process.platform` is not used in new `src/main` code — use `platform.name` from `./platform`.
- The setup link calls `window.hv.openExternal`, never `openDocs`.
- Error links exist only for `auth`, `model_not_found`, `context_overflow`.
- Commits: `git commit -s`, message ends with the session's `Co-Authored-By` attribution line. Do NOT push, do NOT open a PR.
- Test runs redirect to a log (`L=/tmp/vitest.log; npx vitest run <f> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`) — never pipe to `tail`.

## Review Focus

1. Help ▸ Guide with **no window open** (macOS) must open the system browser, not do nothing — Task 4 scan pins the fallback branch.
2. F1 must **not** be bound on macOS (a hardware key there) — Task 4 scan pins that the accelerator is Windows/Linux only.
3. An **empty** or unrecognised error string must get no link — Task 2 table has both.
4. A guide **heading renamed** silently breaks an anchor — Task 2 reads the real headings.
5. An anchor written **before** the query string (`…#a/?embed=1`) navigates to the wrong page — Task 1 pins the order.

## File map

| File | Change |
|---|---|
| `src/main/docsBase.ts` | NEW, import-free: `DOCS_BASE`. Main and renderer both read it. |
| `src/renderer/src/docsLinks.ts` | `docUrl(slug, anchor?)`, `docsIndexUrl`, `ERROR_GUIDE_LABEL` |
| `src/main/providerError.ts` | optional `doc` on `ProviderErrorInfo`, set on 3 kinds |
| `src/renderer/src/components/Transcript.tsx` | error item carries `doc`; card renders the link |
| `src/renderer/src/components/ChatView.tsx`, `App.tsx` | thread `onOpenDoc`; pass `doc: info.doc` |
| `src/renderer/src/onboarding.ts`, `components/OnboardingDialog.tsx` | `guideLink` copy + `onOpenGuide` prop |
| `src/main/index.ts` | one menu for every platform, with Help |
| `src/preload/index.ts`, `src/renderer/src/hv.d.ts` | `onOpenDocs` |
| `tests/docs-doors.test.ts` | NEW — every task adds a `describe` here |
| `docs/guide/src/content/docs/{keyboard-shortcuts,first-launch,session-view}.md` | one sentence each |
| `CLAUDE.md` | add `docsBase.ts` to the "imports nothing" list |

---

### Task 1: URL helpers

**Files:** Create `src/main/docsBase.ts`, `tests/docs-doors.test.ts`; modify `src/renderer/src/docsLinks.ts`, `CLAUDE.md`.
**Produces:** `DOCS_BASE`; `docUrl(slug: string, anchor?: string): string`; `docsIndexUrl: string`; `ERROR_GUIDE_LABEL = "Read the guide ↗"`.

- [ ] **Step 1: failing test** — create `tests/docs-doors.test.ts`:

```ts
import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeProviderError } from "../src/main/providerError";
import { docUrl, docsIndexUrl, ERROR_GUIDE_LABEL } from "../src/renderer/src/docsLinks";
import { ONBOARDING_COPY } from "../src/renderer/src/onboarding";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const headings = (slug: string): string[] =>
  [...read("docs", "guide", "src", "content", "docs", `${slug}.md`).matchAll(/^#{2,4} (.+)$/gm)].map((m) => kebab(m[1]));

describe("guide URLs (Docs in the app, 2026-09-29)", () => {
  it("a slug alone keeps the per-screen shape", () => {
    expect(docUrl("mcp")).toBe("https://happyvibe.dev/docs/mcp/?embed=1");
  });
  it("an anchor goes AFTER the query, or the browser reads it as part of the path", () => {
    expect(docUrl("models", "add-a-custom-endpoint")).toBe("https://happyvibe.dev/docs/models/?embed=1#add-a-custom-endpoint");
  });
  it("the front page has no slug and no double slash", () => {
    expect(docsIndexUrl).toBe("https://happyvibe.dev/docs/?embed=1");
    expect(docsIndexUrl.replace("https://", "")).not.toContain("//");
  });
  it("the error-card label is one string", () => {
    expect(ERROR_GUIDE_LABEL).toBe("Read the guide ↗");
  });
});
```

- [ ] **Step 2: run red** — `L=/tmp/vitest.log; npx vitest run tests/docs-doors.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT≠0 (`docsIndexUrl` undefined).
- [ ] **Step 3: implement** — `src/main/docsBase.ts`:

```ts
/** The published user guide (docs/guide). Imports nothing: main and the renderer both read it. */
export const DOCS_BASE = "https://happyvibe.dev/docs/";
```

In `docsLinks.ts` add `import { DOCS_BASE } from "../../main/docsBase";` and replace `docUrl`:

```ts
export const docUrl = (slug: string, anchor?: string): string => `${DOCS_BASE}${slug}/?embed=1${anchor ? `#${anchor}` : ""}`;

/** The guide's front page — the Help menu's target. */
export const docsIndexUrl = `${DOCS_BASE}?embed=1`;

/** The label on a model-call error card that links to a guide page. */
export const ERROR_GUIDE_LABEL = "Read the guide ↗";
```

In `CLAUDE.md`'s "imports nothing" list add `docsBase.ts`.
- [ ] **Step 4: run green** — same command, EXIT=0; also `npx vitest run tests/docs-links.test.ts > $L 2>&1; echo "EXIT=$?"`.
- [ ] **Step 5: commit** — `git add -A && git commit -s -m "feat(docs-in-app): docUrl takes an anchor, and the guide's front page has a URL"`.

---

### Task 2: Error links

**Files:** `src/main/providerError.ts`, `src/renderer/src/components/Transcript.tsx`, `ChatView.tsx`, `src/renderer/src/App.tsx`, `docs/guide/src/content/docs/session-view.md`, test.
**Consumes:** `docUrl`, `ERROR_GUIDE_LABEL`, `openDocs`.
**Produces:** `ProviderErrorInfo.doc?: { slug: string; anchor?: string }`; transcript `error` item field `doc`; prop `onOpenDoc?: (url: string) => void` on `Transcript`/`ChatView`.

- [ ] **Step 1: failing tests** — append to `tests/docs-doors.test.ts`:

```ts
const ENDPOINT = { slug: "models", anchor: "add-a-custom-endpoint" };
const DOCS: Array<[string, string, { slug: string; anchor: string } | undefined]> = [
  ["401 Unauthorized", "auth", { slug: "connect-a-model", anchor: "if-the-provider-rejects-the-key" }],
  ["404 model not found", "model_not_found", ENDPOINT],
  ["maximum context length exceeded", "context_overflow", ENDPOINT],
  ["insufficient_quota", "balance", undefined],
  ["429 Too Many Requests", "rate_limit", undefined],
  ["529 status code (no body)", "overloaded", undefined],
  ["503 Service Unavailable", "server", undefined],
  ["fetch failed", "network", undefined],
  ["something odd happened", "other", undefined],
  ["", "other", undefined],
];

describe("provider errors link to the guide only where a page fixes them", () => {
  test.each(DOCS)("%j is %s", (raw, kind, doc) => {
    const d = describeProviderError(raw);
    expect(d.kind).toBe(kind);
    expect(d.doc).toEqual(doc);
  });
  it("every linked page and anchor exists in the guide", () => {
    for (const [, , doc] of DOCS) if (doc) expect(headings(doc.slug), `${doc.slug}#${doc.anchor}`).toContain(doc.anchor);
  });
  it("providerError.ts stays import-free — the renderer imports it", () => {
    expect(read("src", "main", "providerError.ts")).not.toMatch(/^import /m);
  });
  it("§39: usage statistics read the kind and never the doc", () => {
    expect(read("src", "main", "usage", "turns.ts")).not.toMatch(/\.doc\b/);
  });
  it("the card links only when the item carries a doc, through the shared label", () => {
    const t = read("src", "renderer", "src", "components", "Transcript.tsx");
    expect(t).toMatch(/it\.doc && onOpenDoc/);
    expect(t).toContain("ERROR_GUIDE_LABEL");
  });
  it("App hands the error's doc to the card and the card's opener is openDocs", () => {
    const app = read("src", "renderer", "src", "App.tsx");
    expect(app).toMatch(/doc: info\.doc/);
    expect(app).toMatch(/onOpenDoc=\{openDocs\}/);
  });
});
```

- [ ] **Step 2: run red.**
- [ ] **Step 3: implement.** `providerError.ts`: add to `ProviderErrorInfo` `/** A guide page that explains the fix, only where one does. */ doc?: { slug: string; anchor?: string };`, above `describeProviderError` add
  `const DOC_KEY = { slug: "connect-a-model", anchor: "if-the-provider-rejects-the-key" } as const;` and `const DOC_ENDPOINT = { slug: "models", anchor: "add-a-custom-endpoint" } as const;`, and add `doc: DOC_KEY,` to the `auth` return, `doc: DOC_ENDPOINT,` to `model_not_found` and `context_overflow`.
  `Transcript.tsx`: `import { docUrl, ERROR_GUIDE_LABEL } from "../docsLinks";`; the `error` variant gains `doc?: { slug: string; anchor?: string }`; thread `onOpenDoc?: (url: string) => void` next to every `onRetry` (find them: `grep -n onRetry src/renderer/src/components/Transcript.tsx`); after the `it.hint` line render
  `{it.doc && onOpenDoc && (<button type="button" onClick={() => onOpenDoc(docUrl(it.doc!.slug, it.doc!.anchor))} className="mt-1 text-xs font-bold text-berry underline underline-offset-2 hover:brightness-110 cursor-pointer">{ERROR_GUIDE_LABEL}</button>)}`.
  `ChatView.tsx`: accept `onOpenDoc` and pass it to `<Transcript>` beside `onRetry={onRetry}`. `App.tsx`: add `doc: info.doc,` to the `appendItem` at the provider-error flush (`~line 1715`) and `onOpenDoc={openDocs}` on `<ChatView`.
  `session-view.md` line ~94: append "For a rejected key, an unknown model or a conversation that's too long, the error also links to the guide page that explains the fix."
- [ ] **Step 4: run green** — that file + `tests/provider-error.test.ts` + `tests/docs-links.test.ts`.
- [ ] **Step 5: commit** — `feat(docs-in-app): a rejected key, an unknown model or an overlong conversation links to the page that fixes it`.

---

### Task 3: Setup link

**Files:** `src/renderer/src/onboarding.ts`, `components/OnboardingDialog.tsx`, `App.tsx`, `docs/guide/src/content/docs/first-launch.md`, test.

- [ ] **Step 1: failing tests** — append:

```ts
describe("the setup dialog links to the setup guide", () => {
  const dialog = read("src", "renderer", "src", "components", "OnboardingDialog.tsx");
  const app = read("src", "renderer", "src", "App.tsx");
  it("the copy is one string", () => expect(ONBOARDING_COPY.guideLink).toBe("Read the setup guide ↗"));
  it("the dialog renders it in the brand column, and not on the celebration screen", () => {
    expect(dialog).toMatch(/!complete && !welcome && \(\s*<button[^>]*onClick=\{onOpenGuide\}/);
    expect(dialog).toContain("C.guideLink");
  });
  it("it always opens the SYSTEM browser — a pane opened behind a modal is invisible", () => {
    const at = app.indexOf("onOpenGuide=");
    expect(at).toBeGreaterThan(-1);
    const call = app.slice(at, at + 200);
    expect(call).toContain('window.hv.openExternal(docUrl("first-launch"))');
    expect(call).not.toContain("openDocs");
  });
});
```

- [ ] **Step 2: run red.**
- [ ] **Step 3: implement.** `onboarding.ts`: add `guideLink: "Read the setup guide ↗",` after `skip`. `OnboardingDialog.tsx`: add `onOpenGuide` to the props destructure and its type (`onOpenGuide: () => void;`), and right after `</Dialog.Description>` in the LEFT column:
  `{!complete && !welcome && (<button type="button" onClick={onOpenGuide} className="mt-6 self-start text-[13px] font-bold text-ink-soft hover:text-ink underline decoration-tangerine decoration-2 underline-offset-4 cursor-pointer">{C.guideLink}</button>)}`.
  `App.tsx` at `<OnboardingDialog`: `onOpenGuide={() => void window.hv.openExternal(docUrl("first-launch"))}` and import `docUrl` if not already imported. `first-launch.md` "When you see it": append "The setup window has a **Read the setup guide** link under the tagline that opens this page in your browser."
- [ ] **Step 4: run green** — that file + `tests/onboarding.test.ts`.
- [ ] **Step 5: commit** — `feat(docs-in-app): the setup dialog links to the setup guide, in the system browser`.

---

### Task 4: Help menu

**Files:** `src/main/index.ts` (menu block at `~346`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/shortcuts.ts` (comment), `docs/guide/src/content/docs/keyboard-shortcuts.md`, test.
**Produces:** IPC event `hv:open-docs` (no payload); `window.hv.onOpenDocs(h: () => void): () => void`.

- [ ] **Step 1: failing tests** — append:

```ts
describe("Help ▸ HappyVibe Guide (Docs in the app, 2026-09-29)", () => {
  const index = read("src", "main", "index.ts");
  it("the menu is set on EVERY platform, not only inside the macOS branch", () => {
    expect(index).not.toMatch(/if \(process\.platform === 'darwin'\) \{\s*Menu\.setApplicationMenu/);
    expect(index).toMatch(/Menu\.setApplicationMenu\(/);
  });
  it("Help holds the guide item", () => {
    expect(index).toMatch(/role: 'help'/);
    expect(index).toMatch(/label: 'HappyVibe Guide'/);
  });
  it("F1 is Windows/Linux only — on macOS it is a hardware key", () => {
    expect(index).toMatch(/isMac \? \{\} : \{ accelerator: 'F1' \}/);
  });
  it("the click goes to the focused window, and with none open opens the system browser", () => {
    expect(index).toMatch(/getFocusedWindow\(\)/);
    expect(index).toContain("send('hv:open-docs')");
    expect(index).toMatch(/shell\.openExternal\(DOCS_BASE\)/);
  });
  it("Windows and Linux get File ▸ Quit where macOS has the app menu", () => {
    expect(index).toMatch(/role: 'fileMenu'/);
  });
  it("preload, the typings and App all carry the event", () => {
    expect(read("src", "preload", "index.ts")).toContain('"hv:open-docs"');
    expect(read("src", "renderer", "src", "hv.d.ts")).toContain("onOpenDocs(");
    expect(read("src", "renderer", "src", "App.tsx")).toMatch(/onOpenDocs\(\(\) => openDocsRef\.current\(docsIndexUrl\)\)/);
  });
  it("the shortcuts note records F1 beside Mod-Shift-n, because findConflict cannot see menu accelerators", () => {
    expect(read("src", "renderer", "src", "shortcuts.ts")).toMatch(/F1/);
  });
});
```

- [ ] **Step 2: run red.**
- [ ] **Step 3: implement.**
  `index.ts`: `import { platform } from './platform'` and `import { DOCS_BASE } from './docsBase'`. Replace the `if (process.platform === 'darwin') { Menu.setApplicationMenu(Menu.buildFromTemplate([...])) }` block with an unconditional one: `const isMac = platform.name === 'darwin'`; the first template entry is the existing `{ label: 'HappyVibe', submenu: [...] }` when `isMac`, else `{ role: 'fileMenu' }`; keep `editMenu`, `viewMenu` and the existing `Window` menu untouched; append
  ```ts
  {
    role: 'help',
    submenu: [
      {
        label: 'HappyVibe Guide',
        ...(isMac ? {} : { accelerator: 'F1' }),
        click: () => {
          const w = BrowserWindow.getFocusedWindow()
          if (w) w.webContents.send('hv:open-docs')
          else void shell.openExternal(DOCS_BASE)
        },
      },
    ],
  },
  ```
  `preload/index.ts` (beside `onTabArrive`): `onOpenDocs: (h: () => void) => { const l = (): void => h(); ipcRenderer.on("hv:open-docs", l); return () => ipcRenderer.off("hv:open-docs", l); },`. `hv.d.ts` beside `onTabArrive`: `onOpenDocs(h: () => void): () => void;`.
  `App.tsx` right after `openDocs`: `const openDocsRef = useRef(openDocs); openDocsRef.current = openDocs; useEffect(() => window.hv.onOpenDocs(() => openDocsRef.current(docsIndexUrl)), []);` and import `docsIndexUrl`.
  `shortcuts.ts`: extend the Mod-Shift-n comment with "F1 (Help ▸ HappyVibe Guide on Windows and Linux) is owned the same way." `keyboard-shortcuts.md` Built-in table: add row `| Open this guide | F1 on Windows and Linux. On macOS, Help ▸ HappyVibe Guide |`.
- [ ] **Step 4: run green** — that file + `tests/window-single-owner.test.ts` (its `New Window` pins must still hold, untouched).
- [ ] **Step 5: commit** — `feat(docs-in-app): a Help menu on every platform opens the guide`.

---

### Task 5: Gate, review, GUI, hand-off

- [ ] `docs-reviewer` agent on `keyboard-shortcuts.md`, `first-launch.md`, `session-view.md`; fix every finding.
- [ ] `npm run gate` (never `npm run typecheck` first). Paste the tail of the real output.
- [ ] `npm run live:why` — prints anything ⇒ `npm run test:live` in the background; prints nothing ⇒ say "no Pi-facing changes, live batch not required".
- [ ] GUI pass per the section below (`attach {debugPort: 9222}`, never `start_app`). If attach fails, print `HV_DEBUG_PORT=9222 npm run dev` and stop.
- [ ] Add the Windows/Linux manual checks to `docs/validation/docs-round.md`'s open items.
- [ ] Final report: what changed, what was verified with what output, what was not. Then "Run `/land` when you're happy."

## GUI verification — what must be TRUE on screen

Main changed ⇒ restart the dev server first, then `grep -c "hv:open-docs" out/main/index.js` must be ≥ 1 (a stale bundle is the trap). Check `pgrep -fl "npm run dev"` and that no live agent turn is in flight before restarting.

**A. Help menu** (observed on the chat view, then again from the Models page)
1. `evaluate_main`: `require('electron').Menu.getApplicationMenu().items.map(i => i.label)` includes `"Help"`, and its submenu is exactly `["HappyVibe Guide"]`.
2. Invoke `…items.find(i=>i.label==='Help').submenu.items[0].click()`. Then one `evaluate` returning JSON: a browser tab now exists in the tab strip, its URL bar reads `https://happyvibe.dev/docs/?embed=1`, and the page title text is the guide's front page.
3. **Absence:** the pane shows **no** blocked/"Allow" state — `happyvibe.dev` was never prompted. (Derive the selector from `BrowserTab.tsx`'s blocked branch: `grep -n "blocked" src/renderer/src/components/BrowserTab.tsx`.)
4. **Other page:** repeat the click while the Models page is showing → the view switches to chat and the pane opens; the Models page's own "How this page works ↗" still renders exactly once.
5. **Regression sequence:** click Help ▸ Guide, close the pane, click again → a fresh pane opens (no stale one); click twice without closing → two panes (accepted, same as the per-screen links).

**B. Error links** (custom OpenAI-compatible endpoints against two throwaway local servers; remove both endpoints afterwards)
- `node -e "require('http').createServer((q,s)=>{s.statusCode=401;s.end('{}')}).listen(8099)"` and the same on 8098 with `statusCode=529`.
1. Session on the 8099 endpoint, send a message → the card reads "The provider rejected the API key." and shows **Read the guide ↗**; clicking opens a pane at `…/connect-a-model/?embed=1#if-the-provider-rejects-the-key`.
2. Session on the 8098 endpoint → the card reads "overloaded", shows **Retry**, and shows **no** guide link. **This absence is the point of the table.**
3. **Regression:** on the 401 card, no **Retry** button appears (not retriable) and the link does not displace the hint text.

**C. Setup link** — needs a first-run profile. Find how earlier rounds forced it (`grep -rn "shouldShowOnboarding" src/renderer/src`); if no route exists, mark this NOT VERIFIED in the report and rely on the Task 3 scan. When reachable: the link shows under the tagline, is absent on the celebration screen, and clicking it opens the system browser and creates **no** browser tab.

**D. Not verifiable on this Mac:** Windows and Linux menu (File ▸ Quit, F1, Alt reveals the bar). Listed as manual checks.

## Found, deliberately not fixed

`providerError.ts:110,144` hints say "Settings → LLM Setup", but that section became the **Models** page (`ModelsView.tsx:11`). The new link sits right beside that text, so the mismatch becomes visible. A one-line copy fix, kept out of this round so the diff stays about doors.

---

## Round 2 addendum (same day) — the guide becomes a page inside the app

The maintainer asked for the guide inside the app, below The record, replacing the page content with a
Back button. Decided: an iframe with one CSP entry, and every existing link converges on it. This
**supersedes Tasks 1–4's browser-pane routing** (spec and PRD rewritten first). Built on the same branch:

| Change | Files |
|---|---|
| `GuideView` — a sandboxed iframe filling the window and one large circled ✕ (no bar of our own) | `components/GuideView.tsx` (new), `docsLinks.ts` (`externalDocUrl`, `GUIDE_COPY`) |
| Settings row below the last group, outside `NAV`; new `View` `"guide"` | `Sidebar.tsx`, `usage/events.ts` (`SCREENS`, pinned equal to `View`) |
| `openDocs` shows the page; only `keyState === "missing"` still uses the system browser | `App.tsx` |
| CSP `frame-src https://happyvibe.dev`; `guideLinkScript` injected into the frame (the first attempt, `will-frame-navigate`, never fired) | `index.html`, `navGuard.ts`, `index.ts` (`did-frame-finish-load`) |
| Old pin replaced ("falls back to the system browser" → "opens the in-app guide") | `tests/docs-links.test.ts` |

### GUI verification — what must be TRUE on screen

1. **Row.** With Settings expanded, a **User guide** row sits below the Changelog row, outside every group. **Absence:** it is not listed under The record's header; `NAV` has no `guide`.
2. **Page.** Clicking it: the app's sidebar disappears (**absence:** no `aside` is visible, `getComputedStyle` `display` is `none` on its wrapper) and the window is one `<iframe>` whose `src` is `https://happyvibe.dev/docs/`, filling the height, showing the guide **with** its HappyVibe header, plus one circled ✕ button (≥ 40px) at the top right. **Absence:** no "← Back" / "User guide" bar of our own above the frame.
3. **Close.** The ✕ returns to the chat screen and the sidebar is back with its groups as they were (**regression:** open a group, click the guide row, Back, and the group is still open, not reset).
4. **Other doors, same view.** From **Models**, "How this page works ↗" lands on the guide page at `/docs/models/`. **Absence:** no browser tab appears in the tab strip. Help ▸ HappyVibe Guide does the same from Models and from chat.
5. **Leaving the guide.** Click an external link in the guide (Models page has one to ollama.com): the system browser opens, and the frame stays on the guide. **Absence:** no `Refused to frame` message in `get_console_messages level:error`.
6. **Error link.** Custom endpoint returning 401 → the error card's **Read the guide ↗** opens the guide at `connect-a-model` (anchor `if-the-provider-rejects-the-key`).
7. **Regression the CSP risks.** Open an `.html` file in the editor's preview: it still renders (the sandboxed `srcdoc` frame is unaffected by `frame-src`), with no CSP errors.
8. **Not verifiable here:** before any model is connected the link opens the system browser (a fresh profile is needed); Windows/Linux menu and `F1`.
9. **Esc.** With the guide open, press Esc: the chat screen returns. Then click INSIDE the guide (focus in the frame) and press Esc: it still returns — this is the one that proves `before-input-event` reaches a cross-origin frame (unverified until seen). **Known trade-off:** Esc pressed to dismiss the guide's own search box also closes the guide, because the frame's state can't be read from the app.
10. **Brand.** The guide's header shows the HappyVibe logo and title top left. **Needs a full quit and relaunch of the app first:** the site keeps its "hide the title" flag in the frame's session storage for the life of the process, so a session that ever loaded `?embed=1` keeps hiding the title through reloads.
