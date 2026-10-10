import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BrandLogo } from "./BrandLogo";
import { ModelsEscape, ProviderDoors, type KeyNote } from "./OnboardingDoors";
import { OnboardingKit } from "./OnboardingKit";
import { BackButton } from "./BackButton";
import { GOTO_LABELS } from "./GoTo";
import { KIT_FAMILIES } from "../toolSwitches";
import {
  ONBOARDING_COPY as C,
  DEFAULT_SWITCHES,
  basicsTotal,
  fullTotal,
  kitPreset,
  kitShape,
  kitTotal,
  onboardingScreen,
  smallModelLine,
  tooSmall,
  tooSmallLine,
  type KitDraft,
  type KitItems,
  type KitSwitches,
  type KitTile,
} from "../onboarding";
import { fmtNum } from "../analytics-format";
import { ipcMessage } from "../ipcError";
import { trackUi } from "../usage";
import { onboardingStep } from "../usageUi";

/**
 * §22 onboarding round (2026-09-01). One landscape dialog: Welcome → steps 1–2
 * → step 3 "Personalize" (the kit) → "You're in." (2026-10-10). Step 3 and the
 * last screen take the full width; nothing waits on a timer, and from step 3 on
 * Esc moves forward (Continue, then Start), never dismisses.
 *
 * It owns NO step state. `modelReady` and `workspaceReady` are the app's real
 * gates handed down (`hv:has-any-provider`, `workspaces.length`), which is
 * round 17's derive-guidance-from-the-gate rule applied to a flow: quitting
 * mid-way and coming back re-derives rather than restarting, signing in from
 * anywhere flips the checkmark, and a machine where a model already resolves is
 * honestly one step long instead of staging re-earned theatre.
 *
 * The only state here is which beat is on screen (`welcome`, `continued`).
 *
 * On first run App suppresses its no-provider redirect to the Models page, so
 * what sits behind this scrim is the real app — not a second copy of the three
 * doors below. Dismissing re-arms that redirect.
 */

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

/** The step number / checkmark square — shared by StepRow and step 3's compact line. */
const badge = (done: boolean): string =>
  `shrink-0 size-6 rounded-lg border-2 flex items-center justify-center font-black text-xs ${
    done ? "bg-leaf text-paper border-leaf" : "bg-card text-ink-soft border-line"
  }`;

