import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BrandLogo } from "./BrandLogo";
import { ModelsEscape, ProviderDoors } from "./OnboardingDoors";
import { ONBOARDING_COPY as C } from "../onboarding";
import { ipcMessage } from "../ipcError";

/**
 * §22 onboarding round (2026-09-01). One landscape dialog, three beats:
 * Welcome → Setup → Handover.
 *
 * It owns NO step state. `modelReady` and `workspaceReady` are the app's real
 * gates handed down (`hv:has-any-provider`, `workspaces.length`), which is
 * round 17's derive-guidance-from-the-gate rule applied to a flow: quitting
 * mid-way and coming back re-derives rather than restarting, signing in from
 * anywhere flips the checkmark, and a machine where a model already resolves is
 * honestly one step long instead of staging re-earned theatre.
 *
 * The only state here is which beat is on screen.
 *
 * On first run App suppresses its no-provider redirect to the Models page, so
 * what sits behind this scrim is the real app — not a second copy of the three
 * doors below. Dismissing re-arms that redirect.
 */

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

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
        <div
          className={`shrink-0 size-6 rounded-lg border-2 flex items-center justify-center font-black text-xs ${
            done ? "bg-leaf text-paper border-leaf" : "bg-card text-ink-soft border-line"
          }`}
          aria-hidden
        >
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
  onRefreshModel,
  onOpenFolder,
  onStartFresh,
  onGoModels,
  onSkip,
  onDone,
}: {
  modelReady: boolean;
  workspaceReady: boolean;
  /** Re-read the credential gate — the local-runner door has no main-side event. */
  onRefreshModel: () => void;
  onOpenFolder: () => void;
  onStartFresh: (name: string) => Promise<string | null>;
  onGoModels: () => void;
  onSkip: () => void;
  onDone: () => void;
}): React.JSX.Element {
  // Beat 1 is a timer, not a gate. Any click or key lands it early; a
  // reduced-motion user sees the settled frame from the first paint anyway
  // (styles.css kills the animation rather than speeding it up).
  const [welcome, setWelcome] = useState(true);
  const [fresh, setFresh] = useState<{ name: string; error: string | null } | null>(null);
  // A key the provider refused. Lives here rather than in ProviderDoors because
  // saving it CHECKS step 1 (the key is stored whatever the answer), which
  // unmounts the doors — and took the refusal with it.
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const land = (): void => setWelcome(false);
    const t = setTimeout(land, 2500);
    window.addEventListener("keydown", land);
    window.addEventListener("mousedown", land);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", land);
      window.removeEventListener("mousedown", land);
    };
  }, []);

  const complete = modelReady && workspaceReady;

  useEffect(() => {
    if (!complete || welcome) return;
    // The success path hands over: it does the next thing itself rather than
    // congratulating the user and leaving them on an empty screen.
    // The pops finish at ~920ms. Handing over at 1600 cut the moment short;
    // this leaves a beat to actually read it.
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [complete, welcome, onDone]);

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
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(54rem,calc(100vw-3rem))] h-[min(30rem,calc(100vh-3rem))] overflow-hidden rounded-2xl bg-paper-deep pegboard border-2 border-ink/80 shadow-pop p-7 focus:outline-none"
          onEscapeKeyDown={(e) => {
            // First Esc lands the animation; only a second one dismisses. §27's
            // "last in the Escape chain" care, one dialog over.
            e.preventDefault();
            if (welcome) { setWelcome(false); return; }
            onSkip();
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
              onClick={onSkip}
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
          <div className="grid h-full grid-rows-[minmax(0,1fr)] grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] gap-7">
            {/* LEFT — the brand. Constant across all three beats, which is what
                makes the dialog feel like one place rather than three screens. */}
            <div className="flex flex-col justify-center min-w-0 min-h-0">
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
            </div>

            {/* RIGHT — the work. Empty board while the film plays, so the logo
                has the full width to travel across. */}
            <div className="min-w-0 min-h-0">
              {!welcome && (
                <div className="hv-rise-in h-full overflow-y-auto">
                  {!complete ? (
                    // Centred, not top-anchored: the stack is shorter than the
                    // panel and pinning it to the top left a dead strip along
                    // the bottom. The left column centres too, so they agree.
                    <div className="h-full flex flex-col justify-center gap-3">
                        <StepRow n="1" done={modelReady} active={!modelReady} title={C.step1Title} body={C.step1Body} note={keyNote}>
                          <ProviderDoors onChanged={onRefreshModel} onNote={setKeyNote} />
                          <ModelsEscape onGo={onGoModels} />
                        </StepRow>

                        <StepRow
                          n="2"
                          done={workspaceReady}
                          active={modelReady && !workspaceReady}
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
                    </div>
                  ) : (
                    /* The celebration lands in the RIGHT panel, so the brand
                       column never moves and the dialog never resizes. */
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="hv-burst text-6xl mb-4" aria-hidden>🎉</div>
                      <h2 className="hv-done-title font-black text-3xl tracking-tight">{C.doneTitle}</h2>
                      <p className="hv-done-body text-ink-soft mt-2">{C.doneBody}</p>
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
