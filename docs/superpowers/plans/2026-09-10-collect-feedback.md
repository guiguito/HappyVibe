# Collect feedback (PRD §34) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two feedback surfaces of PRD §34 — a sidebar-opened feedback dialog rendering Inlet's published form (with window capture), and a once-per-session emoji pulse — with every send audited and nothing leaving the machine without a click.

**Architecture:** All HTTP and all payload construction live in main under `src/main/feedback/` (pure, `fetch`-injected, electron-free where possible); the renderer gets a generic `FormRenderer` over Inlet's element union, a `FeedbackDialog` (Radix, the `OnboardingDialog` shell), and a `SessionPulse` row in `ChatView`'s banner stack. Two additive persisted fields (`SessionMeta.pulseAskedAt`, `config.feedback.formCache`). One new EventLog type, `feedback.sent`, rendered as its own Audit row.

**Tech Stack:** Electron 44 main (`webContents.capturePage`, `nativeImage`, Node `fetch`/`FormData`/`Blob`), React + Radix Dialog + Tailwind renderer, vitest (no DOM — pure exports + source scans), Inlet HTTP API v1.

**Spec:** Notion "Collect feedbacks" (locked 2026-09-10) — `https://app.notion.com/p/3d6d33dfffca8022b883c4012d287bee`; PRD `docs/prd.md` §34 (+ §6, §19 clauses).

## Global Constraints

- **No content ever travels.** `clientContext` is built ONLY by `generalContext()` / `pulseContext()` in `src/main/feedback/context.ts` — key allowlists, tested. Never prompt text, file paths, workspace names/ids, session titles/ids, tool arguments.
- **Nothing is sent without a click.** No fetch on dismiss, on show, on open beyond `GET …/form`. No "impression" event of any kind.
- **The only key in `src/` is a publishable `ipk_` key.** `tests/feedback-secrets.test.ts` fails on any `isk_` literal or any read of `FEEDBACK_API_KEY` under `src/`. The `isk_` keys live in `.env` (`FEEDBACK_API_KEY` = dev, `FEEDBACK_API_KEY_PROD` = prod) for the MCP and the live test's cleanup only.
- **Channel keys (committed):** dev `ipk_MMpg82eVQNJo9NIiEfyzEODvhPa-Ho9n`, databases general `fdb_h2ntrck1mywr` / session `fdb_384szrcgeb7n`. prod publishableKey **`null`** (lands in its own commit), databases general `fdb_yfre0219xr82` / session `fdb_hnbkxr94p5cd`. Base URL `https://feedback.bzapps.eu`. Channel = `is.dev ? "dev" : "prod"`, overridable by `HV_FEEDBACK_CHANNEL`.
- **No key ⇒ no surface.** `feedbackInfo().available === false` hides the sidebar icon AND the pulse.
- **Fast pulse is an env flag, never `import.meta.env.DEV`:** `HV_FEEDBACK_FAST_PULSE=1` at launch → 20 s / 1 turn / no random offset. Otherwise 10 min + U(0, 20 min), ≥ 3 turns.
- **Renderer CSP is `img-src 'self' data:`** — thumbnails are `data:` URLs, never `blob:`.
- **Layering:** the dialog uses `.hv-overlay` / `.hv-dialog` (z-100, guarded by `tests/modal-layer.test.ts`). Nothing new climbs above 50 outside those two classes.
- **Copy rules (§20):** pulse copy in a `PULSE_COPY` record with a no-dead-copy test. Words: "Send feedback", "How is this session going?", "Thanks!". Never "telemetry" in UI copy.
- **Gate:** `npm run gate` (build → non-live suite). `npm run live:why` will print nothing (no Pi-facing files change), say so. Live Inlet test runs on `npm test` only when `.env` carries the keys; CI has none and skips.
- **Commits:** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

**Main (`src/main/feedback/`, all new)**
| File | Responsibility | Electron-free? |
|---|---|---|
| `config.ts` | channel table, env overrides, `resolveFeedbackConfig` | yes |
| `context.ts` | `generalContext`, `pulseContext` allowlists | yes |
| `inlet.ts` | `InletClient` (readForm/openIntent/upload/submit) + `sendSubmission` orchestration + `InletError` | yes (`fetch` injected) |
| `capture.ts` | `fitWithin` (pure) + `captureWindow(win)` (electron) | split |
| `formCache.ts` | last-good form per database in `config.json` | uses `config.ts` load/save |

**Main, modified:** `src/main/config.ts` (+`feedback?.formCache`), `src/main/store.ts` (+`pulseAskedAt`), `src/main/ipc.ts` (7 handlers + audit read), `src/main/analytics.ts` (no-op case), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`.

**Renderer, new:** `src/renderer/src/feedbackForm.ts` (pure), `src/renderer/src/sessionPulse.ts` (pure), `components/EmojiChoice.tsx`, `components/FormRenderer.tsx`, `components/FeedbackDialog.tsx`, `components/SessionPulse.tsx`.

**Renderer, modified:** `components/Sidebar.tsx` (icon, both states), `components/ChatView.tsx` (pulse in the banner stack), `components/AuditView.tsx` (row), `App.tsx` (wiring: dialog state, `openedAt`/`offsetMs`/`compactions` per session, props).

**Tests, new:** `tests/feedback-config.test.ts`, `tests/feedback-secrets.test.ts`, `tests/feedback-context.test.ts`, `tests/inlet-client.test.ts`, `tests/feedback-capture.test.ts`, `tests/feedback-form.test.ts`, `tests/session-pulse.test.ts`, `tests/feedback-audit.test.ts`, `tests/feedback-live.test.ts`. **Modified:** `tests/session-index.test.ts`.

---

### Task 1: Server prerequisite — the Smoke tests database

**Files:** none in the repo. Uses the `inlet` MCP (dev project `prj_7j3jft425x3h`).

**Produces:** a database id `fdb_…` named **Smoke tests** with a published one-question form, hard-coded in Task 12's live test as `SMOKE_DB`.

- [ ] **Step 1: Create the database**

Call `mcp__inlet__create_feedback_database` with `projectId: "prj_7j3jft425x3h"`, `name: "Smoke tests"`. Record the returned `id`.

- [ ] **Step 2: Publish a form with one text question and one screenshot question**

Call `mcp__inlet__save_form_draft` on that id with a definition of one page: a `title` "Smoke test", a `text` question (label "Note", `required: true`, `multiline: false`, `maxLength: 200`), and a `screenshot` question (label "Image", `required: false`, `maxCount: 1`). Then `mcp__inlet__publish_form`. Confirm with `mcp__inlet__get_published_form` that `formVersion` is 1 and the text question's `id` and the screenshot question's `id` are returned — record both ids; the live test reads them from the definition at runtime, so nothing else is hard-coded.

- [ ] **Step 3: Verify the dev publishable key reads it**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ipk_MMpg82eVQNJo9NIiEfyzEODvhPa-Ho9n" https://feedback.bzapps.eu/v1/feedback-databases/<SMOKE_DB>/form
```
Expected: `200`.

---

### Task 2: `config.ts` — channels, env overrides, and the secrets scan

**Files:**
- Create: `src/main/feedback/config.ts`
- Test: `tests/feedback-config.test.ts`, `tests/feedback-secrets.test.ts`

**Interfaces — Produces:**
```ts
export type FeedbackChannel = "dev" | "prod";
export interface FeedbackConfig {
  channel: FeedbackChannel;
  baseUrl: string;
  publishableKey: string;           // present ⇒ available
  databases: { general: string; session: string };
}
export const FEEDBACK_CHANNELS: Record<FeedbackChannel, Omit<FeedbackConfig, "channel" | "publishableKey"> & { publishableKey: string | null }>;
/** null when the resolved channel has no publishable key (⇒ no surface). */
export function resolveFeedbackConfig(env: Record<string, string | undefined>, isDev: boolean): FeedbackConfig | null;
export function fastPulse(env: Record<string, string | undefined>): boolean; // HV_FEEDBACK_FAST_PULSE === "1"
```

- [ ] **Step 1: Write the failing tests**

`tests/feedback-config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FEEDBACK_CHANNELS, fastPulse, resolveFeedbackConfig } from "../src/main/feedback/config";

describe("resolveFeedbackConfig", () => {
  it("dev channel resolves with the committed key and dev databases", () => {
    const c = resolveFeedbackConfig({}, true);
    expect(c?.channel).toBe("dev");
    expect(c?.publishableKey).toMatch(/^ipk_/);
    expect(c?.databases).toEqual({ general: "fdb_h2ntrck1mywr", session: "fdb_384szrcgeb7n" });
    expect(c?.baseUrl).toBe("https://feedback.bzapps.eu");
  });
  it("prod channel is UNAVAILABLE until its key lands (null, not a throw)", () => {
    expect(FEEDBACK_CHANNELS.prod.publishableKey).toBeNull();
    expect(resolveFeedbackConfig({}, false)).toBeNull();
  });
  it("prod databases are the prod project's, never the dev ones", () => {
    expect(FEEDBACK_CHANNELS.prod.databases).toEqual({ general: "fdb_yfre0219xr82", session: "fdb_hnbkxr94p5cd" });
  });
  it("HV_FEEDBACK_* env overrides win, and a key override makes prod available", () => {
    const c = resolveFeedbackConfig(
      { HV_FEEDBACK_PUBLISHABLE_KEY: "ipk_x", HV_FEEDBACK_BASE_URL: "http://localhost:3000", HV_FEEDBACK_DB_GENERAL: "fdb_a", HV_FEEDBACK_DB_SESSION: "fdb_b" },
      false,
    );
    expect(c).toEqual({ channel: "prod", baseUrl: "http://localhost:3000", publishableKey: "ipk_x", databases: { general: "fdb_a", session: "fdb_b" } });
  });
  it("HV_FEEDBACK_CHANNEL forces the channel", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_CHANNEL: "dev" }, false)?.channel).toBe("dev");
  });
  it("a non-ipk_ key is refused (a server key must never be wired in)", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_PUBLISHABLE_KEY: "isk_nope" }, true)).toBeNull();
  });
  it("fastPulse is exactly the '1' flag", () => {
    expect(fastPulse({})).toBe(false);
    expect(fastPulse({ HV_FEEDBACK_FAST_PULSE: "1" })).toBe(true);
    expect(fastPulse({ HV_FEEDBACK_FAST_PULSE: "true" })).toBe(false);
  });
});
```

`tests/feedback-secrets.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("feedback secrets never reach src/", () => {
  const files = walk("src");
  it("no isk_ server key literal anywhere under src/", () => {
    const hits = files.filter((f) => /\bisk_[A-Za-z0-9_-]{8,}/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("nothing under src/ reads FEEDBACK_API_KEY (either channel)", () => {
    const hits = files.filter((f) => /FEEDBACK_API_KEY/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("the committed publishable keys are ipk_ keys", () => {
    const src = fs.readFileSync("src/main/feedback/config.ts", "utf8");
    const keys = [...src.matchAll(/"(i[ps]k_[A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith("ipk_")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
L=/tmp/vitest.log; npx vitest run tests/feedback-config.test.ts tests/feedback-secrets.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `Cannot find module '../src/main/feedback/config'`; the secrets test's third case fails on the missing file.

- [ ] **Step 3: Implement**

`src/main/feedback/config.ts`:
```ts
/**
 * §34 — which Inlet project the app talks to, per channel.
 *
 * PUBLISHABLE keys only (`ipk_`): Inlet's contract is that they may live in a
 * client — they can read a form, open an intent, upload and submit, and cannot
 * read a single response. The SERVER keys (`isk_`) stay in `.env` for the MCP
 * reading side; tests/feedback-secrets.test.ts fails if one ever lands here.
 *
 * prod's key is null until it is minted (a signed-in admin in Inlet's web UI —
 * an API key gets `insufficient_scope`, measured). Null ⇒ no surface (§20).
 * Electron-free on purpose: vitest imports it.
 */
export type FeedbackChannel = "dev" | "prod";

export interface FeedbackConfig {
  channel: FeedbackChannel;
  baseUrl: string;
  publishableKey: string;
  databases: { general: string; session: string };
}

