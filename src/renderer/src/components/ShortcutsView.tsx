import { useEffect, useState } from "react";
import { Section } from "./Section";
import {
  FIXED_SHORTCUTS, SHORTCUT_ACTIONS, eventToBinding, findConflict, formatBinding,
  type ShortcutId,
} from "../shortcuts";

const LABEL: Record<string, string> = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.label]));

/**
 * Round 8: the shortcuts cheat sheet becomes a page where the bindings are
 * editable — a list you can only read is a manual, one you can edit is a
 * feature. The whole map is written back through main (config.json), so a
 * rebind survives a restart.
 */
export function ShortcutsView({
  bindings,
  onChange,
}: {
  bindings: Record<ShortcutId, string>;
  onChange: (next: Record<ShortcutId, string>) => void;
}): React.JSX.Element {
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: Record<ShortcutId, string>): void => {
    onChange(next);
    void window.hv.setShortcuts(next);
  };

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setCapturing(null);
        setError(null);
        return;
      }
      const next = eventToBinding(e);
      if (!next) return; // still holding modifiers — keep listening
      e.preventDefault();
      e.stopPropagation();
      const clash = findConflict(bindings, capturing, next);
      if (clash) {
        setError(`${formatBinding(next)} is already used by "${LABEL[clash]}".`);
        return;
      }
      setCapturing(null);
      setError(null);
      apply({ ...bindings, [capturing]: next });
    };
    // Capture phase: the app's own global handler must not act on the combo the
    // user is in the middle of assigning.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, bindings]);

  const resetOne = (id: ShortcutId): void => {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultKey;
    const clash = findConflict(bindings, id, def);
    if (clash) {
      setError(`The default ${formatBinding(def)} is currently used by "${LABEL[clash]}".`);
      return;
    }
    setError(null);
    apply({ ...bindings, [id]: def });
  };

  const resetAll = (): void => {
    setError(null);
    apply(Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey])) as Record<ShortcutId, string>);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Keyboard shortcuts</h1>
        <p className="text-sm text-ink-soft mb-8">Click a shortcut to record a new one. Esc cancels.</p>

        <Section icon="keyboard" title="Editable" subtitle="Yours to change — stored on this machine.">
          {error && <p className="text-sm text-berry mb-3">{error}</p>}
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {SHORTCUT_ACTIONS.map((a) => {
              const isDefault = bindings[a.id] === a.defaultKey;
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0">
                  <span className="flex-1 text-sm">{a.label}</span>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => resetOne(a.id)}
                      className="text-xs font-bold text-ink-soft hover:text-tangerine cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setCapturing(a.id);
                    }}
                    aria-label={`Change the shortcut for ${a.label}`}
                    className={`min-w-20 rounded-md border-2 px-2 py-0.5 font-mono text-xs font-bold shadow-sticker cursor-pointer ${
                      capturing === a.id ? "border-tangerine bg-honey-soft animate-pulse" : "border-line-strong bg-card"
                    }`}
                  >
                    {capturing === a.id ? "press…" : formatBinding(bindings[a.id])}
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="mt-3 rounded-lg border-2 border-line bg-card px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer hover:bg-paper-deep"
          >
            Reset all to defaults
          </button>
        </Section>

        <Section icon="keyboard" title="Built-in" subtitle="Typing and dialog behaviour — not rebindable.">
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {FIXED_SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0">
                <span className="flex-1 text-sm">{s.label}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">built-in</span>
                <kbd className="min-w-20 text-center rounded-md border-2 border-line bg-paper-deep px-2 py-0.5 font-mono text-xs font-bold">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
