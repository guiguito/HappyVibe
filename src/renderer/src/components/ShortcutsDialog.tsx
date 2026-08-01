import { useEffect } from "react";
import { FIXED_SHORTCUTS, SHORTCUT_ACTIONS, formatBinding } from "../shortcuts";

const SHORTCUTS = [
  ...SHORTCUT_ACTIONS.map((a) => ({ keys: formatBinding(a.defaultKey), label: a.label })),
  ...FIXED_SHORTCUTS,
];

/** F6: keyboard-shortcuts cheat sheet. Opened by ⌘/ or the Help footer. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-xl">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-soft hover:text-ink cursor-pointer font-bold text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>
        <dl className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-3 text-sm">
              <dt className="shrink-0">
                <kbd className="inline-block rounded-md border-2 border-line-strong bg-card px-2 py-0.5 font-mono text-xs font-bold shadow-sticker">
                  {s.keys}
                </kbd>
              </dt>
              <dd className="flex-1 text-ink-soft">{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
