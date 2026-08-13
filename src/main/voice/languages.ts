/**
 * §27/§9. The 25 languages the model supports, and nothing else.
 *
 * Out-of-set input does NOT degrade gracefully. Measured character error rates
 * outside the set: Korean 171, Japanese 159, Chinese 124 — not degraded
 * transcripts but confident, fluent-looking garbage, handed to an agent that
 * acts on it. Whisper degrades politely under the same conditions; this model
 * does not. So unsupported languages are ABSENT from the picker rather than
 * greyed out, and automatic detection is rejected outright: the model has no
 * reliable language identification, so auto-detect would hand a Japanese user
 * a sentence they never said.
 *
 * `tier` marks the spread INSIDE the supported set, a consequence of
 * VoxPopuli-dominated training data — Italian 3.0% WER against Slovenian
 * 24.0%, Latvian 22.8%, Greek 20.7%. Presenting all 25 as equivalent would
 * leave users to discover that one bad prompt at a time.
 */
export interface VoiceLanguage {
  code: string;
  name: string;
  tier: "good" | "lower";
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: "bg", name: "Bulgarian", tier: "lower" },
  { code: "hr", name: "Croatian", tier: "lower" },
  { code: "cs", name: "Czech", tier: "good" },
  { code: "da", name: "Danish", tier: "lower" },
  { code: "nl", name: "Dutch", tier: "good" },
  { code: "en", name: "English", tier: "good" },
  { code: "et", name: "Estonian", tier: "lower" },
  { code: "fi", name: "Finnish", tier: "lower" },
  { code: "fr", name: "French", tier: "good" },
  { code: "de", name: "German", tier: "good" },
  { code: "el", name: "Greek", tier: "lower" },
  { code: "hu", name: "Hungarian", tier: "lower" },
  { code: "it", name: "Italian", tier: "good" },
  { code: "lv", name: "Latvian", tier: "lower" },
  { code: "lt", name: "Lithuanian", tier: "lower" },
  { code: "mt", name: "Maltese", tier: "lower" },
  { code: "pl", name: "Polish", tier: "good" },
  { code: "pt", name: "Portuguese", tier: "good" },
  { code: "ro", name: "Romanian", tier: "good" },
  { code: "ru", name: "Russian", tier: "good" },
  { code: "sk", name: "Slovak", tier: "lower" },
  { code: "sl", name: "Slovenian", tier: "lower" },
  { code: "es", name: "Spanish", tier: "good" },
  { code: "sv", name: "Swedish", tier: "good" },
  { code: "uk", name: "Ukrainian", tier: "good" },
];

export const DEFAULT_LANGUAGE = "en";

export function isSupported(code: string): boolean {
  return VOICE_LANGUAGES.some((l) => l.code === code);
}

/**
 * A system locale → a supported code. Never guesses: an unsupported locale
 * falls back to English AND reports `supported: false`, so the Voice page can
 * say which languages exist rather than silently pretending it chose well.
 */
export function resolveLocale(locale: string): { code: string; supported: boolean } {
  const base = (locale || "").split(/[-_]/)[0]?.toLowerCase() ?? "";
  return isSupported(base) ? { code: base, supported: true } : { code: DEFAULT_LANGUAGE, supported: false };
}
