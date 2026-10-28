import { useEffect, useState } from "react";
import { Section } from "./Section";
import { DENSITIES, type Density } from "../../../main/density";
import { applyDensity, currentDensity } from "../appearance";

/**
 * Appearance — how the app looks. One setting today, Density (main/density.ts),
 * and the natural home for the next one (a colour theme).
 *
 * Applies at once, in every window: the choice is set on this page's root
 * straight away, stored by main and pushed to the other windows.
 */
/** Each density's sketch, in fixed pixels: the same three lines, closer and finer. */
const SKETCH: Record<Density, { box: React.CSSProperties; line: number }> = {
  comfortable: { box: { padding: "10px 22px", gap: 8 }, line: 6 },
  compact: { box: { padding: "6px 6px", gap: 4 }, line: 6 },
  "ultra-compact": { box: { padding: "4px 4px", gap: 3 }, line: 4 },
};

export function AppearanceView(): React.JSX.Element {
  const [density, setDensityState] = useState<Density>(currentDensity);

  // Changed in another window: this page follows.
  useEffect(() => window.hv.onDensityChanged((d) => setDensityState(applyDensity(d))), []);

  const choose = (d: Density): void => {
    setDensityState(applyDensity(d));
    void window.hv.setDensity(d);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Appearance</h1>
        <p className="text-sm text-ink-soft mb-8">How HappyVibe looks. Changes apply at once, in every window.</p>

        <Section icon="appearance" title="Density" subtitle="How much room the app gives everything. Only Ultra-compact makes text smaller.">
          <div className="grid gap-3 sm:grid-cols-3">
            {DENSITIES.map(({ id, name, note }) => {
              const active = density === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => choose(id)}
                  aria-pressed={active}
                  // A column from the top: a button centres its content, and the notes differ in length.
                  className={`flex flex-col text-left rounded-xl border-2 p-3 cursor-pointer transition-colors ${
                    active ? "border-tangerine bg-honey-soft/50" : "border-line hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-sm">{name}</span>
                    {id === "comfortable" && <span className="text-[10px] uppercase tracking-wide text-ink-soft">default</span>}
                  </div>
                  {/* A sketch of the difference, in fixed pixels (SKETCH) so it shows
                      each density whatever the app is set to. */}
                  <div
                    aria-hidden="true"
                    className="rounded-lg bg-paper-deep/60 flex flex-col"
                    style={SKETCH[id].box}
                  >
                    {[0.9, 0.65, 0.8].map((w, i) => (
                      <span key={i} className="block rounded-full bg-line-strong" style={{ width: `${w * 100}%`, height: SKETCH[id].line }} />
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-ink-soft">{note}</p>
                </button>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
