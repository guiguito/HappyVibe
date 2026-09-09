/**
 * §34 — the emoji scale, shared by the feedback dialog and the session pulse.
 *
 * One component for both, because the two surfaces render the SAME kind of
 * Inlet question and reordering the scale in Inlet has to change both with no
 * release. The label is the accessible name and the tooltip; the emoji itself
 * is `aria-hidden`, because a screen reader announcing "grinning face" instead
 * of "Great" would be reading the decoration and not the answer.
 */
export function EmojiChoice({
  options,
  value,
  onPick,
  size = "md",
}: {
  options: Array<{ id: string; label: string; emoji?: string }>;
  value?: string;
  onPick: (id: string) => void;
  size?: "md" | "sm";
}): React.JSX.Element {
  const box = size === "md" ? "size-11 text-2xl" : "size-8 text-lg";
  return (
    <div role="radiogroup" className="flex items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => onPick(o.id)}
          className={`${box} flex items-center justify-center rounded-xl border-2 cursor-pointer transition-transform hover:-translate-y-0.5 ${
            value === o.id ? "border-tangerine bg-honey-soft shadow-sticker" : "border-transparent hover:border-line"
          }`}
        >
          <span aria-hidden="true">{o.emoji ?? "•"}</span>
        </button>
      ))}
    </div>
  );
}
