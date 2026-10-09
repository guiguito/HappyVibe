import { useState } from "react";
import { ALL_OFF_COPY, BUNDLED_NOTE, FAMILY_COPY, allToolsOff, toggleCore, weightLabel, type KitFamily } from "../toolSwitches";
import { TOOL_WEIGHTS } from "../../../main/toolWeights.generated";
import { kitTiles, setFamily, ONBOARDING_COPY as C, type KitDraft, type KitItems, type KitTile } from "../onboarding";
import { GOTO_LABELS } from "./GoTo";

const CORE_WEIGHT = Object.values(TOOL_WEIGHTS.core).reduce((a: number, b: number) => a + b, 0);

/** Per-tool weight; PowerShell is the Windows shell and weighs what bash does. */
const coreWeight = (n: string): number =>
  (TOOL_WEIGHTS.core as Record<string, number>)[n === "powershell" ? "bash" : n] ?? 0;

const flip = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/**
 * §22 (Onboarding kit round, 2026-10-09). Everything in the box, switchable, with what it weighs.
 * Pure presentation: the draft lives in OnboardingDialog (Esc must be able to Start with it),
 * and nothing here writes a setting — Start does, once.
 *
 * No `absolute`/`fixed` anywhere: the browser-coverage check reads those as overlays.
 */
export function OnboardingKit({
  draft,
  setDraft,
  items,
}: {
  draft: KitDraft;
  setDraft: (d: KitDraft) => void;
  items: KitItems;
}): React.JSX.Element {
  const [open, setOpen] = useState<KitTile["key"] | null>(null);
  const s = draft.switches;

  const weightOf = (t: KitTile): number =>
    t.key === "core" ? CORE_WEIGHT : t.key === "prompts" ? 0 : TOOL_WEIGHTS.families[t.key];
  const isOn = (t: KitTile): boolean =>
    t.key === "core" || t.key === "prompts" ? true : s[t.key] && (t.nestedUnder ? s.subagents : true);
  const label = (t: KitTile): string =>
    t.key === "prompts" ? GOTO_LABELS.promptTemplates : FAMILY_COPY[t.key].label;
  const what = (t: KitTile): string => (t.key === "prompts" ? C.kitPrompts : FAMILY_COPY[t.key].what);

  /** One row per item of a tile's list: checked = not in its off-list. */
  const rows = (t: KitTile): { id: string; name: string; tokens: number; on: boolean; disabled: boolean; toggle: () => void }[] => {
    switch (t.items) {
      case "core":
        return items.core.map((n) => ({
          id: n,
          name: n,
          tokens: coreWeight(n),
          on: !s.coreOff.includes(n),
          disabled: false,
          toggle: () => setDraft({ ...draft, switches: { ...s, coreOff: toggleCore(s.coreOff, n) } }),
        }));
      case "skills":
        return items.skills.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          on: !draft.skillsOff.includes(i.id),
          disabled: !s.skills,
          toggle: () => setDraft({ ...draft, skillsOff: flip(draft.skillsOff, i.id) }),
        }));
      case "agents":
        return items.agents.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          on: !draft.agentsOff.includes(i.id),
          disabled: !s.subagents,
          toggle: () => setDraft({ ...draft, agentsOff: flip(draft.agentsOff, i.id) }),
        }));
      case "prompts":
        return items.prompts.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          on: !draft.promptsOff.includes(i.id),
          disabled: false,
          toggle: () => setDraft({ ...draft, promptsOff: flip(draft.promptsOff, i.id) }),
        }));
      default:
        return [];
    }
  };

  // `mcp: false`: a fresh install has no server, so MCP gives the agent nothing.
  const noTools = allToolsOff(
    { ...s, mcp: false, imagesAvailable: items.imagesAvailable },
    items.core.includes("powershell") ? "powershell" : "bash",
  );

  const tiles = kitTiles(items.imagesAvailable);
  // Workflows renders INSIDE the Sub-agents tile (it needs sub-agents), not as its own tile.
  const nested = tiles.filter((t) => t.nestedUnder === "subagents");
  const tick = (t: KitTile, on: boolean): React.JSX.Element => (
    <input
      type="checkbox"
      className="mt-1 shrink-0 accent-tangerine cursor-pointer disabled:cursor-not-allowed"
      checked={on}
      disabled={(t.key === "askUser" && s.plan) || (t.nestedUnder === "subagents" && !s.subagents)}
      onChange={(e) => setDraft(setFamily(draft, t.key as KitFamily, e.target.checked))}
      aria-label={label(t)}
    />
  );

  return (
    <div className="text-left">
      <div className="grid grid-cols-2 gap-2">
        {tiles.filter((t) => !t.nestedUnder).map((t) => {
          const list = rows(t);
          const expanded = open === t.key;
          const on = isOn(t);
          return (
            <div
              key={t.key}
              className={`rounded-xl border-2 px-3 py-2 ${expanded ? "col-span-2" : ""} ${on ? "border-line bg-card" : "border-line/60 bg-paper-deep"}`}
            >
              <div className="flex items-start gap-2" title={what(t)}>
                {t.familyTick ? tick(t, on) : null}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold leading-snug ${on ? "" : "text-ink-soft"}`}>{label(t)}</div>
                  <div className="text-xs text-ink-soft">
                    {weightLabel(weightOf(t))}
                    {(t.key === "skills" || t.key === "subagents") && ` ${BUNDLED_NOTE}`}
                  </div>
                </div>
                {t.items && (
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : t.key)}
                    aria-expanded={expanded}
                    className="shrink-0 text-xs font-bold text-ink-soft hover:text-ink cursor-pointer px-1"
                  >
                    {expanded ? "▾" : "▸"} {list.length}
                  </button>
                )}
              </div>
              {t.key === "subagents" &&
                nested.map((n) => (
                  <div key={n.key} className="flex items-start gap-2 mt-1.5 pl-5" title={what(n)}>
                    {tick(n, isOn(n))}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold leading-snug ${isOn(n) ? "" : "text-ink-soft"}`}>{label(n)}</div>
                      <div className="text-xs text-ink-soft">{weightLabel(weightOf(n))}</div>
                    </div>
                  </div>
                ))}
              {expanded && list.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {list.map((r) => (
                    <label
                      key={r.id}
                      className={`flex items-center gap-1.5 text-xs min-w-0 ${r.disabled ? "text-ink-soft/60" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        className="shrink-0 accent-tangerine"
                        checked={r.on}
                        disabled={r.disabled}
                        onChange={r.toggle}
                      />
                      <span className="truncate">{r.name}</span>
                      {r.tokens > 0 && <span className="shrink-0 text-ink-soft/80">{weightLabel(r.tokens)}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {noTools && <p className="text-xs text-berry font-bold mt-2">{ALL_OFF_COPY}</p>}
    </div>
  );
}
