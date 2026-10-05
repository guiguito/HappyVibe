import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { withAuthEvent, type AuthEvent } from "../src/renderer/src/auth";

/**
 * "Signing in doesn't open the browser" (2026-09-03).
 *
 * `AuthFlowModal` renders whatever the NEWEST hv.auth notify says. Measured by
 * driving all six OAuth providers in the running app, the opening move differs
 * per provider, and two of them replace the URL almost immediately:
 *
 *   anthropic       auth_url  -> manual_code
 *   openrouter      progress  -> auth_url -> manual_code
 *   kimi-coding     device_code
 *   xai             device_code
 *   github-copilot  prompt   (GitHub Enterprise URL/domain)
 *   openai-codex    select   (which login method)
 *   openai          auth_url -> manual_code, in the SAME tick (Pi 0.99's Sign in with ChatGPT, 2026-10-05)
 *
 * So for Claude and OpenRouter the Open button and the address appeared for an
 * instant and were then replaced by a bare "paste the authorization code"
 * field: the user was told to finish in a browser that never opened, holding
 * no address to go to. The URL is now latched and opened.
 *
 * The latch moved out of the dialog on 2026-10-05. It used to live in an effect on the newest event,
 * which works only when React renders between the two events. ChatGPT sends them 0 ms apart, React
 * renders once with the second, and the effect never saw a URL: no Open browser, no address, and no
 * browser. The parent now folds every event through `withAuthEvent` (auth.ts) — a state updater runs
 * once per event even when the renders are batched.
 *
 * The other two are NOT broken — they ask a question before any URL exists —
 * which is why this file records the whole table rather than one case.
 */

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/renderer/src/components/AuthFlowModal.tsx"),
  "utf8",
);
const flat = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "").replace(/\s+/g, " ");

describe("the sign-in URL survives the stage after it", () => {
  it("is latched, not read from the current event", () => {
    expect(flat.includes("authUrl: string | null;"), "latched by the parent, passed in").toBe(true);
    expect(flat.includes("{authUrl && !terminal && ("), "rendered off the latch").toBe(true);
    // A latch inside the dialog only sees the events React rendered — the same-tick bug.
    expect(flat.includes("setAuthUrl"), "no latch of its own").toBe(false);
  });

  it("no longer gates the Open button on the auth_url stage being current", () => {
    // This is the regression in one line: the old condition.
    expect(flat.includes('event?.stage === "auth_url" && event.url && ('), "old gate gone").toBe(false);
  });

  it("opens the browser once per URL, not on every re-render", () => {
    expect(flat.includes("opened.current === authUrl"), "once per url").toBe(true);
    expect(flat.includes("opened.current = authUrl; void window.hv.openExternal(authUrl);"), "opens it").toBe(true);
  });

  it("keeps a manual way in for when the OS refuses or the tab is closed", () => {
    expect(flat.includes("window.hv.openExternal(authUrl)"), "button still there").toBe(true);
    expect(flat.includes("CopyButton text={authUrl}"), "and the address is copyable").toBe(true);
  });

  it("hides it once the flow ends, so a finished login stops offering a sign-in page", () => {
    expect(flat.includes("{authUrl && !terminal &&"), "terminal guard").toBe(true);
  });
});

describe("every stage a provider can open with is renderable", () => {
  it("covers the six measured opening moves", () => {
    // auth_url / device_code / prompt / select are the four openings observed
    // across the six providers; manual_code and progress follow them.
    for (const stage of ["auth_url", "device_code", "prompt", "manual_code", "select", "progress", "success", "error"]) {
      expect(flat.includes(`"${stage}"`), stage).toBe(true);
    }
  });
});

describe("withAuthEvent — the latch, one event at a time", () => {
  const ev = (stage: AuthEvent["stage"], extra: Partial<AuthEvent> = {}): AuthEvent =>
    ({ stage, provider: "openai", reqId: "r", method: "notify", ...extra }) as AuthEvent;

  it("auth_url then manual_code in one batch keeps the URL", () => {
    // React batches both updates into one render; the updaters still run once each, in order.
    const start = { provider: "openai", label: "ChatGPT", event: null };
    const s = withAuthEvent(withAuthEvent(start, ev("auth_url", { url: "https://auth.openai.com/x" })), ev("manual_code", { method: "input" }));
    expect(s.event?.stage).toBe("manual_code");
    expect(s.authUrl).toBe("https://auth.openai.com/x");
  });

  it("a later auth_url replaces the latched one; other stages never clear it", () => {
    let s = withAuthEvent({ provider: "p", label: "P", event: null }, ev("auth_url", { url: "https://a" }));
    s = withAuthEvent(s, ev("progress"));
    expect(s.authUrl).toBe("https://a");
    expect(withAuthEvent(s, ev("auth_url", { url: "https://b" })).authUrl).toBe("https://b");
  });

  it("both sign-in screens fold every event through it and pass the latch down", () => {
    for (const f of ["src/renderer/src/components/ModelsView.tsx", "src/renderer/src/components/OnboardingDoors.tsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/withAuthEvent\(cur, e\)/);
      expect(src, f).toMatch(/authUrl=\{login\.authUrl \?\? null\}/);
    }
  });
});
