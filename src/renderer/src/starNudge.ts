/**
 * §36 — when to ask for a GitHub star, as pure policy.
 *
 * Same shape as §34's `sessionPulse.ts`: the decision is a function of stored
 * state and the clock, so it is one test and no DOM. The card only renders it.
 *
 * The whole mechanism is ONE stored instant — "stay silent until this ISO
 * stamp" — rather than a shown-count plus a last-shown date plus a starred
 * flag. Three fields would need a rule for every combination; one field cannot
 * disagree with itself, and both outcomes (starred, later) are the same write
 * with a different number of days.
 */

/**
 * How long into an app run the card waits.
 *
 * Deliberately NOT randomised the way §34's pulse offset is. That offset exists
 * because a rating asked at a fixed minute correlates with whatever the app
 * does at that minute and biases the answer; a star request has no answer to
 * bias. What it does have is a reason to be late: ten minutes in, the user has
 * done something with the app, so "if it helped today" is a question about
 * something that happened rather than a toll booth at launch.
 */
export const STAR_DELAY_MS = 10 * 60_000;

/**
 * The two snooze lengths, in days.
 *
 * `starred` is a guess and is allowed to be: clicking through to GitHub is not
 * proof of a star (nothing short of asking for an OAuth token would be, and
 * §5/§6 fence that off). A month is long enough that being wrong costs one
 * missed ask, and short enough that someone who meant to and forgot is asked
 * again.
 *
 * The ✕ writes `later` too — closing is not a stronger signal than "Later",
 * it is the same signal with less clicking, so there is one code path.
 */
export const STAR_SNOOZE_DAYS = { starred: 30, later: 3 } as const;

/** The repo. Public-facing string, so it lives beside the copy, not inline in JSX. */
export const STAR_URL = "https://github.com/guiguito/HappyVibe";

/**
 * Is the nudge due? `until` is the stored ISO stamp, or null if never shown.
 *
 * Fails OPEN on a stamp it cannot parse. The alternative — treat garbage as
 * "silent" — turns one corrupt write into a feature that is off forever with
 * nothing on screen saying so, which is the failure mode this repo keeps
 * paying for elsewhere. Being asked once too often is the cheaper mistake.
 */
export function starDue(until: string | null, now: number): boolean {
  if (!until) return true;
  const at = Date.parse(until);
  return Number.isNaN(at) || at <= now;
}

/**
 * §20's copy record. An unreferenced key fails `tests/star-nudge.test.ts`.
 *
 * The ask is earned rather than made: it names what the star is for (other
 * people finding the app) and ties it to something that already happened
 * ("if it helped today"), so it reads as a favour asked and not a toll.
 */
export const STAR_COPY = {
  title: "Enjoying HappyVibe?",
  body: "HappyVibe is open source. If it helped today, a GitHub star helps other developers find it.",
  cta: "Star on GitHub",
  /** Never "Maybe later" — the button is one word, the way §34's is "Not now". */
  later: "Later",
  /** The ✕'s accessible name; it has no visible label. */
  close: "Close",
} as const;