export const FEEDBACK_CHANNELS = {
  dev: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: "ipk_MMpg82eVQNJo9NIiEfyzEODvhPa-Ho9n" as string | null,
    databases: { general: "fdb_h2ntrck1mywr", session: "fdb_384szrcgeb7n" },
  },
  prod: {
    baseUrl: "https://feedback.bzapps.eu",
    publishableKey: null as string | null,
    databases: { general: "fdb_yfre0219xr82", session: "fdb_hnbkxr94p5cd" },
  },
} as const satisfies Record<FeedbackChannel, { baseUrl: string; publishableKey: string | null; databases: { general: string; session: string } }>;

export function resolveFeedbackConfig(env: Record<string, string | undefined>, isDev: boolean): FeedbackConfig | null {
  const forced = env.HV_FEEDBACK_CHANNEL;
  const channel: FeedbackChannel = forced === "dev" || forced === "prod" ? forced : isDev ? "dev" : "prod";
  const base = FEEDBACK_CHANNELS[channel];
  const key = env.HV_FEEDBACK_PUBLISHABLE_KEY ?? base.publishableKey;
  if (!key || !key.startsWith("ipk_")) return null;
  return {
    channel,
    baseUrl: env.HV_FEEDBACK_BASE_URL ?? base.baseUrl,
    publishableKey: key,
    databases: {
      general: env.HV_FEEDBACK_DB_GENERAL ?? base.databases.general,
      session: env.HV_FEEDBACK_DB_SESSION ?? base.databases.session,
    },
  };
}

/** §34: the pulse's 20 s arm. An env flag, never `import.meta.env.DEV` — see the PRD for why. */
export function fastPulse(env: Record<string, string | undefined>): boolean {
  return env.HV_FEEDBACK_FAST_PULSE === "1";
}
```

- [ ] **Step 4: Run to verify they pass**

Same command as Step 2. Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/feedback/config.ts tests/feedback-config.test.ts tests/feedback-secrets.test.ts
git commit -m "feat(feedback): channel config with the dev publishable key, and the secrets scan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `context.ts` — the two allowlisted payloads

**Files:**
- Create: `src/main/feedback/context.ts`
- Test: `tests/feedback-context.test.ts`

**Interfaces — Produces:**
```ts
export interface HostFacts { appVersion: string; channel: "dev" | "prod"; os: { platform: string; version: string; release: string; arch: string }; electron: string }
export interface ModelRef { provider: string; id: string }
export interface SessionFacts { sittingMs: number; turns: number; messages: number; contextTokens: number | null; contextWindow: number | null; compactions: number }
export function generalContext(host: HostFacts, extra: { view?: string; model?: ModelRef | null }): Record<string, unknown>;
export function pulseContext(host: HostFacts, session: SessionFacts, model: ModelRef | null): Record<string, unknown>;
export const CONTEXT_MAX_BYTES = 16 * 1024;
export function clampView(v: unknown): string | undefined; // /^[a-z][a-z0-9/-]{0,39}$/ else undefined
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { CONTEXT_MAX_BYTES, clampView, generalContext, pulseContext, type HostFacts } from "../src/main/feedback/context";

const host: HostFacts = { appVersion: "0.1.0", channel: "dev", os: { platform: "darwin", version: "15.5", release: "24.5.0", arch: "arm64" }, electron: "44.2.0" };
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

describe("generalContext", () => {
  it("emits exactly the allowlisted keys", () => {
    const c = generalContext(host, { view: "settings/mcp", model: { provider: "openrouter", id: "deepseek/deepseek-v4-flash" } });
    expect(Object.keys(c).sort()).toEqual(["appVersion", "channel", "electron", "model", "os", "view"]);
    expect(Object.keys(c.os as object).sort()).toEqual(["arch", "platform", "release", "version"]);
  });
  it("omits model and view when absent — never invents either", () => {
    const c = generalContext(host, {});
    expect(c).not.toHaveProperty("model");
    expect(c).not.toHaveProperty("view");
  });
  it("drops anything that is not on the allowlist, even when handed it", () => {
    const dirty = { ...host, workspacePath: "/Users/x/secret", sessionTitle: "fix the auth bug", prompt: "…" } as unknown as HostFacts;
    const c = generalContext(dirty, { view: "chat", model: null, ...( { sessionId: "abc" } as object) });
    expect(JSON.stringify(c)).not.toMatch(/secret|auth bug|abc|sessionId|workspacePath/);
  });
  it("stays under Inlet's 16 KiB ceiling even with hostile-length inputs", () => {
    const big = { ...host, appVersion: "9".repeat(50_000) };
    expect(bytes(generalContext(big, { view: "x".repeat(50_000) }))).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
  });
});

describe("pulseContext", () => {
  it("emits the session block with the gauge's null right after compaction", () => {
    const c = pulseContext(host, { sittingMs: 1_260_000, turns: 7, messages: 15, contextTokens: null, contextWindow: 128_000, compactions: 1 }, { provider: "deepseek", id: "deepseek-v4-flash" });
    expect(Object.keys(c).sort()).toEqual(["appVersion", "channel", "electron", "model", "os", "session"]);
    expect(c.session).toEqual({ sittingMs: 1_260_000, turns: 7, messages: 15, contextTokens: null, contextWindow: 128_000, compactions: 1 });
  });
  it("has NO string field outside the fixed enums and ids", () => {
    const c = pulseContext(host, { sittingMs: 1, turns: 1, messages: 1, contextTokens: 1, contextWindow: 1, compactions: 0 }, null);
    const strings: string[] = [];
    const walk = (o: unknown, p: string): void => { if (typeof o === "string") strings.push(p); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`); };
    walk(c, "");
    expect(strings.sort()).toEqual([".appVersion", ".channel", ".electron", ".os.arch", ".os.platform", ".os.release", ".os.version"]);
  });
  it("coerces non-finite numbers to null rather than sending NaN", () => {
    const c = pulseContext(host, { sittingMs: NaN, turns: 3, messages: 4, contextTokens: Infinity, contextWindow: 5, compactions: 0 }, null) as { session: Record<string, unknown> };
    expect(c.session.sittingMs).toBeNull();
    expect(c.session.contextTokens).toBeNull();
  });
});

describe("clampView", () => {
  it("accepts the app's view ids and refuses anything else", () => {
    expect(clampView("chat")).toBe("chat");
    expect(clampView("settings/mcp")).toBe("settings/mcp");
    expect(clampView("/Users/x")).toBeUndefined();
    expect(clampView("a".repeat(60))).toBeUndefined();
    expect(clampView(42)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/feedback-context.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * §34 — what travels beside a feedback answer, and NOTHING else.
 *
 * Allowlists, not blocklists: a caller can hand these functions any object and
 * only the named keys come out. This is the code the PRD's "privacy is enforced
 * in code, not promised in copy" (§27) points at for feedback. Every string that
 * leaves is a version, an enum, or an id — never a title, a path, a prompt.
 */
export interface HostFacts {
  appVersion: string;
  channel: "dev" | "prod";
  os: { platform: string; version: string; release: string; arch: string };
  electron: string;
}
export interface ModelRef { provider: string; id: string }
export interface SessionFacts {
  sittingMs: number; turns: number; messages: number;
  contextTokens: number | null; contextWindow: number | null; compactions: number;
}

export const CONTEXT_MAX_BYTES = 16 * 1024;
const SHORT = 64;

const short = (s: unknown): string => String(s ?? "").slice(0, SHORT);
const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

function hostBlock(h: HostFacts): Record<string, unknown> {
  return {
    appVersion: short(h.appVersion),
    channel: h.channel === "prod" ? "prod" : "dev",
    os: { platform: short(h.os?.platform), version: short(h.os?.version), release: short(h.os?.release), arch: short(h.os?.arch) },
    electron: short(h.electron),
  };
}

function modelBlock(m: ModelRef | null | undefined): { model?: ModelRef } {
  return m && m.provider && m.id ? { model: { provider: short(m.provider), id: short(m.id) } } : {};
}

/** The renderer's `View` id — clamped, so a path or a title cannot ride it. */
export function clampView(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z][a-z0-9/-]{0,39}$/.test(v) ? v : undefined;
}

export function generalContext(host: HostFacts, extra: { view?: string; model?: ModelRef | null }): Record<string, unknown> {
  const view = clampView(extra.view);
  return { ...hostBlock(host), ...(view ? { view } : {}), ...modelBlock(extra.model) };
}

export function pulseContext(host: HostFacts, s: SessionFacts, model: ModelRef | null): Record<string, unknown> {
  return {
    ...hostBlock(host),
    ...modelBlock(model),
    session: {
      sittingMs: num(s.sittingMs), turns: num(s.turns), messages: num(s.messages),
      contextTokens: num(s.contextTokens), contextWindow: num(s.contextWindow), compactions: num(s.compactions),
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `feat(feedback): allowlisted clientContext builders`.

---

### Task 4: `inlet.ts` — the HTTP client and the send orchestration

**Files:**
- Create: `src/main/feedback/inlet.ts`
- Test: `tests/inlet-client.test.ts`

**Interfaces — Produces:**
```ts
export type InletErrorKind = "not_published" | "validation" | "expired" | "rate_limited" | "conflict" | "network" | "server" | "unauthorized";
export class InletError extends Error { kind: InletErrorKind; status?: number; details?: Array<{ questionId?: string; message: string }> }
export interface FormDefinition { feedbackDatabaseId: string; formVersionId: string; formVersion: number; publishedAt: string; pages: FormPage[] }
export interface FormPage { id: string; elements: FormElement[] }
export type FormElement =  // mirrors Inlet packages/shared/src/form.ts, client shape
  | { id: string; type: "title" | "subtitle" | "body_text"; text: string }
  | { id: string; type: "choice"; label: string; helperText?: string; required: boolean; optionKind: "text" | "emoji"; selection: "single" | "multi"; orientation: "vertical" | "horizontal"; options: Array<{ id: string; label: string; emoji?: string }> }
  | { id: string; type: "text"; label: string; helperText?: string; required: boolean; multiline: boolean; maxLength: number; placeholder?: string }
  | { id: string; type: "email"; label: string; helperText?: string; required: boolean; placeholder?: string }
  | { id: string; type: "screenshot"; label: string; helperText?: string; required: boolean; maxCount: number; acceptedMediaTypes: string[]; maxFileBytes: number }
  | { id: string; type: string; label?: string; required?: boolean };   // unknown — forward-compat
export type Answers = Record<string, { optionId: string } | { optionIds: string[] } | { value: string } | { attachmentIds: string[] }>;
export interface Upload { questionId: string; name: string; type: string; bytes: Uint8Array }
export interface SendResult { submissionId: string; status: "accepted" | "duplicate"; attachments: number; bytes: number; formVersion: number }
export interface InletClient {
  readForm(db: string): Promise<FormDefinition>;
  openIntent(db: string, formVersion: number): Promise<{ intentId: string; token: string; formVersion: number }>;
  upload(db: string, intent: { intentId: string; token: string }, u: Upload): Promise<{ attachmentId: string; bytes: number }>;
  submit(db: string, intent: { intentId: string; token: string }, body: { formVersion: number; answers: Answers; clientContext: Record<string, unknown> }): Promise<{ submissionId: string; status: "accepted" | "duplicate" }>;
}
export function createInletClient(cfg: { baseUrl: string; publishableKey: string }, fetchImpl?: typeof fetch, timeoutMs?: number): InletClient;
/** intent → uploads → submit; ONE transparent retry on `expired`. attachmentIds are filled into `answers[screenshotQuestionId]`. */
export function sendSubmission(client: InletClient, db: string, req: { formVersion: number; answers: Answers; uploads: Upload[]; clientContext: Record<string, unknown> }): Promise<SendResult>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createInletClient, InletError, sendSubmission, type Upload } from "../src/main/feedback/inlet";

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fakeFetch(route: Route): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => { const url = String(input); calls.push({ url, init }); return route(url, init); }) as typeof fetch;
  return { fetch: f, calls };
}
const cfg = { baseUrl: "https://inlet.test", publishableKey: "ipk_test" };
const png: Upload = { questionId: "el_shot", name: "a.png", type: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };

describe("createInletClient", () => {
  it("readForm sends the bearer key and returns the definition", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { feedbackDatabaseId: "fdb_1", formVersionId: "fv_1", formVersion: 2, publishedAt: "x", pages: [] }));
    const form = await createInletClient(cfg, fetch).readForm("fdb_1");
    expect(form.formVersion).toBe(2);
    expect(calls[0].url).toBe("https://inlet.test/v1/feedback-databases/fdb_1/form");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer ipk_test");
  });
  it("409 form_not_published → InletError not_published", async () => {
    const { fetch } = fakeFetch(() => json(409, { error: { code: "form_not_published", message: "…" } }));
    await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind: "not_published", status: 409 });
  });
  it("401 → unauthorized; 429 → rate_limited; 500 → server", async () => {
    for (const [status, code, kind] of [[401, "unauthorized", "unauthorized"], [429, "rate_limit_exceeded", "rate_limited"], [500, "internal", "server"]] as const) {
      const { fetch } = fakeFetch(() => json(status, { error: { code, message: "…" } }));
      await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind });
    }
  });
  it("a thrown fetch (offline) → network", async () => {
    const { fetch } = fakeFetch(() => { throw new TypeError("fetch failed"); });
    await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind: "network" });
  });
  it("upload is multipart with questionId + file and the intent token header", async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { attachmentId: "att_1", bytes: 10 }));
    const r = await createInletClient(cfg, fetch).upload("fdb_1", { intentId: "int_1", token: "tok" }, png);
    expect(r.attachmentId).toBe("att_1");
    expect(calls[0].url).toBe("https://inlet.test/v1/feedback-databases/fdb_1/submission-intents/int_1/attachments");
    expect(new Headers(calls[0].init.headers).get("x-inlet-intent-token")).toBe("tok");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("questionId")).toBe("el_shot");
    expect((fd.get("file") as File).type).toBe("image/png");
  });
});

