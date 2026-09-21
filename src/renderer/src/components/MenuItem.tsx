/**
 * One row of a "+ opens a menu of things you can start" dropdown.
 *
 * Shared by the tab strip's pane `+` and the sidebar's project `+` (§29,
 * 2026-09-21), because the rule the tab strip wrote down is not about the tab
 * strip: **every row that HAS a keyboard binding shows it** — the menu is where
 * a binding gets taught, and a row that omits its own shortcut while the row
 * beneath it shows one reads as an oversight. One renderer is how that stays
 * true of both menus at once.
 *
 * `compact` is the sidebar's smaller family (the branch menu and the save `▾`
 * use the same sizes). It is a size, not a variant of the behaviour.
 */
export function MenuItem({
  label,
  hint,
  icon,
  compact = false,
  onPick,
}: {
  label: string;
  /** The shortcut, already formatted. Omitted where there is no exact one. */
  hint?: string;
  icon?: React.ReactNode;
  compact?: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={
        "flex w-full items-center justify-between gap-6 text-left whitespace-nowrap cursor-pointer " +
        (compact
          ? "rounded-lg px-2 py-1 text-[11px] font-bold hover:bg-honey-soft"
          : "px-3 py-2 text-[13px] hover:bg-paper-deep/60")
      }
      // onMouseDown, NOT onClick, and the preventDefault is the load-bearing
      // half. Pressing a button does not focus it, so a blur-dismissed menu's
      // blur fires with relatedTarget === null, its containment guard cannot see
      // that the pointer is still inside, and the menu unmounts between
      // mousedown and mouseup — the click then has nothing to land on. Measured
      // in the running app: after mousePressed the menu was already gone and
      // focus had fallen to BODY. Acting on the press sidesteps the race
      // entirely, and preventDefault stops the focus shift that starts it.
      // Reported twice before it was understood; hence one renderer.
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
    >
      <span className="flex items-center gap-2 text-ink-soft">
        {icon}
        <span className="text-ink">{label}</span>
      </span>
      {hint && <span className="text-[11px] text-ink-soft font-mono">{hint}</span>}
    </button>
  );
}
