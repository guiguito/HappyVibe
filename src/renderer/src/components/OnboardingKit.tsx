import { useEffect, useRef } from "react";
import { ALL_OFF_COPY, BUNDLED_NOTE, FAMILY_COPY, allToolsOff, weightLabel, type KitFamily } from "../toolSwitches";
import { TOOL_WEIGHTS } from "../../../main/toolWeights.generated";
import { ONBOARDING_COPY as C, firstClause, kitTiles, setFamily, type KitDraft, type KitItems, type KitTile } from "../onboarding";
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
  const byKeyboard = useRef(false);
  useEffect(() => {
    // Focus always moves (a11y); the ring shows only when ▸/Back was pressed from the keyboard
    // (`detail === 0`) — programmatic focus after a click would otherwise wear one.
    if (open) backRef.current?.focus({ focusVisible: byKeyboard.current });
    else if (last.current) opener.current[last.current]?.focus({ focusVisible: byKeyboard.current });
    last.current = open;
  }, [open]);

  // Prompts is the one tile that isn't a family: no switch, weighs nothing, labelled from the sidebar.
  const label = (k: TileKey): string => (k === "prompts" ? GOTO_LABELS.promptTemplates : FAMILY_COPY[k].label);
  const what = (k: TileKey): string => (k === "prompts" ? C.kitPrompts : FAMILY_COPY[k].what);
  const weight = (k: TileKey): number => (k === "prompts" ? 0 : TOOL_WEIGHTS.families[k]);
  const isOn = (k: TileKey): boolean => (k === "prompts" ? true : draft.switches[k]);
  const short = (k: TileKey): string => (k === "prompts" ? C.kitPromptsShort : FAMILY_COPY[k].short);
  const bundled = (k: TileKey): boolean => k === "skills" || k === "subagents";
  /** The tile shows the family's name without its "— N tools" count (it truncated at 3 columns); the tooltip keeps it. */
  const name = (k: TileKey): string => label(k).split(" — ")[0];
  const tip = (k: TileKey): string =>
    `${label(k)}. ${what(k)}${bundled(k) ? ` (${weightLabel(weight(k))} ${BUNDLED_NOTE})` : ""}`;

  /** One row per item of a tile's list: checked = not in its off-list. */
  const rows = (t: KitTile): { id: string; name: string; tokens: number; description: string; on: boolean; disabled: boolean; toggle: () => void }[] => {
    switch (t.items) {
      case "skills":
        return items.skills.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          description: i.description,
          on: !draft.skillsOff.includes(i.id),
          disabled: !s.skills,
          toggle: () => setDraft({ ...draft, skillsOff: flip(draft.skillsOff, i.id) }),
        }));
      case "agents":
        return items.agents.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          description: i.description,
          on: !draft.agentsOff.includes(i.id),
          disabled: !s.subagents,
          toggle: () => setDraft({ ...draft, agentsOff: flip(draft.agentsOff, i.id) }),
        }));
      case "prompts":
        return items.prompts.map((i) => ({
          id: i.id,
          name: i.name,
          tokens: i.tokens,
          description: i.description,
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
      className="shrink-0 accent-tangerine cursor-pointer"
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
      <div className="text-left" onKeyDown={(e) => { if (e.key === "Escape") byKeyboard.current = true; }}>
        {/* Back alone on its own line, then the family as a heading (2026-10-10). No negative margin:
            the step's scroll box clips anything left of its edge, ring included. */}
        <BackButton ref={backRef} label={C.kitBack} onClick={(e) => { byKeyboard.current = e.detail === 0; setOpen(null); }} />
        <div className="flex items-baseline gap-3 mt-1 mb-3">
          <h3 className="font-black text-lg tracking-tight">{label(drill.key)}</h3>
          <span className="text-xs text-ink-soft">{weightLabel(weight(drill.key))}{bundled(drill.key) && ` ${BUNDLED_NOTE}`}</span>
        </div>
        {/* 2 columns, two lines per item (name + weight, then its own one-liner): 10 items = 5 rows of
            32px + gap-y-3 = 208px, under a 76px header — sized into the 864×544 frame (see the dialog). */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {rows(drill).map((r) => (
            <label
              key={r.id}
              title={r.description || undefined}
              className={`flex items-start gap-2 text-xs min-w-0 ${r.disabled ? "text-ink-soft/60" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-tangerine"
                checked={r.on}
                disabled={r.disabled}
                onChange={r.toggle}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-bold">{r.name}</span>
                  {r.tokens > 0 && <span className="shrink-0 text-ink-soft/80">{weightLabel(r.tokens)}</span>}
                </span>
                <span className="block truncate text-ink-soft">{firstClause(r.description)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="text-left">
      {/* 3 columns, two lines per tile (name + weight, then the one-liner): 12 tiles (Prompts last) =
          4 rows of ~56px + 3 gaps of 8px = ~247px, sized into the fixed 864×544 frame with both
          small-window lines showing (budget in the dialog's step 3). */}
      <div className="grid grid-cols-3 gap-2">
        {kitTiles(items.imagesAvailable).map((t) => {
          const on = isOn(t.key);
          return (
            <div
              key={t.key}
              title={tip(t.key)}
              className={`rounded-xl border-2 px-3 py-2 ${on ? "border-line bg-card" : "border-line/60 bg-paper-deep"}`}
            >
              <div className="flex items-center gap-2">
                {t.familyTick && t.key !== "prompts" && tick(t.key, on)}
                <span className={`min-w-0 flex-1 text-sm font-bold leading-snug truncate ${on ? "" : "text-ink-soft"}`}>{name(t.key)}</span>
                <span className="shrink-0 text-xs text-ink-soft">{weightLabel(weight(t.key))}</span>
                {t.items && (
                  <button
                    ref={(el) => { opener.current[t.key] = el; }}
                    type="button"
                    onClick={(e) => { byKeyboard.current = e.detail === 0; setOpen(t.key); }}
                    aria-label={label(t.key)}
                    className="shrink-0 text-xs font-bold text-ink-soft hover:text-ink cursor-pointer px-1"
                  >
                    ▸ {rows(t).length}
                  </button>
                )}
              </div>
              <p className="text-xs text-ink-soft leading-snug truncate">{short(t.key)}</p>
            </div>
          );
        })}
      </div>
      {noTools && <p className="text-xs text-berry font-bold mt-1.5">{ALL_OFF_COPY}</p>}
    </div>
  );
}
