/**
 * The last segment of a path — separator-agnostic (PRD §4, Windows round).
 *
 * Fifteen renderer sites derived this with `split("/")`, which on Windows never
 * splits: the sidebar showed `C:\Users\me\Documents\HappyVibe\winprobe` where it meant
 * `winprobe`, and every file chip, plan row and audit line did the same. Found by
 * looking at the running app — a full path renders perfectly and reads as a bug only
 * to a human.
 *
 * Deliberately NOT used for two things that merely look like paths: a URL's host
 * (`browserError.ts`) and a `provider/model` id (`WorkspaceSettingsView`). Both are
 * forward-slash by definition and must not gain a backslash meaning.
 */
export function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}