describe("sendSubmission", () => {
  const happy = (overrides: Partial<Record<"intent" | "upload" | "submit", Route>> = {}): Route => (url, init) => {
    if (url.endsWith("/submission-intents")) return (overrides.intent ?? (() => json(201, { intentId: "int_1", token: "tok", formVersion: 2, expiresAt: "x" })))(url, init);
    if (url.endsWith("/attachments")) return (overrides.upload ?? (() => json(201, { attachmentId: "att_9", bytes: 4 })))(url, init);
    if (url.endsWith("/submit")) return (overrides.submit ?? (() => json(201, { submissionId: "sub_1", status: "accepted", formVersion: 2, createdAt: "x" })))(url, init);
    throw new Error("unexpected " + url);
  };
  const req = { formVersion: 2, answers: { el_text: { value: "hi" } }, uploads: [png], clientContext: { appVersion: "0.1.0" } };

  it("intent → upload → submit, and the attachment id lands under the screenshot question", async () => {
    const { fetch, calls } = fakeFetch(happy());
    const r = await sendSubmission(createInletClient(cfg, fetch), "fdb_1", req);
    expect(r).toEqual({ submissionId: "sub_1", status: "accepted", attachments: 1, bytes: 4, formVersion: 2 });
    const body = JSON.parse(String(calls[2].init.body));
    expect(body.answers.el_shot).toEqual({ attachmentIds: ["att_9"] });
    expect(body.formVersion).toBe(2);
    expect(body.clientContext).toEqual({ appVersion: "0.1.0" });
  });
  it("200 duplicate is success", async () => {
    const { fetch } = fakeFetch(happy({ submit: () => json(200, { submissionId: "sub_1", status: "duplicate", formVersion: 2, createdAt: "x" }) }));
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).resolves.toMatchObject({ status: "duplicate" });
  });
  it("410 intent_expired → a NEW intent, re-upload, resubmit, once", async () => {
    let submits = 0;
    const { fetch, calls } = fakeFetch(happy({ submit: () => (++submits === 1 ? json(410, { error: { code: "intent_expired", message: "…" } }) : json(201, { submissionId: "sub_2", status: "accepted", formVersion: 2, createdAt: "x" })) }));
    const r = await sendSubmission(createInletClient(cfg, fetch), "fdb_1", req);
    expect(r.submissionId).toBe("sub_2");
    expect(calls.filter((c) => c.url.endsWith("/submission-intents")).length).toBe(2);
    expect(calls.filter((c) => c.url.endsWith("/attachments")).length).toBe(2);
  });
  it("a second 410 is surfaced, not looped", async () => {
    const { fetch } = fakeFetch(happy({ submit: () => json(410, { error: { code: "intent_expired", message: "…" } }) }));
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).rejects.toMatchObject({ kind: "expired" });
  });
  it("400 validation_failed carries the per-question details", async () => {
    const { fetch } = fakeFetch(happy({ submit: () => json(400, { error: { code: "validation_failed", message: "…", details: [{ questionId: "el_text", message: "too long" }] } }) }));
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).rejects.toMatchObject({ kind: "validation", details: [{ questionId: "el_text", message: "too long" }] });
  });
  it("with no uploads, no attachments call is made and no screenshot key is added", async () => {
    const { fetch, calls } = fakeFetch(happy());
    await sendSubmission(createInletClient(cfg, fetch), "fdb_1", { ...req, uploads: [] });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["submission-intents", "submit"]);
    expect(JSON.parse(String(calls[1].init.body)).answers).toEqual({ el_text: { value: "hi" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
/**
 * §34 — the only code that talks to Inlet. Lives in MAIN because the renderer
 * CSP has no connect-src (§27's rule: sidestep it from main, never weaken it).
 * `fetch` is injected so the whole error table is unit-tested without a server.
 * API: https://github.com/guiguito/inlet/blob/main/docs/API.md
 */
export type InletErrorKind = "not_published" | "validation" | "expired" | "rate_limited" | "conflict" | "network" | "server" | "unauthorized";

export class InletError extends Error {
  constructor(public kind: InletErrorKind, message: string, public status?: number, public details?: Array<{ questionId?: string; message: string }>) {
    super(message);
    this.name = "InletError";
  }
}

// … FormElement / FormPage / FormDefinition / Answers / Upload / SendResult / InletClient types as in Interfaces above …

const CODE_TO_KIND: Record<string, InletErrorKind> = {
  form_not_published: "not_published",
  validation_failed: "validation",
  intent_expired: "expired",
  submission_deleted: "expired",
  rate_limit_exceeded: "rate_limited",
  intent_payload_conflict: "conflict",
  unauthorized: "unauthorized",
  feedback_database_inaccessible: "unauthorized",
};

async function toError(res: Response): Promise<InletError> {
  let body: { error?: { code?: string; message?: string; details?: Array<{ questionId?: string; message: string }> } } = {};
  try { body = await res.json(); } catch { /* non-JSON body: fall through to status mapping */ }
  const code = body.error?.code ?? "";
  const kind: InletErrorKind = CODE_TO_KIND[code] ?? (res.status === 401 || res.status === 403 ? "unauthorized" : res.status === 429 ? "rate_limited" : res.status === 400 ? "validation" : "server");
  return new InletError(kind, body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.details);
}

export function createInletClient(cfg: { baseUrl: string; publishableKey: string }, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): InletClient {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const call = async (path: string, init: RequestInit & { intentToken?: string } = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${cfg.publishableKey}`);
    if (init.intentToken) headers.set("x-inlet-intent-token", init.intentToken);
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new InletError("network", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) throw await toError(res);
    return res;
  };
  const jsonBody = (o: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(o), headers: { "content-type": "application/json" } });
  return {
    readForm: async (db) => (await call(`/v1/feedback-databases/${db}/form`)).json(),
    openIntent: async (db, formVersion) => (await call(`/v1/feedback-databases/${db}/submission-intents`, jsonBody({ formVersion }))).json(),
    upload: async (db, intent, u) => {
      const fd = new FormData();
      fd.set("questionId", u.questionId);
      fd.set("file", new File([u.bytes], u.name, { type: u.type }));
      return (await call(`/v1/feedback-databases/${db}/submission-intents/${intent.intentId}/attachments`, { method: "POST", body: fd, intentToken: intent.token })).json();
    },
    submit: async (db, intent, body) => (await call(`/v1/feedback-databases/${db}/submission-intents/${intent.intentId}/submit`, { ...jsonBody(body), intentToken: intent.token })).json(),
  };
}

export async function sendSubmission(client: InletClient, db: string, req: { formVersion: number; answers: Answers; uploads: Upload[]; clientContext: Record<string, unknown> }): Promise<SendResult> {
  const attempt = async (): Promise<SendResult> => {
    const intent = await client.openIntent(db, req.formVersion);
    const answers: Answers = { ...req.answers };
    let bytes = 0;
    const byQuestion = new Map<string, string[]>();
    for (const u of req.uploads) {
      const r = await client.upload(db, intent, u);
      bytes += r.bytes ?? u.bytes.byteLength;
      byQuestion.set(u.questionId, [...(byQuestion.get(u.questionId) ?? []), r.attachmentId]);
    }
    for (const [q, ids] of byQuestion) answers[q] = { attachmentIds: ids };
    const r = await client.submit(db, intent, { formVersion: req.formVersion, answers, clientContext: req.clientContext });
    return { submissionId: r.submissionId, status: r.status, attachments: req.uploads.length, bytes, formVersion: req.formVersion };
  };
  try {
    return await attempt();
  } catch (e) {
    // §34: a dialog left open past the 30-minute intent TTL. One transparent retry, never a loop.
    if (e instanceof InletError && e.kind === "expired") return attempt();
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `feat(feedback): Inlet client with the full error table and the one-retry send`.

---

### Task 5: `capture.ts` + `formCache.ts`

**Files:**
- Create: `src/main/feedback/capture.ts`, `src/main/feedback/formCache.ts`
- Modify: `src/main/config.ts` (add `feedback?: { formCache?: Record<string, unknown> }` to `ConfigFile` after `webService`, and two functions)
- Test: `tests/feedback-capture.test.ts`

**Interfaces — Produces:**
```ts
// capture.ts
export const MAX_PIXELS = 25_000_000; export const THUMB_WIDTH = 400;
export function fitWithin(w: number, h: number, maxPixels: number): { width: number; height: number };   // pure
export interface Capture { png: Buffer; width: number; height: number; thumbnail: string /* data:image/png;base64,… */ }
export async function captureWindow(win: { webContents: { capturePage(): Promise<Electron.NativeImage> } }): Promise<Capture>;
// formCache.ts
export function readCachedForm(db: string): FormDefinition | null;
export function writeCachedForm(db: string, form: FormDefinition): void;
// config.ts additions
export function getFeedbackFormCache(): Record<string, unknown>;
export function setFeedbackFormCache(db: string, form: unknown): void;
```

- [ ] **Step 1: Write the failing test** (`tests/feedback-capture.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { fitWithin, MAX_PIXELS } from "../src/main/feedback/capture";

describe("fitWithin", () => {
  it("leaves a Retina laptop capture alone (inside 25 MP)", () => {
    expect(fitWithin(3456, 2234, MAX_PIXELS)).toEqual({ width: 3456, height: 2234 });
  });
  it("downsizes a 6K@2x capture to fit, keeping the aspect ratio", () => {
    const r = fitWithin(12288, 6912, MAX_PIXELS);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(Math.abs(r.width / r.height - 12288 / 6912)).toBeLessThan(0.01);
    expect(r.width).toBeGreaterThan(6000); // shrunk, not crushed
  });
  it("never returns zero for a degenerate input", () => {
    expect(fitWithin(1, 1, MAX_PIXELS)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(0, 0, MAX_PIXELS)).toEqual({ width: 1, height: 1 });
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement**

`src/main/feedback/capture.ts`:
```ts
import type { NativeImage } from "electron";

/** Inlet's decoded-pixel ceiling (limits.ts attachmentMaxPixels). A 6K display at 2× exceeds it. */
export const MAX_PIXELS = 25_000_000;
/** The dialog shows a thumbnail of the exact image that will be sent; CSP forbids blob:, so it is a data: URL — keep it small. */
export const THUMB_WIDTH = 400;

export function fitWithin(w: number, h: number, maxPixels: number): { width: number; height: number } {
  const W = Math.max(1, Math.floor(w)), H = Math.max(1, Math.floor(h));
  if (W * H <= maxPixels) return { width: W, height: H };
  const k = Math.sqrt(maxPixels / (W * H));
  return { width: Math.max(1, Math.floor(W * k)), height: Math.max(1, Math.floor(H * k)) };
}

export interface Capture { png: Buffer; width: number; height: number; thumbnail: string }

/**
 * §34: capture at OPEN, before the dialog paints — what the user was looking at
 * when they decided to give feedback. Held in memory by the caller, never on disk.
 * Known limit, accepted in the PRD: embedded browser panes are separate
 * WebContentsViews and render as their placeholder.
 */
export async function captureWindow(win: { webContents: { capturePage(): Promise<NativeImage> } }): Promise<Capture> {
  let img = await win.webContents.capturePage();
  const size = img.getSize();
  const fit = fitWithin(size.width, size.height, MAX_PIXELS);
  if (fit.width !== size.width) img = img.resize({ width: fit.width, height: fit.height, quality: "good" });
  const thumb = img.resize({ width: Math.min(THUMB_WIDTH, fit.width), quality: "good" });
  return { png: img.toPNG(), width: fit.width, height: fit.height, thumbnail: `data:image/png;base64,${thumb.toPNG().toString("base64")}` };
}
```

`src/main/config.ts` — add to `ConfigFile` (after `webService?`):
```ts
  /** §34: the last good published form per Inlet database, so an offline open still renders. */
  feedback?: { formCache?: Record<string, unknown> };
```
and at the end of the file:
```ts
// §34: form cache (additive).
export function getFeedbackFormCache(): Record<string, unknown> {
  return load().feedback?.formCache ?? {};
}
export function setFeedbackFormCache(db: string, form: unknown): void {
  const cfg = load();
  cfg.feedback = { ...cfg.feedback, formCache: { ...cfg.feedback?.formCache, [db]: form } };
  save(cfg);
}
```

`src/main/feedback/formCache.ts`:
```ts
import { getFeedbackFormCache, setFeedbackFormCache } from "../config";
import type { FormDefinition } from "./inlet";

export function readCachedForm(db: string): FormDefinition | null {
  const f = getFeedbackFormCache()[db] as FormDefinition | undefined;
  return f && Array.isArray(f.pages) && typeof f.formVersion === "number" ? f : null;
}
export function writeCachedForm(db: string, form: FormDefinition): void {
  setFeedbackFormCache(db, form);
}
```

- [ ] **Step 4: Run test; run `npm run typecheck`** (both must be green — capture.ts imports an electron type only).
- [ ] **Step 5: Commit** — `feat(feedback): window capture with the 25 MP fit, and the form cache`.

---

### Task 6: `SessionMeta.pulseAskedAt`

**Files:**
- Modify: `src/main/store.ts:13-45` (`SessionMeta`)
- Test: `tests/session-index.test.ts` (append one case)

- [ ] **Step 1: Write the failing test** — append to `tests/session-index.test.ts` (use that file's existing helper that builds a `SessionIndex` in a temp dir; copy its `beforeEach` idiom):

```ts
it("§34: pulseAskedAt is additive and round-trips through update()", () => {
  const meta = index.create({ title: "t", workspaceId: "/ws" } as never); // use the file's own create helper signature
  expect(meta.pulseAskedAt).toBeUndefined();
  index.update(meta.id, { pulseAskedAt: "2026-09-10T10:00:00.000Z" });
  expect(index.get(meta.id)?.pulseAskedAt).toBe("2026-09-10T10:00:00.000Z");
});
```
(Adapt `index.create(...)` to whatever the file already calls to make a session — read the first test in the file.)

- [ ] **Step 2: Run, verify the type error / failure.**
- [ ] **Step 3: Implement** — in `SessionMeta`, after `lastUsedAt?: string;`:
```ts
  /**
   * §34: when the session pulse was SHOWN for this session (asked-at-show, not
   * asked-at-answer — a user who quit with the pulse up is not asked again).
   * Additive; absent = never asked. Strict once per session, ever.
   */
  pulseAskedAt?: string;
```
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(feedback): SessionMeta.pulseAskedAt`.

---

### Task 7: IPC, preload, `hv.d.ts`, the `feedback.sent` row and the analytics no-op

**Files:**
- Modify: `src/main/ipc.ts` (new handler block near the `hv:set-onboarding-seen` handler at ~3959; extend `hv:read-audit` at ~3920), `src/main/analytics.ts:141` switch, `src/preload/index.ts` (~line 289), `src/renderer/src/hv.d.ts` (~line 1152)
- Test: `tests/feedback-audit.test.ts` (source scan + analytics inventory)

**Interfaces — Produces (renderer-facing `window.hv`):**
```ts
feedbackInfo(): Promise<{ available: boolean; fastPulse: boolean }>;
feedbackOpen(args: { sessionId: string | null; view: string }): Promise<
  | { ok: true; form: FormDefinition; thumbnail: string | null; source: "live" | "cache" }
  | { ok: false; reason: "not_published" | "unreachable" | "unavailable" }>;
feedbackClose(): Promise<void>;                       // drops this window's capture
feedbackSend(args: { formVersion: number; answers: Answers; images: Array<{ questionId: string; name: string; type: string; bytes: Uint8Array }>; includeCapture: boolean; captureQuestionId: string | null; sessionId: string | null; view: string }): Promise<
  | { ok: true; submissionId: string; status: "accepted" | "duplicate" }
  | { ok: false; kind: InletErrorKind; message: string; details?: Array<{ questionId?: string; message: string }> }>;
feedbackPulseForm(): Promise<{ ok: true; form: FormDefinition; source: "live" | "cache" } | { ok: false; reason: "not_published" | "unreachable" | "unavailable" }>;
feedbackPulseSend(args: { sessionId: string; formVersion: number; questionId: string; optionId: string; session: SessionFacts }): Promise<{ ok: true; submissionId: string } | { ok: false; kind: InletErrorKind; message: string }>;
sessionPulseAsked(sessionId: string): Promise<void>;
```
EventLog row on success (both surfaces): `{ type: "feedback.sent", sessionId?, workspaceId?, data: { database: "general" | "session", formVersion, submissionId, status, attachments, bytes, channel } }` — **never answers, never clientContext**.

- [ ] **Step 1: Write the failing test** (`tests/feedback-audit.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const analytics = fs.readFileSync("src/main/analytics.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");

describe("§34 feedback.sent audit row", () => {
  it("main writes exactly one event type for feedback, and reads it back for the Audit page", () => {
    expect((ipc.match(/type: "feedback\.sent"/g) ?? []).length).toBe(1);   // one helper, two callers
    expect(ipc).toMatch(/log\.read\(\{ type: "feedback\.sent"/);
  });
  it("the row payload never carries answers or clientContext", () => {
    const helper = ipc.slice(ipc.indexOf('type: "feedback.sent"') - 600, ipc.indexOf('type: "feedback.sent"') + 400);
    expect(helper).not.toMatch(/answers|clientContext/);
  });
  it("analytics names it as a no-op — the switch stays an inventory of what main writes", () => {
    expect(analytics).toMatch(/case "feedback\.sent":/);
  });
  it("every §34 IPC channel is exposed by preload", () => {
    for (const ch of ["hv:feedback-info", "hv:feedback-open", "hv:feedback-close", "hv:feedback-send", "hv:feedback-pulse-form", "hv:feedback-pulse-send", "hv:session-pulse-asked"]) {
      expect(preload).toContain(`"${ch}"`);
      expect(ipc).toContain(`"${ch}"`);
    }
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement — `src/main/ipc.ts`**

Imports at top: `import { is } from "@electron-toolkit/utils";` (check it is not already imported), `import { resolveFeedbackConfig, fastPulse } from "./feedback/config";`, `import { createInletClient, sendSubmission, InletError, type FormDefinition, type Answers, type Upload } from "./feedback/inlet";`, `import { generalContext, pulseContext, clampView, type HostFacts, type ModelRef, type SessionFacts } from "./feedback/context";`, `import { captureWindow, type Capture } from "./feedback/capture";`, `import { readCachedForm, writeCachedForm } from "./feedback/formCache";`, `import os from "node:os";`.

Handler block (place after `hv:set-onboarding-seen`):
```ts
  // ── §34 Collect feedback ────────────────────────────────────────────────
  // Resolved ONCE per app run: the channel is a build fact plus env at launch.
  const feedbackCfg = resolveFeedbackConfig(process.env, is.dev);
  const feedbackFast = fastPulse(process.env);
  const inlet = feedbackCfg ? createInletClient(feedbackCfg) : null;
  /** In-memory only, per window: the capture taken at open. Dropped on close/send. */
  const captures = new Map<number, Capture>();

  const hostFacts = (): HostFacts => ({
    appVersion: app.getVersion(),
    channel: feedbackCfg?.channel ?? "dev",
    os: { platform: process.platform, version: process.getSystemVersion(), release: os.release(), arch: process.arch },
    electron: process.versions.electron ?? "",
  });
  /** §34: main resolves the model through the SAME chain spawn uses; never invents one. */
  const modelFor = (sessionId: string | null): ModelRef | null => {
    const meta = sessionId ? index.get(sessionId) : undefined;
    const m = meta ? resolveSpawnModel(meta.workspaceId, meta.id) : getDefaultModel();
    return m ? { provider: m.provider, id: m.modelId } : null;
  };
  const readFormWithCache = async (db: string): Promise<{ ok: true; form: FormDefinition; source: "live" | "cache" } | { ok: false; reason: "not_published" | "unreachable" | "unavailable" }> => {
    if (!inlet) return { ok: false, reason: "unavailable" };
    try {
      const form = await inlet.readForm(db);
      writeCachedForm(db, form);
      return { ok: true, form, source: "live" };
    } catch (e) {
      if (e instanceof InletError && e.kind === "not_published") return { ok: false, reason: "not_published" };
      const cached = readCachedForm(db);
      return cached ? { ok: true, form: cached, source: "cache" } : { ok: false, reason: "unreachable" };
    }
  };
  const auditFeedbackSent = (database: "general" | "session", r: { formVersion: number; submissionId: string; status: string; attachments: number; bytes: number }, sessionId?: string): void => {
    const meta = sessionId ? index.get(sessionId) : undefined;
    void log.append({ type: "feedback.sent", sessionId, workspaceId: meta?.workspaceId, data: { database, ...r, channel: feedbackCfg?.channel } });
  };
  const failure = (e: unknown) => e instanceof InletError
    ? { ok: false as const, kind: e.kind, message: e.message, details: e.details }
    : { ok: false as const, kind: "network" as const, message: e instanceof Error ? e.message : String(e) };

  ipcMain.handle("hv:feedback-info", () => ({ available: !!feedbackCfg, fastPulse: feedbackFast }));

  ipcMain.handle("hv:feedback-open", async (e, args: { sessionId: string | null; view: string }) => {
    if (!feedbackCfg) return { ok: false, reason: "unavailable" };
    const win = windows.bySender(e.sender);
    let thumbnail: string | null = null;
    if (win) {
      try {
        const cap = await captureWindow(win);   // BEFORE the dialog paints — the renderer mounts it on this reply
        captures.set(win.id, cap);
        thumbnail = cap.thumbnail;
      } catch { /* a hidden or minimized window rejects; the dialog simply offers no capture */ }
    }
    const form = await readFormWithCache(feedbackCfg.databases.general);
    return form.ok ? { ...form, thumbnail } : form;
  });

  ipcMain.handle("hv:feedback-close", (e) => {
    const win = windows.bySender(e.sender);
    if (win) captures.delete(win.id);
  });

  ipcMain.handle("hv:feedback-send", async (e, args: { formVersion: number; answers: Answers; images: Array<{ questionId: string; name: string; type: string; bytes: Uint8Array }>; includeCapture: boolean; captureQuestionId: string | null; sessionId: string | null; view: string }) => {
    if (!feedbackCfg || !inlet) return { ok: false, kind: "unauthorized", message: "Feedback is not available in this build." };
    const win = windows.bySender(e.sender);
    const uploads: Upload[] = args.images.map((i) => ({ questionId: i.questionId, name: i.name, type: i.type, bytes: new Uint8Array(i.bytes) }));
    const cap = win ? captures.get(win.id) : undefined;
    if (args.includeCapture && cap && args.captureQuestionId) uploads.push({ questionId: args.captureQuestionId, name: "window.png", type: "image/png", bytes: new Uint8Array(cap.png) });
    try {
      const r = await sendSubmission(inlet, feedbackCfg.databases.general, {
        formVersion: args.formVersion, answers: args.answers, uploads,
        clientContext: generalContext(hostFacts(), { view: clampView(args.view), model: modelFor(args.sessionId) }),
      });
      auditFeedbackSent("general", r, args.sessionId ?? undefined);
      if (win) captures.delete(win.id);
      return { ok: true, submissionId: r.submissionId, status: r.status };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle("hv:feedback-pulse-form", () => feedbackCfg ? readFormWithCache(feedbackCfg.databases.session) : { ok: false, reason: "unavailable" });

  ipcMain.handle("hv:feedback-pulse-send", async (_e, args: { sessionId: string; formVersion: number; questionId: string; optionId: string; session: SessionFacts }) => {
    if (!feedbackCfg || !inlet) return { ok: false, kind: "unauthorized", message: "Feedback is not available in this build." };
    try {
      const r = await sendSubmission(inlet, feedbackCfg.databases.session, {
        formVersion: args.formVersion, answers: { [args.questionId]: { optionId: args.optionId } }, uploads: [],
        clientContext: pulseContext(hostFacts(), args.session, modelFor(args.sessionId)),
      });
      auditFeedbackSent("session", r, args.sessionId);
      return { ok: true, submissionId: r.submissionId };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle("hv:session-pulse-asked", (_e, sessionId: string) => {
    index.update(sessionId, { pulseAskedAt: new Date().toISOString() });
  });
```
`getDefaultModel` — use whatever ipc.ts already calls for the global default (the function `resolveSpawnModel` at ipc.ts:815 reads; grep `defaultModel` there and reuse that accessor). `app` is already imported in ipc.ts if it uses `app.getPath`; otherwise add it to the electron import.

Extend `hv:read-audit` (ipc.ts ~3920): add `log.read({ type: "feedback.sent", ...filter })` to the `Promise.all` and merge into the returned rows the same way `excluded` is merged (rows are concatenated and sorted by `ts` — follow the existing code exactly).

**`src/main/analytics.ts`** — in the switch after `case "model.excluded":`'s `break;`:
```ts
      case "feedback.sent":
        // §34: a feedback submission is a fact for the AUDIT log, not a number
        // for the dashboard. Named so the switch stays an inventory.
        break;
```

**`src/preload/index.ts`** — after `setOnboardingSeen`:
```ts
  // ── §34: collect feedback ─────────────────────────────────────────────
  feedbackInfo: () => ipcRenderer.invoke("hv:feedback-info"),
  feedbackOpen: (args: { sessionId: string | null; view: string }) => ipcRenderer.invoke("hv:feedback-open", args),
  feedbackClose: () => ipcRenderer.invoke("hv:feedback-close"),
  feedbackSend: (args: unknown) => ipcRenderer.invoke("hv:feedback-send", args),
  feedbackPulseForm: () => ipcRenderer.invoke("hv:feedback-pulse-form"),
  feedbackPulseSend: (args: unknown) => ipcRenderer.invoke("hv:feedback-pulse-send", args),
  sessionPulseAsked: (sessionId: string) => ipcRenderer.invoke("hv:session-pulse-asked", sessionId),
```

**`src/renderer/src/hv.d.ts`** — add the seven signatures from the Interfaces block after `setOnboardingSeen`, plus `interface HvFormDefinition` / `HvFormElement` / `HvAnswers` / `HvSessionFacts` mirrors (the renderer cannot import from `src/main`; mirror the shapes from Task 4's `FormElement` union verbatim, prefixed `Hv`).

- [ ] **Step 4: Run the test + `npm run typecheck`.** Both green.
- [ ] **Step 5: Commit** — `feat(feedback): IPC surface, feedback.sent audit row, analytics no-op`.

---

### Task 8: `feedbackForm.ts` — pure form logic for the renderer

**Files:**
- Create: `src/renderer/src/feedbackForm.ts`
- Test: `tests/feedback-form.test.ts`

**Interfaces — Produces:**
```ts
export type FormState = Record<string, string | string[] | undefined>;   // questionId → text/email value | optionId | optionIds
export const KNOWN_TYPES = ["title", "subtitle", "body_text", "choice", "text", "email", "screenshot"] as const;
export function isQuestion(el: HvFormElement): boolean;                  // choice|text|email|screenshot|unknown-with-required
export function pageComplete(page: HvFormPage, state: FormState, imageCount: (questionId: string) => number): boolean;
export function textError(el: HvFormElement & { type: "text" }, value: string): string | null;   // "newline" | "too long" | null
export function emailError(value: string): string | null;
export function unknownRequired(form: HvFormDefinition): HvFormElement[];   // Send disabled if non-empty
export function answersFor(form: HvFormDefinition, state: FormState): HvAnswers;   // never includes screenshot questions (main fills them)
export function pageIndexOf(form: HvFormDefinition, questionId: string): number;   // for 400 validation jumps
export function pulseShape(form: HvFormDefinition): { questionId: string; options: Array<{ id: string; label: string; emoji: string }> } | null;   // exactly 1 page, 1 single-select emoji choice, else null
```

- [ ] **Step 1: Write the failing test** — a fixture equal to the dev General form (copy the five pages from the live definition: ids `pg_0h7213ch39n3`… as fetched 2026-09-10) and the Session form (`el_m1jnhejwr94k`, five emoji options).

```ts
import { describe, expect, it } from "vitest";
import { answersFor, emailError, pageComplete, pageIndexOf, pulseShape, textError, unknownRequired } from "../src/renderer/src/feedbackForm";

const general = { /* the dev General form v2, verbatim from GET …/form — 5 pages */ } as HvFormDefinition;
const session = { /* the dev Session Rating form v1 */ } as HvFormDefinition;

describe("pageComplete", () => {
  it("a required single choice gates Next until picked", () => {
    expect(pageComplete(general.pages[0], {}, () => 0)).toBe(false);
    expect(pageComplete(general.pages[0], { el_szbmd4ddzewt: "op_7484gpbkt32d" }, () => 0)).toBe(true);
  });
  it("whitespace never satisfies a required text", () => {
    expect(pageComplete(general.pages[1], { el_5evwc8vfj3yc: "   " }, () => 0)).toBe(false);
    expect(pageComplete(general.pages[1], { el_5evwc8vfj3yc: "it broke" }, () => 0)).toBe(true);
  });
  it("optional pages are always complete", () => {
    expect(pageComplete(general.pages[2], {}, () => 0)).toBe(true);
    expect(pageComplete(general.pages[3], {}, () => 0)).toBe(true);
    expect(pageComplete(general.pages[4], {}, () => 0)).toBe(true);
  });
  it("a required screenshot counts images", () => {
    const page = { id: "p", elements: [{ ...general.pages[3].elements[0], required: true }] } as HvFormPage;
    expect(pageComplete(page, {}, () => 0)).toBe(false);
    expect(pageComplete(page, {}, () => 1)).toBe(true);
  });
});

describe("textError / emailError", () => {
  it("refuses a newline in a single-line text and an over-long value", () => {
    const single = { id: "x", type: "text", label: "l", required: false, multiline: false, maxLength: 5 } as const;
    expect(textError(single, "a\nb")).toMatch(/one line/i);
    expect(textError(single, "abcdef")).toMatch(/5/);
    expect(textError(single, "abc")).toBeNull();
    expect(textError({ ...single, multiline: true }, "a\nb")).toBeNull();
  });
  it("email is validated only when non-empty", () => {
    expect(emailError("")).toBeNull();
    expect(emailError("nope")).toMatch(/email/i);
    expect(emailError("a@b.co")).toBeNull();
  });
});

describe("answersFor", () => {
  it("emits Inlet's shapes, omits blanks, and never emits a screenshot key", () => {
    const a = answersFor(general, { el_szbmd4ddzewt: "op_7484gpbkt32d", el_5evwc8vfj3yc: " it broke ", el_fppmeabbfspe: undefined, el_86jj3z6wcjh6: "" });
    expect(a).toEqual({ el_szbmd4ddzewt: { optionId: "op_7484gpbkt32d" }, el_5evwc8vfj3yc: { value: "it broke" } });
  });
  it("a multi-select emits optionIds", () => {
    const multi = { pages: [{ id: "p", elements: [{ id: "q", type: "choice", label: "l", required: false, optionKind: "text", selection: "multi", orientation: "vertical", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] }] } as unknown as HvFormDefinition;
    expect(answersFor(multi, { q: ["a", "b"] })).toEqual({ q: { optionIds: ["a", "b"] } });
    expect(answersFor(multi, { q: [] })).toEqual({});
  });
});

describe("unknownRequired / pageIndexOf / pulseShape", () => {
  it("an unknown required element is reported; an unknown optional one is not", () => {
    const f = { pages: [{ id: "p", elements: [{ id: "u1", type: "rating", label: "r", required: true }, { id: "u2", type: "rating", label: "r", required: false }] }] } as unknown as HvFormDefinition;
    expect(unknownRequired(f).map((e) => e.id)).toEqual(["u1"]);
    expect(unknownRequired(general)).toEqual([]);
  });
  it("finds the page of a question for the 400 jump", () => {
    expect(pageIndexOf(general, "el_86jj3z6wcjh6")).toBe(4);
    expect(pageIndexOf(general, "nope")).toBe(-1);
  });
  it("the Session form is pulse-shaped; the General form is not", () => {
    expect(pulseShape(session)?.options.map((o) => o.emoji)).toEqual(["😖", "😕", "😐", "🙂", "😄"]);
    expect(pulseShape(session)?.questionId).toBe("el_m1jnhejwr94k");
    expect(pulseShape(general)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — straightforward pure functions over the `Hv*` types declared in `hv.d.ts` (Task 7). `answersFor` trims text/email, skips `""`/`undefined`/empty arrays, skips `screenshot`, skips content blocks, skips unknown types. `pulseShape` returns non-null only when `pages.length === 1`, the page has exactly one question, it is `choice` + `optionKind:"emoji"` + `selection:"single"`, and every option has an `emoji`.
- [ ] **Step 4: Run, verify pass; `npm run typecheck`.**
- [ ] **Step 5: Commit** — `feat(feedback): pure form logic — gating, answers, pulse shape`.

---

### Task 9: `sessionPulse.ts` — timing and eligibility, pure and seeded

**Files:**
- Create: `src/renderer/src/sessionPulse.ts`
- Test: `tests/session-pulse.test.ts`

**Interfaces — Produces:**
```ts
export interface PulseTiming { earliestMs: number; offsetMaxMs: number; minTurns: number }
export const PULSE_TIMING: { normal: PulseTiming; fast: PulseTiming } = {
  normal: { earliestMs: 10 * 60_000, offsetMaxMs: 20 * 60_000, minTurns: 3 },
  fast:   { earliestMs: 20_000,      offsetMaxMs: 0,           minTurns: 1 },
};
export function drawOffset(timing: PulseTiming, rand: () => number): number;   // rand() in [0,1) → U(0, offsetMaxMs), integer ms
export interface PulseState {
  asked: boolean;          // SessionMeta.pulseAskedAt present
  openedAt: number;        // ms epoch, this app run
  offsetMs: number;        // from drawOffset, drawn once at open
  now: number;
  turns: number;
  busy: boolean;
  promptOpen: boolean;     // a permission prompt is up for this session
  bannerShowing: boolean;  // crash banner or red-zone banner
  focused: boolean;        // this pane is the focused slot of its window
  available: boolean;      // feedbackInfo().available
}
export function pulseDecision(s: PulseState, timing: PulseTiming): boolean;
export const PULSE_COPY = {
  question: "How is this session going?",
  disclosure: "Sends your rating with the app version, OS and this session's size — never what was said.",
  thanks: "Thanks!",
  dismiss: "Not now",
  invite: "How is this session going? Tell us",   // degraded form (pulseShape null)
} as const;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { drawOffset, PULSE_COPY, PULSE_TIMING, pulseDecision, type PulseState } from "../src/renderer/src/sessionPulse";

const T0 = 1_000_000;
const ok = (over: Partial<PulseState> = {}): PulseState => ({ asked: false, openedAt: T0, offsetMs: 0, now: T0 + 11 * 60_000, turns: 3, busy: false, promptOpen: false, bannerShowing: false, focused: true, available: true, ...over });

describe("PULSE_TIMING", () => {
  it("normal is 10 min + U(0,20 min), ≥3 turns; fast is 20 s, no offset, 1 turn", () => {
    expect(PULSE_TIMING.normal).toEqual({ earliestMs: 600_000, offsetMaxMs: 1_200_000, minTurns: 3 });
    expect(PULSE_TIMING.fast).toEqual({ earliestMs: 20_000, offsetMaxMs: 0, minTurns: 1 });
  });
});

describe("drawOffset", () => {
  it("is seeded: same rand → same offset, spanning the whole window", () => {
    expect(drawOffset(PULSE_TIMING.normal, () => 0)).toBe(0);
    expect(drawOffset(PULSE_TIMING.normal, () => 0.5)).toBe(600_000);
    expect(drawOffset(PULSE_TIMING.normal, () => 0.999999)).toBeLessThan(1_200_000);
    expect(drawOffset(PULSE_TIMING.fast, () => 0.9)).toBe(0);
  });
});

describe("pulseDecision", () => {
  it("shows when every gate is open", () => expect(pulseDecision(ok(), PULSE_TIMING.normal)).toBe(true));
  it("each gate alone flips it off", () => {
    const flips: Partial<PulseState>[] = [
      { asked: true }, { now: T0 + 9 * 60_000 }, { offsetMs: 5 * 60_000, now: T0 + 12 * 60_000 }, { turns: 2 },
      { busy: true }, { promptOpen: true }, { bannerShowing: true }, { focused: false }, { available: false },
    ];
    for (const f of flips) expect(pulseDecision(ok(f), PULSE_TIMING.normal), JSON.stringify(f)).toBe(false);
  });
  it("the fast arm shows at 20 s after one turn", () => {
    expect(pulseDecision(ok({ now: T0 + 20_000, turns: 1 }), PULSE_TIMING.fast)).toBe(true);
    expect(pulseDecision(ok({ now: T0 + 19_999, turns: 1 }), PULSE_TIMING.fast)).toBe(false);
  });
  it("asked wins over everything — never a second ask", () => {
    expect(pulseDecision(ok({ asked: true, now: T0 + 999 * 60_000, turns: 99 }), PULSE_TIMING.normal)).toBe(false);
  });
});

describe("PULSE_COPY has no dead copy (§20)", () => {
  it("every key is referenced by SessionPulse.tsx", () => {
    const src = fs.readFileSync("src/renderer/src/components/SessionPulse.tsx", "utf8");
    const unused = Object.keys(PULSE_COPY).filter((k) => !src.includes(`PULSE_COPY.${k}`) && !src.includes(`C.${k}`));
    expect(unused).toEqual([]);
  });
  it("never says telemetry", () => {
    expect(Object.values(PULSE_COPY).join(" ")).not.toMatch(/telemetry/i);
  });
});
```

- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement**

```ts
/**
 * §34 — when the session pulse may appear. Pure and seeded so both timing arms
 * are one test. Evaluated by App on the agent_end beat, never mid-stream.
 */
export interface PulseTiming { earliestMs: number; offsetMaxMs: number; minTurns: number }
export const PULSE_TIMING = {
  normal: { earliestMs: 10 * 60_000, offsetMaxMs: 20 * 60_000, minTurns: 3 },
  fast: { earliestMs: 20_000, offsetMaxMs: 0, minTurns: 1 },
} as const satisfies Record<"normal" | "fast", PulseTiming>;

/** Drawn ONCE at session open: the pill must not land at the same moment for everyone. */
export function drawOffset(timing: PulseTiming, rand: () => number): number {
  return Math.floor(Math.min(Math.max(rand(), 0), 0.999999) * timing.offsetMaxMs);
}

export interface PulseState { asked: boolean; openedAt: number; offsetMs: number; now: number; turns: number; busy: boolean; promptOpen: boolean; bannerShowing: boolean; focused: boolean; available: boolean }

export function pulseDecision(s: PulseState, t: PulseTiming): boolean {
  if (s.asked || !s.available) return false;
  if (s.now - s.openedAt < t.earliestMs + s.offsetMs) return false;
  if (s.turns < t.minTurns) return false;
  return !s.busy && !s.promptOpen && !s.bannerShowing && s.focused;
}

export const PULSE_COPY = {
  question: "How is this session going?",
  disclosure: "Sends your rating with the app version, OS and this session's size — never what was said.",
  thanks: "Thanks!",
  dismiss: "Not now",
  invite: "How is this session going? Tell us",
} as const;
```
(The no-dead-copy case stays red until Task 11 creates `SessionPulse.tsx`; that is expected — note it in the commit message.)

- [ ] **Step 4: Run — all pass except the no-dead-copy case (file absent).**
- [ ] **Step 5: Commit** — `feat(feedback): pulse timing + eligibility, pure (copy test lands with the component)`.

---

### Task 10: Renderer — `EmojiChoice`, `FormRenderer`, `FeedbackDialog`, the sidebar icon, App wiring

**Files:**
- Create: `src/renderer/src/components/EmojiChoice.tsx`, `components/FormRenderer.tsx`, `components/FeedbackDialog.tsx`
- Modify: `components/Sidebar.tsx` (props + header row ~778-810 + rail ~735-745), `App.tsx` (state + `<Sidebar onFeedback …>` at ~2662 + dialog mount near `<OnboardingDialog`)
- Test: `tests/feedback-dialog.test.ts` (source scan)

**Interfaces:**
```tsx
// EmojiChoice.tsx — shared by the dialog and the pulse
export function EmojiChoice(p: { options: Array<{ id: string; label: string; emoji?: string }>; value?: string; onPick: (id: string) => void; size?: "md" | "sm" }): JSX.Element;
// FormRenderer.tsx — ONE page
export interface ImageItem { id: string; questionId: string; name: string; type: string; bytes: Uint8Array; thumb: string /* data: */; fromCapture?: boolean }
export function FormPageView(p: { page: HvFormPage; state: FormState; onChange: (q: string, v: string | string[] | undefined) => void; images: ImageItem[]; onAddImages: (q: string, files: File[]) => void; onRemoveImage: (id: string) => void; capture: { thumbnail: string; questionId: string; included: boolean; onToggle: (b: boolean) => void } | null; errors: Record<string, string> }): JSX.Element;
// FeedbackDialog.tsx
export function FeedbackDialog(p: { sessionId: string | null; view: string; onClose: () => void }): JSX.Element;
export const FEEDBACK_COPY = { title: "Send feedback", closed: "Feedback is closed right now.", unreachable: "Can't reach the feedback server.", retry: "Retry", back: "Back", next: "Next", send: "Send", sending: "Sending…", thanks: "Thanks — that's genuinely useful.", discard: "Discard what you typed?", keep: "Keep writing", discardYes: "Discard", captureLabel: "Attach a picture of this window", captureWarning: "A screenshot can show code, file names or keys. Check it before you send.", paste: "Paste an image (⌘V) or", choose: "choose a file…", unknown: "This question needs a newer HappyVibe.", rateLimited: "Too many sends from this network — try again in a minute.", failed: "Couldn't reach the feedback server — nothing was sent." } as const;
// Sidebar.tsx — new props
feedbackAvailable: boolean; onFeedback: () => void;
```

- [ ] **Step 1: Write the failing source-scan test** (`tests/feedback-dialog.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { FEEDBACK_COPY } from "../src/renderer/src/components/FeedbackDialog";

const dialog = fs.readFileSync("src/renderer/src/components/FeedbackDialog.tsx", "utf8");
const form = fs.readFileSync("src/renderer/src/components/FormRenderer.tsx", "utf8");
const sidebar = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
const app = fs.readFileSync("src/renderer/src/App.tsx", "utf8");

describe("§34 dialog", () => {
  it("uses the modal shell classes, so it sits at z-100 and hides browser panes", () => {
    expect(dialog).toMatch(/className="hv-overlay /);
    expect(dialog).toMatch(/className="hv-dialog /);
  });
  it("thumbnails are data: URLs — the CSP has no blob:", () => {
    expect(form + dialog).not.toMatch(/createObjectURL/);
    expect(form + dialog).toMatch(/readAsDataURL/);
  });
  it("no dead copy", () => {
    const unused = Object.keys(FEEDBACK_COPY).filter((k) => !(dialog + form).includes(`C.${k}`) && !(dialog + form).includes(`FEEDBACK_COPY.${k}`));
    expect(unused).toEqual([]);
  });
  it("the sidebar renders the icon in BOTH states, gated on availability", () => {
    expect((sidebar.match(/onFeedback/g) ?? []).length).toBeGreaterThanOrEqual(3); // prop + 2 renders
    expect((sidebar.match(/feedbackAvailable &&/g) ?? []).length).toBe(2);
    expect(sidebar).toMatch(/title="Send feedback"/);
  });
  it("App opens through feedbackOpen and drops the capture on close", () => {
    expect(app).toMatch(/window\.hv\.feedbackOpen\(/);
    expect(dialog).toMatch(/window\.hv\.feedbackClose\(\)/);
  });
});
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement**

`EmojiChoice.tsx`:
```tsx
export function EmojiChoice({ options, value, onPick, size = "md" }: { options: Array<{ id: string; label: string; emoji?: string }>; value?: string; onPick: (id: string) => void; size?: "md" | "sm" }): React.JSX.Element {
  const box = size === "md" ? "size-11 text-2xl" : "size-8 text-lg";
  return (
    <div role="radiogroup" className="flex items-center gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={o.label} title={o.label}
          onClick={() => onPick(o.id)}
          className={`${box} flex items-center justify-center rounded-xl border-2 cursor-pointer transition-transform hover:-translate-y-0.5 ${value === o.id ? "border-tangerine bg-honey-soft shadow-sticker" : "border-transparent hover:border-line"}`}>
          <span aria-hidden="true">{o.emoji ?? "•"}</span>
        </button>
      ))}
    </div>
  );
}
```

`FormRenderer.tsx` — `FormPageView` maps `page.elements` in order:
- `title` → `<h2 className="font-black text-xl tracking-tight">`, `subtitle` → `<h3 className="font-bold">`, `body_text` → `<p className="text-sm text-ink-soft">`.
- `choice` text single → vertical list of `<button role="radio">` pills (`rounded-xl border-2 px-3 py-2 text-left`; selected `border-tangerine bg-honey-soft`); multi → `<label><input type="checkbox">`. Emoji → `<EmojiChoice>`.
- `text` → `<textarea rows=5>` when `multiline`, else `<input>`; `maxLength`; a `<span>` counter shown when `value.length >= 0.9 * maxLength`; `onChange` strips `\n` for single-line; helperText below in `text-xs text-ink-soft`; `errors[el.id]` under it in `text-berry text-xs`.
- `email` → `<input type="email" placeholder>`.
- `screenshot` → the capture row (`<input type="checkbox">` + `C.captureLabel` + `<img src={capture.thumbnail} className="h-16 rounded border-2 border-line">`) only when `capture` is non-null; then thumbnails of `images` filtered to this question with a ✕ button each; then, while `images.length < el.maxCount`, a row: `C.paste` + `<label className="underline cursor-pointer">C.choose<input type="file" hidden accept={el.acceptedMediaTypes.join(",")} multiple onChange=…/></label>`; `C.captureWarning` in `text-xs text-ink-soft`. Files over `el.maxFileBytes` or outside `acceptedMediaTypes` are refused with `errors` text `"Only JPEG, PNG or WebP up to 10 MB."` computed from the element (never hard-code — derive from `acceptedMediaTypes`/`maxFileBytes`).
- unknown type → `<p>{label} <span className="text-ink-soft">{C.unknown}</span></p>`.

`FeedbackDialog.tsx`:
- On mount: `window.hv.feedbackOpen({ sessionId, view })` → states `loading | closed | unreachable | ready(form, thumbnail, source)`. Radix `<Dialog.Root open>` with `<Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />` and `<Dialog.Content className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(30rem,calc(100vw-3rem))] max-h-[min(40rem,calc(100vh-3rem))] overflow-y-auto rounded-2xl bg-paper-deep pegboard border-2 border-ink/80 shadow-pop p-6 focus:outline-none">`.
- Header: the form's first `title` element text (fallback `C.title`), `{step + 1} / {pages.length}`, ✕ (`Dialog.Close`).
- Body: `<FormPageView page={pages[step]} …/>`; a `paste` listener on the content element adds `clipboardData.files` images to the page's screenshot question (if the current page has one, else to the first screenshot question in the form).
- Footer: `Back` (disabled at 0), `Next` (disabled unless `pageComplete`), on the last page `Send` (disabled while sending or when `unknownRequired(form).length > 0`, with `C.unknown` beside it).
- Esc / ✕: if any text/email value is non-empty → inline confirm row (`C.discard` · `C.keep` · `C.discardYes`); else close. **Every close path calls `window.hv.feedbackClose()` then `onClose()`.**
- Send: `feedbackSend({ formVersion: form.formVersion, answers: answersFor(form, state), images: images.filter(i => !i.fromCapture).map(({questionId,name,type,bytes}) => ({questionId,name,type,bytes})), includeCapture, captureQuestionId, sessionId, view })`. On `ok` → `C.thanks`, auto-close after 1500 ms (timer cleared on unmount). On `validation` → `setStep(pageIndexOf(form, details[0].questionId))`, `errors[questionId] = message`. On `rate_limited` → `C.rateLimited`. On anything else → `C.failed` + `Retry` (re-runs Send with the same payload; `duplicate` is success).
- Image add: `FileReader.readAsDataURL` for `thumb`, `file.arrayBuffer()` → `Uint8Array` for `bytes`; id = `crypto.randomUUID()`.

`Sidebar.tsx`:
- Props: `feedbackAvailable: boolean; onFeedback: () => void;` (destructure both).
- Expanded header, BEFORE the search button:
```tsx
        {feedbackAvailable && (
          <button type="button" onClick={onFeedback} title="Send feedback" aria-label="Send feedback"
            className="shrink-0 text-ink-soft hover:text-ink cursor-pointer px-1">
            <FeedbackIcon />
          </button>
        )}
```
- Collapsed rail, directly after the BrandLogo button:
```tsx
        {feedbackAvailable && (
          <button type="button" onClick={onFeedback} title="Send feedback" aria-label="Send feedback" className={railBtn(false)}>
            <FeedbackIcon />
          </button>
        )}
```
- `FeedbackIcon`: an outlined speech bubble `<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12z"/></svg>` — define beside `SearchIcon`.

`App.tsx`:
- State: `const [feedbackInfo, setFeedbackInfo] = useState<{ available: boolean; fastPulse: boolean }>({ available: false, fastPulse: false });` loaded once in the boot effect: `void window.hv.feedbackInfo().then(setFeedbackInfo);`.
- `const [feedbackOpen, setFeedbackOpen] = useState(false);`
- Pass `feedbackAvailable={feedbackInfo.available}` and `onFeedback={() => setFeedbackOpen(true)}` to `<Sidebar>`.
- Mount beside `<OnboardingDialog …/>`: `{feedbackOpen && <FeedbackDialog sessionId={activeView === "chat" ? (focusedChatSessionId ?? null) : null} view={view} onClose={() => setFeedbackOpen(false)} />}` where `focusedChatSessionId` is the session of the focused slot of the active workspace's tabs (derive with the existing `chatTab`/`wsTabs.focused` helpers used at App.tsx:2846 — read that block and reuse the same expression).

- [ ] **Step 4: Run the test + `npm run typecheck`.** Green.
- [ ] **Step 5: Commit** — `feat(feedback): the feedback dialog, generic form renderer, and the sidebar icon in both states`.

---

### Task 11: `SessionPulse.tsx` + ChatView/App wiring

**Files:**
- Create: `src/renderer/src/components/SessionPulse.tsx`
- Modify: `components/ChatView.tsx` (new props; render after the red-zone `Banner` block, ~line 1006), `App.tsx` (per-session `openedAt`/`offsetMs`/`compactions`, `pulseAskedAt` from `sessions`, props at the `<ChatView` call ~3091)
- Test: `tests/session-pulse.test.ts` (Task 9's no-dead-copy case turns green), `tests/session-pulse-wiring.test.ts` (source scan)

**Interfaces:**
```tsx
export function SessionPulse(p: {
  sessionId: string;
  facts: () => HvSessionFacts;            // read lazily at tap time
  onAsked: () => void;                    // fires ONCE when the row first renders → hv:session-pulse-asked
  onOpenDialog: () => void;               // degraded path (pulseShape null)
}): JSX.Element | null;
// ChatView new props
pulse: { show: boolean; facts: () => HvSessionFacts; onAsked: () => void; onOpenDialog: () => void } | null;
promptOpen: boolean; focused: boolean;
```

- [ ] **Step 1: Write the failing wiring test** (`tests/session-pulse-wiring.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
const chat = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
const app = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
const pulse = fs.readFileSync("src/renderer/src/components/SessionPulse.tsx", "utf8");

describe("§34 pulse wiring", () => {
  it("the pulse is NOT a Banner", () => expect(pulse).not.toMatch(/<Banner/));
  it("the pulse yields to both banners and renders in their stack", () => {
    const i = chat.indexOf("<SessionPulse");
    expect(i).toBeGreaterThan(chat.indexOf("suggestCompact && ("));
    expect(chat.slice(i - 400, i)).toMatch(/crashed === null && !suggestCompact/);
  });
  it("App evaluates pulseDecision on the agent_end beat, never DEV", () => {
    expect(app).toMatch(/pulseDecision\(/);
    expect(app).toMatch(/feedbackInfo\.fastPulse \? PULSE_TIMING\.fast : PULSE_TIMING\.normal/);
    expect(app).not.toMatch(/import\.meta\.env\.DEV[^\n]*pulse/i);
  });
  it("asked is written at SHOW, from the component's first render", () => {
    expect(pulse).toMatch(/useEffect\(\(\) => \{\s*onAsked\(\);/);
  });
  it("dismiss sends nothing — no IPC in the dismiss handler", () => {
    const d = pulse.slice(pulse.indexOf("const dismiss"), pulse.indexOf("const dismiss") + 200);
    expect(d).not.toMatch(/window\.hv\./);
  });
});
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement**

`SessionPulse.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { EmojiChoice } from "./EmojiChoice";
import { PULSE_COPY as C } from "../sessionPulse";
import { pulseShape } from "../feedbackForm";

type Phase = { k: "loading" } | { k: "ready"; form: HvFormDefinition; shape: NonNullable<ReturnType<typeof pulseShape>> } | { k: "invite"; form: HvFormDefinition } | { k: "thanks" } | { k: "gone" };

export function SessionPulse({ sessionId, facts, onAsked, onOpenDialog }: { sessionId: string; facts: () => HvSessionFacts; onAsked: () => void; onOpenDialog: () => void }): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const asked = useRef(false);
  // §34: asked-at-SHOW. Fired once, on first render — a user who quits with the row up is not asked again.
  useEffect(() => {
    onAsked();
    asked.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    void window.hv.feedbackPulseForm().then((r) => {
      if (!live) return;
      if (!r.ok) { setPhase({ k: "gone" }); return; }
      const shape = pulseShape(r.form);
      setPhase(shape ? { k: "ready", form: r.form, shape } : { k: "invite", form: r.form });
    });
    return () => { live = false; };
  }, [sessionId]);

  const dismiss = (): void => setPhase({ k: "gone" });   // sends nothing, logs nothing — it counts as asked already

  const pick = async (optionId: string, form: HvFormDefinition, questionId: string): Promise<void> => {
    setPhase({ k: "thanks" });
    const r = await window.hv.feedbackPulseSend({ sessionId, formVersion: form.formVersion, questionId, optionId, session: facts() });
    if (!r.ok) console.warn("[feedback] pulse send failed:", r.kind, r.message);
    setTimeout(() => setPhase({ k: "gone" }), 2000);
  };

  if (phase.k === "gone" || phase.k === "loading") return null;
  return (
    <div className="flex items-center gap-3 px-6 py-2 border-b-2 border-line bg-paper text-sm">
      {phase.k === "thanks" && <span className="font-bold">{C.thanks}</span>}
      {phase.k === "ready" && (<>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold">{C.question}</span>
          <span className="text-xs text-ink-soft">{C.disclosure}</span>
        </div>
        <EmojiChoice size="sm" options={phase.shape.options} onPick={(id) => void pick(id, phase.form, phase.shape.questionId)} />
      </>)}
      {phase.k === "invite" && (
        <button type="button" onClick={onOpenDialog} className="font-semibold underline cursor-pointer">{C.invite}</button>
      )}
      {phase.k !== "thanks" && (
        <button type="button" onClick={dismiss} aria-label={C.dismiss} title={C.dismiss} className="ml-auto text-ink-soft hover:text-ink cursor-pointer">✕</button>
      )}
    </div>
  );
}
```

`ChatView.tsx` — new props `pulse`, `promptOpen`, `focused` (the last two are consumed by App's decision; ChatView receives `pulse.show` already decided but still guards on its own banners). After the red-zone Banner block:
```tsx
      {/* §34: the session pulse — one attention request at a time, so it
          yields to both banners. Not a Banner: those are for things that
          are wrong (§20). */}
      {pulse?.show && crashed === null && !suggestCompact && sessionId && (
        <SessionPulse sessionId={sessionId} facts={pulse.facts} onAsked={pulse.onAsked} onOpenDialog={pulse.onOpenDialog} />
      )}
```

`App.tsx`:
- Refs: `const pulseClock = useRef<Record<string, { openedAt: number; offsetMs: number }>>({});` — filled the first time a session is rendered in a chat pane this run: `pulseClock.current[sid] ??= { openedAt: Date.now(), offsetMs: drawOffset(timing, Math.random) }`.
- State: `const [compactions, setCompactions] = useState<Record<string, number>>({});` bumped where `compaction_end` is handled (~App.tsx:1508); `const [pulseShow, setPulseShow] = useState<Record<string, boolean>>({});`.
- On `agent_end` (after `stampTurnEnd(sid)`), and ALSO when the permission count for a session drops to zero:
```ts
        const timing = feedbackInfo.fastPulse ? PULSE_TIMING.fast : PULSE_TIMING.normal;
        const clock = pulseClock.current[sid];
        const meta = sessions.find((x) => x.id === sid);
        if (clock && !pulseShow[sid] && pulseDecision({
          asked: !!meta?.pulseAskedAt, openedAt: clock.openedAt, offsetMs: clock.offsetMs, now: Date.now(),
          turns: (turns[sid] || 0) + 1, busy: false, promptOpen: (pendingBySession[sid] ?? 0) > 0,
          bannerShowing: statuses[sid] === "crashed", focused: isFocusedSlot(sid), available: feedbackInfo.available,
        }, timing)) setPulseShow((p) => ({ ...p, [sid]: true }));
```
  (`isFocusedSlot(sid)`: the session of the focused slot of the active workspace's tabs equals `sid` — the same expression Task 10 derived for `focusedChatSessionId`. `turns[sid] + 1` because `setTurns` for this beat has not flushed yet — read how `turns` is bumped at agent_end and match it.) The red-zone banner is ChatView-internal, so ChatView re-checks `!suggestCompact` at render.
- Props to `<ChatView>`: `promptOpen={(pendingBySession[sid] ?? 0) > 0}`, `focused={isFocusedSlot(sid)}`, and
```tsx
            pulse={feedbackInfo.available ? {
              show: !!pulseShow[sid] && !busy[sid],
              facts: () => ({
                sittingMs: Date.now() - (pulseClock.current[sid]?.openedAt ?? Date.now()),
                turns: turns[sid] || 0, messages: (transcripts[sid] ?? []).length,
                contextTokens: selStats?.contextUsage?.tokens ?? null, contextWindow: selStats?.contextUsage?.contextWindow ?? null,
                compactions: compactions[sid] || 0,
              }),
              onAsked: () => void window.hv.sessionPulseAsked(sid),
              onOpenDialog: () => setFeedbackOpen(true),
            } : null}
```
  `show` hides the row while the agent streams and brings it back at idle — the component stays mounted through `pulseShow`, so `onAsked` fires once.

- [ ] **Step 4: Run both pulse tests + `npm run typecheck`.** Green, including Task 9's no-dead-copy case.
- [ ] **Step 5: Commit** — `feat(feedback): the session pulse — once per session, asked at show, yields to banners`.

---

### Task 12: Audit page row

**Files:**
- Modify: `src/renderer/src/components/AuditView.tsx` (`Row` union ~97, `toAuditRow` ~114, `matches` ~258, the render branch ~384)
- Test: `tests/feedback-audit.test.ts` (append two cases that import `toAuditRow`/`feedbackText`)

**Interfaces:**
```ts
interface FeedbackEvent { ts: string; sessionId?: string; workspaceId?: string; database: "general" | "session"; formVersion: number; submissionId: string; status: "accepted" | "duplicate"; attachments: number; bytes: number; channel?: string }
export type Row = … | ({ row: "feedback" } & FeedbackEvent);
export function feedbackText(r: FeedbackEvent): string;   // "Sent feedback · 2 screenshots" | "Rated the session"
```

- [ ] **Step 1: Write the failing test** — append to `tests/feedback-audit.test.ts`:
```ts
import { feedbackText, toAuditRow } from "../src/renderer/src/components/AuditView";
describe("AuditView feedback row", () => {
  const base = { ts: "2026-09-10T10:00:00.000Z", sessionId: "s1" };
  it("discriminates on the event TYPE and renders without content", () => {
    const r = toAuditRow({ ...base, type: "feedback.sent", data: { database: "general", formVersion: 2, submissionId: "sub_1", status: "accepted", attachments: 2, bytes: 4096 } } as never);
    expect(r.row).toBe("feedback");
    expect(feedbackText(r as never)).toBe("Sent feedback · 2 screenshots");
    const s = toAuditRow({ ...base, type: "feedback.sent", data: { database: "session", formVersion: 1, submissionId: "sub_2", status: "accepted", attachments: 0, bytes: 0 } } as never);
    expect(feedbackText(s as never)).toBe("Rated the session");
  });
  it("a duplicate replay is labelled as such", () => {
    const r = toAuditRow({ ...base, type: "feedback.sent", data: { database: "general", formVersion: 2, submissionId: "sub_1", status: "duplicate", attachments: 0, bytes: 0 } } as never);
    expect(feedbackText(r as never)).toBe("Sent feedback · already received");
  });
});
```
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — add the `FeedbackEvent` interface and `Row` variant; in `toAuditRow` before the memory branch: `if (e.type === "feedback.sent") return { row: "feedback", ...(e.data as unknown as Omit<FeedbackEvent, "ts">), ...base };`; `feedbackText` as specified (`attachments === 1` → "1 screenshot"; `0` → no suffix); in `matches`: `if (r.row === "feedback") return !decision && (!source || source === "feedback");`; add `"feedback"` to whatever list feeds the source filter's options (grep `SOURCE_LABEL` and the `<select>` options — follow how `"memory"` was added in §33); render branch beside the `oneshot` one: label `feedbackText(r)`, muted `submissionId` slice(0, 12), and `bytes` formatted with the file's existing byte formatter if one exists (else `${Math.round(bytes / 1024)} KB`).
- [ ] **Step 4: Run + typecheck.**
- [ ] **Step 5: Commit** — `feat(feedback): the Audit page shows every send`.

---

### Task 13: Live contract test against the Smoke tests database

**Files:**
- Create: `tests/feedback-live.test.ts`

- [ ] **Step 1: Write the test** (it is the deliverable; it skips itself without keys)

```ts
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createInletClient, sendSubmission } from "../src/main/feedback/inlet";
import { FEEDBACK_CHANNELS } from "../src/main/feedback/config";

// .env is gitignored and does not travel with a worktree — symlink it first
// (`ln -s ~/Documents/Github/HappyVibe/.env .env`). Same silent-skip class as
// the live-Pi tests: READ THE DURATION before believing a green run.
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const SMOKE_DB = "fdb_<from Task 1>";
const PUB = FEEDBACK_CHANNELS.dev.publishableKey!;
const SERVER = process.env.FEEDBACK_API_KEY;   // isk_ — cleanup ONLY, never imported by src/
const BASE = FEEDBACK_CHANNELS.dev.baseUrl;
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const created: string[] = [];

describe.skipIf(!SERVER)("§34 live: Inlet contract on the Smoke tests database", () => {
  it("read form → intent → upload 1×1 PNG → submit → 201, then a replay is a duplicate", async () => {
    const client = createInletClient({ baseUrl: BASE, publishableKey: PUB });
    const form = await client.readForm(SMOKE_DB);
    const text = form.pages.flatMap((p) => p.elements).find((e) => e.type === "text")!;
    const shot = form.pages.flatMap((p) => p.elements).find((e) => e.type === "screenshot")!;
    const r = await sendSubmission(client, SMOKE_DB, {
      formVersion: form.formVersion,
      answers: { [text.id]: { value: `smoke ${new Date().toISOString()}` } },
      uploads: [{ questionId: shot.id, name: "px.png", type: "image/png", bytes: new Uint8Array(PNG_1x1) }],
      clientContext: { appVersion: "test", channel: "dev" },
    });
    created.push(r.submissionId);
    expect(r.status).toBe("accepted");
    expect(r.attachments).toBe(1);
    expect(r.submissionId).toMatch(/^sub_/);
  }, 60_000);

  afterAll(async () => {
    for (const id of created) {
      const res = await fetch(`${BASE}/v1/feedback-databases/${SMOKE_DB}/submissions/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${SERVER}` } });
      expect([200, 204]).toContain(res.status);
    }
  });
});
```
Check the DELETE route and any required confirm body in `~/Documents/Github/inlet/docs/API.md` ("Reading and exporting feedback" / deletion) before relying on it; adapt the `afterAll` to the documented shape.

- [ ] **Step 2: Run it with the `.env` symlinked**: `npx vitest run tests/feedback-live.test.ts` → PASS in seconds (a real network round trip, ≥ 1 s — if it reports 0 tests run, the key was absent).
- [ ] **Step 3: Confirm cleanup** — `mcp__inlet__list_submissions` on `SMOKE_DB` returns none.
- [ ] **Step 4: Run it WITHOUT the key** (`FEEDBACK_API_KEY= npx vitest run tests/feedback-live.test.ts`) → 1 skipped.
- [ ] **Step 5: Commit** — `test(feedback): live Inlet contract on the Smoke tests database, self-cleaning`.

---

### Task 14: Gate, CLAUDE.md, docs

**Files:**
- Modify: `CLAUDE.md` (one Gotchas bullet), `docs/validation/d1.md` (short §34 wire-shape entry: the IPC results, the `feedback.sent` payload, the measured capture size on this Mac)

- [ ] **Step 1: `npm run gate`** — green. Then `npm run live:why` → prints nothing (no Pi-facing file changed); state that explicitly in the final message.
- [ ] **Step 2: CLAUDE.md bullet** under Gotchas:
```
- **§34 feedback: the only Inlet key in `src/` is a PUBLISHABLE `ipk_` key, and prod's is `null` until minted** (a signed-in admin in Inlet's web UI — an API key gets `insufficient_scope`). Null ⇒ no icon, no pulse (`hv:feedback-info`). The `isk_` server keys are `.env` only (`FEEDBACK_API_KEY`, `FEEDBACK_API_KEY_PROD`) for the MCP and `tests/feedback-live.test.ts`'s cleanup; `tests/feedback-secrets.test.ts` scans `src/`. The pulse's 20 s arm is `HV_FEEDBACK_FAST_PULSE=1` at launch — never `import.meta.env.DEV`, or every dev session posts a real row.
```
- [ ] **Step 3: Commit** — `docs(feedback): CLAUDE.md gotcha + d1 wire shapes`.

---

## Verification — what is TRUE on screen (GUI pass, `/uicheck`)

Run the dev server with `HV_FEEDBACK_FAST_PULSE=1 npm run dev`, then a second time without the flag.

**Sidebar (expanded), any view**
- A speech-bubble icon sits between the wordmark and the ⌘K search icon, tooltip "Send feedback".
- **Absence:** with `HV_FEEDBACK_PUBLISHABLE_KEY=nope npm run dev` (a non-`ipk_` value ⇒ config null), the icon is **absent** in both sidebar states and no pulse ever appears, even with the fast flag.

**Sidebar (collapsed rail)**
- The same icon sits directly under the logo tile; clicking it opens the dialog without expanding the sidebar.

**Feedback dialog (opened from the chat view with a browser pane open in the grid)**
- The dialog paints centred over everything, including the browser pane, which hides beneath the scrim (`data-covered` on the placeholder reads true).
- Header shows "Feedback for HappyVibe" (from the form, not a constant) and "1 / 5".
- Next is disabled until a kind is picked; picking enables it. Page 2's Next is disabled on whitespace.
- Page 4: the "Attach a picture of this window" thumbnail shows the **pre-open** state — no dialog, no scrim in it — and the browser pane appears as its placeholder in that thumbnail (the accepted limit). ⌘V with an image on the clipboard adds a second thumbnail; ✕ removes it; the "choose a file…" input accepts only JPEG/PNG/WebP.
- Send → "Thanks — that's genuinely useful." → the dialog closes by itself within ~2 s.
- **Observed on the Audit page** (Settings → Audit): a new row "Sent feedback · 1 screenshot" at the top, interleaved by time; the source filter offers "feedback"; selecting any decision filter hides it. The row shows **no answer text**.
- **Observed in Inlet** (`mcp__inlet__list_submissions` on `fdb_h2ntrck1mywr`): one new submission whose `clientContext` has exactly `appVersion, channel, os, electron, view, model` and whose `view` is `chat`.
- **Absence:** opening the dialog from Settings → MCP and sending shows `view: "settings/mcp"`-style id and **no `model`… unless a global default model is set** (then `model` is the global default) — and never a workspace path or session title anywhere in the payload.
- Esc with text typed → "Discard what you typed?" row; Esc on an empty dialog closes at once.

**Session pulse (fast flag on)**
- ~20 s after opening a session and after its first turn ends, a row "How is this session going? 😖 😕 😐 🙂 😄 ✕" appears above the composer with the disclosure line beneath. It is **not** red/berry and does not say "Dismiss" (that is Banner's word).
- Tap 🙂 → "Thanks!" for 2 s → gone. **Audit page:** "Rated the session". **Inlet:** `fdb_384szrcgeb7n` has a new submission whose `clientContext.session` has the six numeric keys and `contextTokens` matches the gauge (or `null` if the gauge says "measuring…").
- **Absence (once-ever):** close the session tab, reopen it, run another turn, wait 30 s — **no pulse**. Restart the app, reopen — still none. `sessions.json` shows `pulseAskedAt` on that session.
- **Absence (dismiss sends nothing):** in a fresh session, when the pulse appears click ✕; `mcp__inlet__list_submissions` count is unchanged and the Audit page shows no new row.
- **Yielding:** in a fresh session trigger the red-zone banner (or kill the Pi child to raise the crash banner) before 20 s elapse; the pulse does not appear beside it; dismiss the banner, finish a turn → the pulse appears.
- **Two windows:** move a second session to a new window; both can show their own pulse.

**Session pulse (flag off)**
- Open a session, run three quick turns inside two minutes — **no pulse** (10-minute floor). This is the regression the design risks most: a pulse in the first minute of every dev session.

**Regression sequence (dialog + capture lifecycle)**
- Open the dialog, close with ✕, open it again, tick the capture: the thumbnail is a **fresh** capture (the app state as of the second open, not the first). Then open the dialog in window A, then in window B, send from B with the capture ticked: the uploaded image is B's window. Check via `mcp__inlet__get_screenshot`.

**Layering**
- With the dialog open, press ⌘K: the search field stays under the scrim (nothing climbs above z-100); `tests/modal-layer.test.ts` stays green.

## Self-review notes

- Spec coverage: §4.1–4.6 → Tasks 5, 7, 8, 10; §5.1–5.4 → Tasks 6, 7, 9, 11; audit → Tasks 7, 12; tests §8 → Tasks 2–4, 8, 9, 12, 13 (coachmark copy test dropped with the coachmark); server prerequisites → Task 1 (+ the prod `ipk_` key, which only the maintainer can mint — tracked in the Notion doc §3, not a task here).
- Names used across tasks: `FormDefinition`/`Answers`/`Upload`/`SendResult`/`InletError` (Task 4) ↔ `Hv*` mirrors in `hv.d.ts` (Task 7) ↔ `feedbackForm.ts` (Task 8) ↔ components (Tasks 10–11); `HostFacts`/`SessionFacts`/`ModelRef` (Task 3) ↔ ipc (Task 7) ↔ `facts()` (Task 11); `pulseDecision`/`drawOffset`/`PULSE_TIMING`/`PULSE_COPY` (Task 9) ↔ App/SessionPulse (Task 11); `resolveFeedbackConfig`/`fastPulse` (Task 2) ↔ ipc (Task 7).
- Known open item, deliberately not a task: the prod publishable key. When it exists, replace `publishableKey: null` in `FEEDBACK_CHANNELS.prod`, re-run `tests/feedback-config.test.ts` (its "prod is unavailable" case INVERTS on purpose — update it to assert availability), and re-run the GUI absence check for the packaged build.
