import React, { useEffect, useState } from "react";
import { TogglePill } from "./PromptRow";
import { FAMILY_SWITCHES, RESPAWN_NOTE, type Family } from "../toolSwitches";

/** §13 round 26: one family switch as a row — Built-in tools renders it among its rows. */
export function FamilySwitchRow({
  family,
  on,
  onChange,
}: {
  family: Family;
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const copy = FAMILY_SWITCHES[family];
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">{copy.label}</span>
        <span className="text-xs text-ink-soft">{on ? copy.on : copy.off}</span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
    </div>
  );
}

/**
 * The same switch at the top of the family's own page. It reads and writes the one
 * `builtinTools` key, so flipping it here and on Built-in tools is flipping one setting.
 */
export function FamilySwitch({ family }: { family: Family }): React.JSX.Element | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void window.hv.builtinsGet().then((b) => setOn(b[family]));
  }, [family]);
  if (on === null) return null;
  return (
    <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden mb-8">
      <FamilySwitchRow
        family={family}
        on={on}
        onChange={(next) => void window.hv.builtinsSet({ [family]: next }).then(() => setOn(next))}
      />
    </div>
  );
}