function StepRow({
  n,
  done,
  active,
  title,
  body,
  note,
  children,
}: {
  n: string;
  done: boolean;
  active: boolean;
  title: string;
  body: string;
  /** Survives the collapse — see ProviderDoors' onNote. */
  note?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`rounded-2xl border-2 px-5 py-4 ${active ? "border-ink/70 bg-paper" : "border-line bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className={badge(done)} aria-hidden>
          {done ? "✓" : n}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`font-bold ${done ? "text-ink-soft line-through decoration-2" : ""}`}>{title}</div>
          {/* A completed row collapses to its checkmark: it has nothing left to
              say, and leaving it open makes the active step harder to find. */}
          {!done && <p className="text-sm text-ink-soft leading-snug mt-0.5">{body}</p>}
          {note && <p className="text-xs text-berry font-bold mt-1">{note}</p>}
          {active && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function OnboardingDialog({
  modelReady,
  workspaceReady,
  agentShell,
  onRefreshModel,
  onOpenFolder,
  onStartFresh,
  onGoModels,
  onSkip,
  onDone,
  onOpenGuide,
  contextWindow,
  kitItems,
  kitSwitches,
  onKitOpen,
  imagesAvailable,
  onOpenRoomGuide,
}: {
  modelReady: boolean;
  workspaceReady: boolean;
  /** §4: "powershell" means this Windows machine has no Git Bash. null = not yet probed. */
  agentShell: "bash" | "powershell" | null;
  /** Re-read the credential gate — the local-runner door has no main-side event. */
  onRefreshModel: () => void;
  onOpenFolder: () => void;
  onStartFresh: (name: string) => Promise<string | null>;
  onGoModels: () => void;
  onSkip: () => void;
  /** App writes the draft, then hands over. */
  onDone: (d: KitDraft) => Promise<void>;
  /** Docs in the app: the setup guide, in the system browser. */
  onOpenGuide: () => void;
  /**
   * The default model's context window, re-read after step 1. NOT `window` — that would shadow the global.
   * undefined = the re-read hasn't settled yet (the preset waits for it); null = unknown, which means full.
   */
  contextWindow: number | null | undefined;
  /** null while loading. */
  kitItems: KitItems | null;
  /** builtinsGet() after any preset write. */
  kitSwitches: KitSwitches | null;
  /** App writes the preset (basics) and loads the lists. */
  onKitOpen: (preset: "full" | "basics") => void;
  /** Decides the Images tile and the preset before the lists load. */
  imagesAvailable: boolean;
  /** The too-small line's link, in the system browser. */
  onOpenRoomGuide: () => void;
}): React.JSX.Element {
  // Beat 1 is a timer, not a gate. Any click or key lands it early; a
  // reduced-motion user sees the settled frame from the first paint anyway
  // (styles.css kills the animation rather than speeding it up).
  const [welcome, setWelcome] = useState(true);
  const [fresh, setFresh] = useState<{ name: string; error: string | null } | null>(null);
  // A key the provider refused. Lives here rather than in ProviderDoors because
  // saving it CHECKS step 1 (the key is stored whatever the answer), which
  // unmounts the doors — and took the refusal with it.
  const [keyNote, setKeyNote] = useState<KeyNote | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  // §39: how long the guide took, and whether the welcome was cut short.
  const mountedAt = useRef(Date.now());
  const skippedAnimation = useRef(false);
  useEffect(() => {
    trackUi("onboarding_started", { providerPrechecked: modelReady });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at open
  }, []);
  const dismiss = (): void => {
    trackUi("onboarding_dismissed", { atStep: onboardingStep({ welcome, modelReady: step1Done, workspaceReady }) });
    onSkip();
  };

  useEffect(() => {
    const land = (): void => setWelcome(false);
    const byUser = (): void => {
      skippedAnimation.current = true;
      land();
    };
    const t = setTimeout(land, 2500);
    window.addEventListener("keydown", byUser);
    window.addEventListener("mousedown", byUser);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", byUser);
      window.removeEventListener("mousedown", byUser);
    };
  }, []);

  // docs-round #9: a refused key is SAVED (the probe informs, never blocks), so the
  // gate reads ready — but step 1 isn't done, and the wizard doesn't hand over, until
  // a key is accepted or another door works.
  const step1Done = modelReady && !keyNote?.rejected;
  const complete = step1Done && workspaceReady;

  // The kit: the draft lives HERE (Esc must Start with it); OnboardingKit only renders it.
  const [draft, setDraft] = useState<KitDraft | null>(null);
  const starting = useRef(false);
  const reported = useRef(false);
  const [continued, setContinued] = useState(false);
  const [drill, setDrill] = useState<KitTile["key"] | null>(null);
  const screen = onboardingScreen({ welcome, complete, continued });
  const kitOpen = screen === "personalize" || screen === "done";
  const next = (): void => { if (draft) setContinued(true); };
  const ctx = contextWindow ?? null;

  useEffect(() => {
    // Waits for the window re-read: step 1 may have JUST connected the model, and a
    // not-yet-read window would open the full kit on a small model.
    if (!kitOpen || reported.current || contextWindow === undefined) return;
    reported.current = true;
    onKitOpen(kitPreset(contextWindow, fullTotal(imagesAvailable)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the beat opens and the window is known
  }, [kitOpen, contextWindow]);

  useEffect(() => {
    if (kitSwitches && draft === null) setDraft({ switches: kitSwitches, skillsOff: [], agentsOff: [], promptsOff: [] });
  }, [kitSwitches, draft]);

  const start = (): void => {
    if (!draft || starting.current) return;
    starting.current = true;
    setBusy(true);
    trackUi("onboarding_completed", {
      durationSec: Math.round((Date.now() - mountedAt.current) / 1000),
      skippedAnimation: skippedAnimation.current,
      kit: kitShape(draft),
      smallModel: kitPreset(ctx, fullTotal(imagesAvailable)) === "basics",
    });
    void onDone(draft);
  };

  const full = fullTotal(imagesAvailable);
  const smallModel = kitPreset(ctx, full) === "basics";
  const later = [GOTO_LABELS.builtinTools, GOTO_LABELS.skills];
  const doneSteps = [C.step1Title, C.step2Title];

  const createFresh = async (): Promise<void> => {
    if (!fresh || busy) return;
    setBusy(true);
    try {
      await onStartFresh(fresh.name);
      setFresh(null);
    } catch (err) {
      // Surface what actually went wrong. Collapsing this to "couldn't create
      // the folder" is the §27 "Could not start recording." mistake.
      setFresh({ ...fresh, error: ipcMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          ref={contentRef}
          /**
           * The size is FIXED for the whole flow — beats change what is in the
           * right panel, never how big the dialog is. A dialog that grows as
           * step 1 opens and shrinks again for the celebration re-anchors the
           * page under the pointer three times in twenty seconds.
           *
           * `bg-paper-deep pegboard` is the SIDEBAR's own surface (Sidebar.tsx),
           * not a new one: the workshop board the app is built on, so first run
           * looks like the place you are about to work in rather than a form.
           * `overflow-hidden` is load-bearing — it is what clips the logo while
           * it is still off frame to the right.
           */
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(54rem,calc(100vw-3rem))] h-[min(34rem,calc(100vh-3rem))] overflow-hidden rounded-2xl bg-paper-deep pegboard border-2 border-ink/80 shadow-pop p-7 focus:outline-none"
          onEscapeKeyDown={(e) => {
            // First Esc lands the animation; only a second one dismisses. §27's
            // "last in the Escape chain" care, one dialog over.
            e.preventDefault();
            if (welcome) { setWelcome(false); return; }
            // Step 3 and the last screen have no ✕: Esc moves forward with whatever the draft holds.
            // Inside a Skills/Sub-agents/Prompts drill-in, Esc is its Back.
            if (screen === "personalize") { if (drill) setDrill(null); else next(); return; }
            if (screen === "done") { start(); return; }
            dismiss();
          }}
          onOpenAutoFocus={(e) => {
            // Radix focuses the first tabbable, which here is the DISMISS — so
            // the wizard opened with a browser focus ring around ✕ and Enter
            // would have cancelled onboarding outright. Focus the dialog itself
            // instead: the scope is still trapped, Escape still works (Radix
            // listens on the document, not on focus), and Tab reaches the doors.
            e.preventDefault();
            contentRef.current?.focus();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* The only way out. Subtle by design — it sits over the board rather
              than in a chrome bar — but never hidden, and named by the tooltip
              so a bare glyph is not the whole explanation. */}
          {!complete && (
            <button
              type="button"
              onClick={dismiss}
              title={C.skip}
              aria-label={C.skip}
              className="absolute top-2.5 right-2.5 z-10 text-base leading-none text-ink-soft hover:text-ink cursor-pointer p-1.5"
            >
              ✕
            </button>
          )}

          {/* `grid-rows-[minmax(0,1fr)]` is load-bearing, not tidiness. An auto row
              grows past `h-full` when its content is taller, so the panel's own
              `h-full` resolved to the GROWN height, it never scrolled, and the
              dialog's overflow-hidden silently ate 121px of step 1 — measured. A
              row that cannot exceed the frame is what pushes the scroll inward. */}
          <div
            className={`grid h-full grid-rows-[minmax(0,1fr)] gap-7 ${kitOpen ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]"}`}
          >
            {/* LEFT — the brand, through the welcome and steps 1–2. Step 3 and the
                last screen need the width (2026-10-10), so it goes screen-reader-only
                there: Radix still finds its Title and Description. */}
            <div className={kitOpen ? "sr-only" : "flex flex-col justify-center min-w-0 min-h-0"}>
              <div className="flex items-center gap-3">
                <div className={welcome ? "hv-logo-travel" : undefined}>
                  <div className={welcome ? "hv-logo-hop" : "hv-logo-settled"}>
                    <BrandLogo size="lg" />
                  </div>
                </div>
                <Dialog.Title
                  className={`font-black text-4xl tracking-tight leading-none ${welcome ? "hv-word-drop" : ""}`}
                >
                  Happy<span className="text-tangerine">Vibe</span>
                </Dialog.Title>
              </div>
              <Dialog.Description
                className={`mt-7 text-2xl font-bold leading-snug text-ink-soft ${welcome ? "hv-tag-in" : ""}`}
              >
                {C.tagline}
              </Dialog.Description>
              {/* Brand column, not the work column: that one is already at its height limit. */}
              {!complete && !welcome && (
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="mt-6 self-start text-[13px] font-bold text-ink-soft hover:text-ink underline decoration-tangerine decoration-2 underline-offset-4 cursor-pointer"
                >
                  {C.guideLink}
                </button>
              )}
            </div>

            {/* RIGHT — the work. Empty board while the film plays, so the logo
                has the full width to travel across. */}
            <div className="min-w-0 min-h-0">
              {!welcome && (
                <div key={screen} className="hv-rise-in h-full overflow-y-auto">
                  {!complete ? (
                    // Centred, not top-anchored: the stack is shorter than the
                    // panel and pinning it to the top left a dead strip along
                    // the bottom. The left column centres too, so they agree.
                    // `min-h-full`, not `h-full`: a column pinned to the
                    // scroller's height spills its overflow ABOVE the top edge,
                    // where no scroll can reach (round 25).
                    <div className="min-h-full flex flex-col justify-center gap-3">
                        <StepRow n="1" done={step1Done} active={!step1Done} title={C.step1Title} body={C.step1Body} note={keyNote?.text}>
                          <ProviderDoors onChanged={onRefreshModel} onNote={setKeyNote} />
                          <ModelsEscape onGo={onGoModels} />
                        </StepRow>

                        <StepRow
                          n="2"
                          done={workspaceReady}
                          active={step1Done && !workspaceReady}
                          title={C.step2Title}
                          body={C.step2Body}
                        >
                          {fresh === null ? (
                            <div className="flex flex-wrap gap-2">
                              <button type="button" className={primaryBtn} onClick={onOpenFolder}>{C.step2Open}</button>
                              <button type="button" className={ghostBtn} onClick={() => setFresh({ name: "", error: null })}>
                                {C.step2Fresh}
                              </button>
                            </div>
                          ) : (
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  autoFocus
                                  value={fresh.name}
                                  onChange={(e) => setFresh({ name: e.target.value, error: null })}
                                  onKeyDown={(e) => { if (e.key === "Enter") void createFresh(); }}
                                  placeholder={C.step2FreshLabel}
                                  className="flex-1 min-w-40 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none placeholder:text-ink-soft/60"
                                />
                                <button
                                  type="button"
                                  className={primaryBtn}
                                  disabled={busy || !fresh.name.trim()}
                                  onClick={() => void createFresh()}
                                >
                                  {C.step2FreshCreate}
                                </button>
                              </div>
                              <p className="text-xs text-ink-soft mt-1.5">{C.step2FreshWhere}</p>
                              {fresh.error && <p className="text-xs text-berry font-bold mt-1.5">{fresh.error}</p>}
                            </div>
                          )}
                        </StepRow>

                        {/* §4 Windows round: only when the machine has no Git Bash.
                            Not a Banner, not persisted, not shown again — it names
                            the one thing that does not degrade, since the bundled
                            sub-agents ask for `bash` in frontmatter. */}
                        {agentShell === "powershell" && (
                          <p className="text-xs text-ink-soft mt-4 leading-snug">{C.gitForWindows}</p>
                        )}
                    </div>
                  ) : screen === "personalize" ? (
                    /* Step 3, full width, fits the fixed frame — nothing scrolls (2026-10-10);
                       `overflow-y-auto` above is only the tiny-window safety net. Top-anchored so
                       the header holds still when the drill-in list is shorter than the grid;
                       `min-h-full`, not `h-full` (round 25). */
                    <div className="min-h-full flex flex-col">
                      <div className="flex items-center gap-4 text-sm font-bold mb-3">
                        {doneSteps.map((t) => (
                          <div key={t} className="flex items-center gap-2">
                            <span className={badge(true)} aria-hidden>✓</span>
                            <span className="text-ink-soft line-through decoration-2">{t}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={badge(false)} aria-hidden>3</span>
                        <h2 className="font-black text-2xl tracking-tight">{C.step3Title}</h2>
                      </div>
                      <p className="text-sm text-ink-soft leading-snug mt-1">{C.kitHeadline} {C.kitSubline}</p>
                      {/* Only while nothing is ticked: "Load everything anyway" (or any tick) makes the line false.
                          Not inside a drill-in: it acts on the families, and the list needs its height.
                          Height budget, worst case (4k model + OpenRouter key), content box 484px
                          (544 − 2×2 border − 2×28 padding): done steps 36 + title 32 + body 23 +
                          this line 41 (2 lines) + too-small 21 + mt-3 12 + footer 52 = 217, leaving
                          267 for the grid (~247 used). In a drill-in this line hides, leaving 308 for
                          header 76 + 10 items (5 rows × 32 + 4 × 12 = 208) = 284. */}
                      {draft && !drill && smallModel && ctx && !KIT_FAMILIES.some((k) => draft.switches[k]) && (
                        <p className="mt-2 text-xs text-ink-soft leading-snug">
                          {smallModelLine(ctx, full)}{" "}
                          <button
                            type="button"
                            onClick={() => setDraft({ ...draft, switches: { ...DEFAULT_SWITCHES, coreOff: draft.switches.coreOff } })}
                            className="font-bold underline underline-offset-2 hover:text-ink cursor-pointer"
                          >
                            {C.kitLoadAll}
                          </button>
                        </p>
                      )}
                      {kitItems && ctx !== null && tooSmall(ctx) && (
                        <p className="mt-1 text-xs text-berry font-bold leading-snug">
                          {tooSmallLine(basicsTotal(kitItems), ctx)}{" "}
                          <button type="button" onClick={onOpenRoomGuide} className="underline underline-offset-2 cursor-pointer">
                            {C.kitMoreRoom}
                          </button>
                        </p>
                      )}
                      <div className="mt-3">
                        {draft && kitItems ? (
                          <OnboardingKit draft={draft} setDraft={setDraft} items={kitItems} open={drill} setOpen={setDrill} />
                        ) : (
                          <p className="text-sm text-ink-soft">{C.kitLoading}</p>
                        )}
                      </div>
                      {/* `mt-auto`: the footer sits at the panel's bottom-right whether the grid or a
                          drill-in list shows. The later-line rides its left side, so it costs no height. */}
                      <div className="mt-auto pt-3 flex items-center justify-between gap-4">
                        <p className="text-xs text-ink leading-snug">
                          {C.kitLaterLead} {later.join(", ")}{C.kitLaterAnd}{GOTO_LABELS.agents}.
                        </p>
                        <div className="flex items-center gap-4 shrink-0">
                          {draft && kitItems && (
                            <p className="text-xs text-ink-soft">~{fmtNum(kitTotal(draft, kitItems))} {C.kitTotalTail}</p>
                          )}
                          <button type="button" className={`${primaryBtn} whitespace-nowrap`} onClick={next} disabled={!draft}>
                            {C.kitContinue}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* The last screen, full width, waits for Start (no timer): Back top-left,
                       🎉 centred in the space above, consent + footer + Start at the bottom. */
                    <div className="min-h-full flex flex-col text-center">
                      <BackButton label={C.kitBack} onClick={() => setContinued(false)} disabled={busy} className="self-start -ml-2" />
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <div className="hv-burst text-5xl mb-2" aria-hidden>🎉</div>
                        <h2 className="hv-done-title font-black text-3xl tracking-tight">{C.doneTitle}</h2>
                      </div>
                      <div className="hv-done-body flex flex-col items-center">
                        <p className="text-sm text-ink leading-snug">🔒 {C.kitConsent}</p>
                        <p className="text-sm text-ink-soft mt-1 leading-snug">{C.kitFooter}</p>
                        <button type="button" className={`${primaryBtn} whitespace-nowrap mt-5`} onClick={start} disabled={busy || !draft}>
                          {C.kitStart}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
