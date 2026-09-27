import { describe, expect, it } from "vitest";
import { onboardingStep, promptFlags } from "../src/renderer/src/usageUi";
import { checkEvent } from "../src/main/usage/guard";

describe("§39 renderer helpers", () => {
  it("onboarding step", () => {
    expect(onboardingStep({ welcome: true, modelReady: false, workspaceReady: false })).toBe("welcome");
    expect(onboardingStep({ welcome: false, modelReady: false, workspaceReady: false })).toBe("setup_model");
    expect(onboardingStep({ welcome: false, modelReady: true, workspaceReady: false })).toBe("setup_workspace");
    expect(onboardingStep({ welcome: false, modelReady: true, workspaceReady: true })).toBe("handover");
  });
  it("prompt flags: counts and booleans only; /hv-* is not a prompt", () => {
    const base = { planMode: true, images: 2, documents: 1, mentions: 3, queued: false, viaVoice: true, templateNames: new Set(["review"]) };
    const p = promptFlags({ ...base, text: "/review please look at /Users/me/secret.ts" })!;
    expect(p).toEqual({ planMode: true, attachments: 3, fileMentions: 3, usedTemplate: true, viaVoice: true, queued: false });
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(checkEvent("prompt_sent", p).ok).toBe(true);
    expect(promptFlags({ ...base, text: "/hv-dangerous on" })).toBeNull();
    expect(promptFlags({ ...base, text: "/unknown thing" })!.usedTemplate).toBe(false);
    expect(promptFlags({ ...base, text: "   " })).toBeNull();
  });
});
