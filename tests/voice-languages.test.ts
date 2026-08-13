import { describe, it, expect } from "vitest";
import { VOICE_LANGUAGES, resolveLocale, isSupported } from "../src/main/voice/languages";
import { mergeVoiceSettings, VOICE_DEFAULTS } from "../src/main/voice/settings";

describe("voice languages", () => {
  it("offers exactly the 25 the model supports, with no duplicates", () => {
    expect(VOICE_LANGUAGES).toHaveLength(25);
    expect(new Set(VOICE_LANGUAGES.map((l) => l.code)).size).toBe(25);
    for (const l of VOICE_LANGUAGES) {
      expect(l.code, l.name).toMatch(/^[a-z]{2}$/);
      expect(l.name.length).toBeGreaterThan(2);
    }
  });

  it("EXCLUDES the languages that fail catastrophically — absent, never greyed out", () => {
    // Measured CER outside the set: Korean 171, Japanese 159, Chinese 124.
    // Confident, fluent-looking garbage handed to an agent that acts on it.
    const codes = VOICE_LANGUAGES.map((l) => l.code);
    for (const bad of ["ja", "ko", "zh", "ar", "hi", "th"]) {
      expect(codes, `${bad} must not be offered`).not.toContain(bad);
      expect(isSupported(bad)).toBe(false);
    }
  });

  it("flags the low-accuracy half rather than presenting all 25 as equivalent", () => {
    const by = Object.fromEntries(VOICE_LANGUAGES.map((l) => [l.code, l.tier]));
    expect(by.it).toBe("good"); // 3.0% WER
    expect(by.es).toBe("good"); // 3.5%
    expect(by.sl).toBe("lower"); // 24.0%
    expect(by.lv).toBe("lower"); // 22.8%
    expect(by.el).toBe("lower"); // 20.7%
    // The split is real, not decorative: both tiers must be populated.
    const lower = VOICE_LANGUAGES.filter((l) => l.tier === "lower").length;
    expect(lower).toBeGreaterThan(5);
    expect(lower).toBeLessThan(VOICE_LANGUAGES.length);
  });

  it("resolves a system locale, and says so plainly when it is unsupported", () => {
    expect(resolveLocale("fr-FR")).toEqual({ code: "fr", supported: true });
    expect(resolveLocale("en")).toEqual({ code: "en", supported: true });
    expect(resolveLocale("pt_BR")).toEqual({ code: "pt", supported: true });
    expect(resolveLocale("DE-de")).toEqual({ code: "de", supported: true });
    // Unsupported falls back to English AND reports it, so the page can name
    // the supported set instead of silently guessing.
    expect(resolveLocale("ja-JP")).toEqual({ code: "en", supported: false });
    expect(resolveLocale("")).toEqual({ code: "en", supported: false });
  });
});

describe("voice settings merge", () => {
  it("ships enabled and visible by default — voice is opt-out, not opt-in", () => {
    // Feedback round 2: functional activation is separate from whether the
    // model is downloaded, so these two say nothing about readiness.
    const s = mergeVoiceSettings(undefined);
    expect(s.enabled).toBe(true);
    expect(s.showInComposer).toBe(true);
  });

  it("keeps the two round-2 toggles independent", () => {
    // Hiding the chip must NOT disable the feature: the gesture and the overlay
    // keep working, which is the whole reason there are two settings.
    const hidden = mergeVoiceSettings({ showInComposer: false });
    expect(hidden.showInComposer).toBe(false);
    expect(hidden.enabled).toBe(true);

    const off = mergeVoiceSettings({ enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.showInComposer).toBe(true);
  });

  it("ignores wrong-typed round-2 toggles rather than coercing them", () => {
    expect(mergeVoiceSettings({ enabled: "no" as unknown as boolean }).enabled).toBe(true);
    expect(mergeVoiceSettings({ showInComposer: 0 as unknown as boolean }).showInComposer).toBe(true);
  });

  it("supplies defaults, with the processing toggles ON", () => {
    const s = mergeVoiceSettings(undefined);
    expect(s).toEqual(VOICE_DEFAULTS);
    expect(s.language).toBe("en");
    expect(s.echoCancellation).toBe(true);
    expect(s.noiseSuppression).toBe(true);
    expect(s.autoGainControl).toBe(true);
    expect(s.holdThresholdMs).toBe(300);
    expect(s.maxRecordingMs).toBe(300_000);
  });

  it("keeps values the user actually chose", () => {
    const s = mergeVoiceSettings({ language: "fr", noiseSuppression: false, holdThresholdMs: 500 });
    expect(s.language).toBe("fr");
    expect(s.noiseSuppression).toBe(false);
    expect(s.holdThresholdMs).toBe(500);
    expect(s.echoCancellation).toBe(true); // untouched fields keep their default
  });

  it("range-checks rather than trusting a stored value", () => {
    expect(mergeVoiceSettings({ holdThresholdMs: 5 }).holdThresholdMs).toBe(300);
    expect(mergeVoiceSettings({ holdThresholdMs: 99_999 }).holdThresholdMs).toBe(300);
    expect(mergeVoiceSettings({ maxRecordingMs: 999_999_999 }).maxRecordingMs).toBe(300_000);
    expect(mergeVoiceSettings({ maxRecordingMs: 10 }).maxRecordingMs).toBe(300_000);
    expect(mergeVoiceSettings({ holdThresholdMs: NaN }).holdThresholdMs).toBe(300);
  });

  it("never lets an unsupported language survive a read", () => {
    // Even if one is hand-edited into config.json, or persisted by an older build.
    expect(mergeVoiceSettings({ language: "ja" }).language).toBe("en");
    expect(mergeVoiceSettings({ language: "" }).language).toBe("en");
    expect(mergeVoiceSettings({ language: 42 as unknown as string }).language).toBe("en");
  });

  it("ignores wrong-typed booleans rather than coercing them", () => {
    const s = mergeVoiceSettings({ echoCancellation: "no" as unknown as boolean });
    expect(s.echoCancellation).toBe(true);
  });
});
