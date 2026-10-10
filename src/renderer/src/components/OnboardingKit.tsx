import { useEffect, useRef } from "react";
import { ALL_OFF_COPY, BUNDLED_NOTE, FAMILY_COPY, allToolsOff, weightLabel, type KitFamily } from "../toolSwitches";
import { TOOL_WEIGHTS } from "../../../main/toolWeights.generated";
import { ONBOARDING_COPY as C, kitTiles, setFamily, type KitDraft, type KitItems, type KitTile } from "../onboarding";

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
  open: KitFamily | null;
  setOpen: (k: KitFamily | null) => void;
}): React.JSX.Element {
  const s = draft.switches;
  // Focus follows the drill-in: into its ← Back on open, back to the ▸ it came from on close.
  const backRef = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<Partial<Record<KitFamily, HTMLButtonElement | null>>>({});
  const last = useRef<KitFamily | null>(null);
  useEffect(() => {
    if (open) backRef.current?.focus();
    else if (last.current) opener.current[last.current]?.focus();
    last.current = open;
  }, [open]);

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
      default:
        return [];
    }
  };

  // `mcp: false`: a fresh install has no server, so MCP gives the agent nothing.
  const noTools = allToolsOff(
    { ...s, mcp: false, imagesAvailable: items.imagesAvailable },
    items.core.includes("powershell") ? "powershell" : "bash",
  );

  const tick = (t: KitTile, on: boolean): React.JSX.Element => (
    <input
      type="checkbox"
      className="mt-1 shrink-0 accent-tangerine cursor-pointer"
      checked={on}
      onChange={(e) => setDraft(setFamily(draft, t.key, e.target.checked))}
      aria-label={FAMILY_COPY[t.key].label}
    />
  );

  // Skills ▸ N / Sub-agents ▸ N swap the grid for their list (a drill-in): expanding inline
  // grew the step past the fixed frame (2026-10-10, nothing scrolls).
  const drill = open ? kitTiles(items.imagesAvailable).find((t) => t.key === open) : undefined;
  if (drill) {
    return (
      <div className="text-left">
        <div className="flex items-baseline gap-3 mb-2">
          <button ref={backRef} type="button" onClick={() => setOpen(null)} className="text-xs font-bold text-ink-soft hover:text-ink underline underline-offset-2 cursor-pointer">
            {C.kitBack}
          </button>
          <span className="text-sm font-bold">{FAMILY_COPY[drill.key].label}</span>
          <span className="text-xs text-ink-soft">{weightLabel(TOOL_WEIGHTS.families[drill.key])} {BUNDLED_NOTE}</span>
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
      {/* 3 columns, two text lines per tile: 11 tiles = 4 rows of ~52px, measured into the
          fixed 864×544 frame with both small-window lines showing. */}
      <div className="grid grid-cols-3 gap-1.5">
        {kitTiles(items.imagesAvailable).map((t) => {
          const on = s[t.key];
          return (
            <div
              key={t.key}
              className={`rounded-xl border-2 px-2.5 py-1.5 ${on ? "border-line bg-card" : "border-line/60 bg-paper-deep"}`}
            >
              <div className="flex items-start gap-2" title={FAMILY_COPY[t.key].what}>
                {tick(t, on)}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold leading-snug truncate ${on ? "" : "text-ink-soft"}`}>{FAMILY_COPY[t.key].label}</div>
                  <div className="text-xs text-ink-soft leading-snug">
                    {weightLabel(TOOL_WEIGHTS.families[t.key])}
                    {(t.key === "skills" || t.key === "subagents") && ` ${BUNDLED_NOTE}`}
                  </div>
                </div>
                {t.items && (
                  <button
                    ref={(el) => { opener.current[t.key] = el; }}
                    type="button"
                    onClick={() => setOpen(t.key)}
                    aria-label={FAMILY_COPY[t.key].label}
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
