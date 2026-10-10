import { useEffect, useRef } from "react";
import { ALL_OFF_COPY, BUNDLED_NOTE, FAMILY_COPY, allToolsOff, weightLabel, type KitFamily } from "../toolSwitches";
import { TOOL_WEIGHTS } from "../../../main/toolWeights.generated";
import { ONBOARDING_COPY as C, kitTiles, setFamily, type KitDraft, type KitItems, type KitTile } from "../onboarding";
import { GOTO_LABELS } from "./GoTo";
import { BackButton } from "./BackButton";

type TileKey = KitTile["key"];

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
  open,
  setOpen,
}: {
  draft: KitDraft;
  setDraft: (d: KitDraft) => void;
  items: KitItems;
  /** The drill-in on screen. Owned by the dialog: Esc inside it means Back, not Continue. */
  open: TileKey | null;
  setOpen: (k: TileKey | null) => void;
}): React.JSX.Element {
  const s = draft.switches;
  // Focus follows the drill-in: into its Back on open, back to the ▸ it came from on close.
  const backRef = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<Partial<Record<TileKey, HTMLButtonElement | null>>>({});
  const last = useRef<TileKey | null>(null);
  useEffect(() => {
    if (open) backRef.current?.focus();
    else if (last.current) opener.current[last.current]?.focus();
    last.current = open;
  }, [open]);

  // Prompts is the one tile that isn't a family: no switch, weighs nothing, labelled from the sidebar.
  const label = (k: TileKey): string => (k === "prompts" ? GOTO_LABELS.promptTemplates : FAMILY_COPY[k].label);
  const what = (k: TileKey): string => (k === "prompts" ? C.kitPrompts : FAMILY_COPY[k].what);
  const weight = (k: TileKey): number => (k === "prompts" ? 0 : TOOL_WEIGHTS.families[k]);
  const isOn = (k: TileKey): boolean => (k === "prompts" ? true : draft.switches[k]);

  /** One row per item of a tile's list: checked = not in its off-list. */
  const rows = (t: KitTile): { id: string; name: string; tokens: number; on: boolean; disabled: boolean; toggle: () => void }[] => {
    switch (t.items) {
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

  const tick = (k: KitFamily, on: boolean): React.JSX.Element => (
    <input
      type="checkbox"
      className="mt-1 shrink-0 accent-tangerine cursor-pointer"
      checked={on}
      onChange={(e) => setDraft(setFamily(draft, k, e.target.checked))}
      aria-label={FAMILY_COPY[k].label}
    />
  );

  // Skills ▸ N / Sub-agents ▸ N swap the grid for their list (a drill-in): expanding inline
  // grew the step past the fixed frame (2026-10-10, nothing scrolls).
  const drill = open ? kitTiles(items.imagesAvailable).find((t) => t.key === open) : undefined;
  if (drill) {
    return (
      <div className="text-left">
        {/* Back alone on its own line, then the family as a heading (2026-10-10). `-ml-2` lines the
            chevron up with the text below it (the hit area is wider than the glyph). */}
        <BackButton ref={backRef} label={C.kitBack} onClick={() => setOpen(null)} className="-ml-2" />
        <div className="flex items-baseline gap-3 mt-1 mb-3">
          <h3 className="font-black text-lg tracking-tight">{label(drill.key)}</h3>
          <span className="text-xs text-ink-soft">{weightLabel(weight(drill.key))}{drill.key !== "prompts" && ` ${BUNDLED_NOTE}`}</span>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
          {rows(drill).map((r) => (
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
      </div>
    );
  }

  return (
    <div className="text-left">
      {/* 3 columns, two text lines per tile: 12 tiles (Prompts last) = 4 full rows of ~52px, measured into the
          fixed 864×544 frame with both small-window lines showing. */}
      <div className="grid grid-cols-3 gap-1.5">
        {kitTiles(items.imagesAvailable).map((t) => {
          const on = isOn(t.key);
          return (
            <div
              key={t.key}
              className={`rounded-xl border-2 px-2.5 py-1.5 ${on ? "border-line bg-card" : "border-line/60 bg-paper-deep"}`}
            >
              <div className="flex items-start gap-2" title={what(t.key)}>
                {t.familyTick && t.key !== "prompts" && tick(t.key, on)}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold leading-snug truncate ${on ? "" : "text-ink-soft"}`}>{label(t.key)}</div>
                  <div className="text-xs text-ink-soft leading-snug">
                    {weightLabel(weight(t.key))}
                    {(t.key === "skills" || t.key === "subagents") && ` ${BUNDLED_NOTE}`}
                  </div>
                </div>
                {t.items && (
                  <button
                    ref={(el) => { opener.current[t.key] = el; }}
                    type="button"
                    onClick={() => setOpen(t.key)}
                    aria-label={label(t.key)}
                    className="shrink-0 text-xs font-bold text-ink-soft hover:text-ink cursor-pointer px-1"
                  >
                    ▸ {rows(t).length}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {noTools && <p className="text-xs text-berry font-bold mt-1.5">{ALL_OFF_COPY}</p>}
    </div>
  );
}
