import { MOD } from "../platformCopy";
/**
 * §34 — every word the feedback dialog says, in one record (§20's rule).
 *
 * Its own module rather than an export of FeedbackDialog.tsx, because
 * FormRenderer reads it too and the no-dead-copy test scans both files: a
 * component importing its sibling's copy constant would be a cycle.
 */
export const FEEDBACK_COPY = {
  /** The button's tooltip and the fallback header, when a form has no title element. */
  title: "Send feedback",
  closed: "Feedback is closed right now.",
  unreachable: "Can't reach the feedback server.",
  /** Shown under a form served from the cache, so an old question is not a mystery. */
  cached: "Showing the last form we saw — you may be offline.",
  retry: "Retry",
  back: "Back",
  next: "Next",
  send: "Send",
  sending: "Sending…",
  thanks: "Thanks — that's genuinely useful.",
  discard: "Discard what you typed?",
  keep: "Keep writing",
  discardYes: "Discard",
  captureLabel: "Attach a picture of this window",
  /** Inlet's own advice to integrators, passed on to the user. */
  captureWarning: "A screenshot can show code, file names or keys. Check it before you send.",
  paste: `Paste an image (${MOD}V) or`,
  choose: "choose a file…",
  unknown: "This question needs a newer HappyVibe.",
  rateLimited: "Too many sends from this network — try again in a minute.",
  failed: "Couldn't reach the feedback server — nothing was sent.",
} as const;
