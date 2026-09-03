import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
 *
 * So for Claude and OpenRouter the Open button and the address appeared for an
 * instant and were then replaced by a bare "paste the authorization code"
 * field: the user was told to finish in a browser that never opened, holding
 * no address to go to. The URL is now latched and opened.
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
    expect(flat.includes("const [authUrl, setAuthUrl]"), "latched").toBe(true);
    expect(flat.includes("{authUrl && !terminal && ("), "rendered off the latch").toBe(true);
  });

  it("no longer gates the Open button on the auth_url stage being current", () => {
    // This is the regression in one line: the old condition.
    expect(flat.includes('event?.stage === "auth_url" && event.url && ('), "old gate gone").toBe(false);
  });

  it("opens the browser once per URL, not on every re-render", () => {
    expect(flat.includes("opened.current === event.url"), "once per url").toBe(true);
    expect(flat.includes("window.hv.openExternal(event.url)"), "opens it").toBe(true);
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
