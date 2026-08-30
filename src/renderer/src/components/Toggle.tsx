/**
 * The app's on/off switch.
 *
 * Extracted 2026-08-30 from VoiceView, which had it inline; TerminalView carries
 * a third near-copy in its own tangerine tone. Adding a fourth for the Agents
 * page would have been the wrong direction, so this is the shared one — new
 * switches use it, and the remaining copies can adopt it when they are next
 * touched.
 *
 * `role="switch"` + `aria-checked` rather than a checkbox: it reads as a setting
 * that takes effect immediately, which is what these are, instead of a selection
 * waiting on a Save.
 */
export function Toggle({
  on,
  onChange,
  label,
  title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name — the control has no visible text of its own. */
  label: string;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      onClick={() => onChange(!on)}
      className={`shrink-0 w-11 h-6 rounded-full border-2 transition-colors cursor-pointer relative ${
        on ? "bg-sky-soft border-sky" : "bg-paper-deep border-line"
      }`}
    >
      <span
        className={`absolute top-[2px] size-4 rounded-full bg-card border-2 transition-all ${
          on ? "left-[22px] border-sky" : "left-[2px] border-line"
        }`}
      />
    </button>
  );
}
