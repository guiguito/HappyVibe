import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BrandLogo } from "./BrandLogo";
import { ModelsEscape, ProviderDoors } from "./OnboardingDoors";
import { ONBOARDING_COPY as C } from "../onboarding";

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
  children,
}: {
  n: string;
  done: boolean;
  active: boolean;
  title: string;
  body: string;
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
    const t = setTimeout(onDone, 1600);
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
      setFresh({ ...fresh, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(52rem,calc(100vw-3rem))] max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-8 focus:outline-none"
          onEscapeKeyDown={(e) => {
            // First Esc lands the animation; only a second one dismisses. §27's
            // "last in the Escape chain" care, one dialog over.
            e.preventDefault();
            if (welcome) { setWelcome(false); return; }
            onSkip();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-5">
            <div className={welcome ? "hv-bounce-in" : "-rotate-3"}>
              <BrandLogo size="lg" />
            </div>
            <div>
              <Dialog.Title className="font-black text-3xl tracking-tight leading-none">
                Happy<span className="text-tangerine">Vibe</span>
              </Dialog.Title>
              <Dialog.Description className="hv-rise-in-late text-ink-soft mt-1.5">
                {C.tagline}
              </Dialog.Description>
            </div>
          </div>

          {!welcome && !complete && (
            <div className="hv-rise-in mt-7">
              <h2 className="font-black text-xl tracking-tight mb-3">{C.setupHeader}</h2>

              <div className="flex flex-col gap-3">
                <StepRow n="1" done={modelReady} active={!modelReady} title={C.step1Title} body={C.step1Body}>
                  <ProviderDoors onChanged={onRefreshModel} />
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
                          className="flex-1 min-w-48 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none placeholder:text-ink-soft/60"
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

              <button
                type="button"
                onClick={onSkip}
                className="mt-5 text-sm text-ink-soft hover:text-ink cursor-pointer underline underline-offset-2"
              >
                {C.skip}
              </button>
            </div>
          )}

          {!welcome && complete && (
            <div className="hv-rise-in mt-10 mb-6 text-center">
              <div className="text-5xl mb-3" aria-hidden>🎉</div>
              <h2 className="font-black text-3xl tracking-tight">{C.doneTitle}</h2>
              <p className="text-ink-soft mt-2">{C.doneBody}</p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
