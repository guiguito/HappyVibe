import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FormPageView, type CaptureOffer, type ImageItem } from "./FormRenderer";
import { BrandLogo } from "./BrandLogo";
import { FEEDBACK_COPY as C } from "./feedbackCopy";
import { answersFor, isKnown, pageComplete, pageIndexOf, unknownRequired, type FormState } from "../feedbackForm";

/**
 * §34 — the feedback form the user opens on purpose.
 *
 * An APP-LEVEL dialog: no sessionId, so `paneDialog` does not scope it (that
 * only scopes the two session dialogs) and it renders over settings pages too.
 * `.hv-overlay` / `.hv-dialog` carry z-index 100, which is what puts it above
 * every embedded browser pane; `tests/modal-layer.test.ts` guards that scale.
 */

type Phase =
  | { k: "loading" }
  | { k: "closed" }
  | { k: "unreachable" }
  | { k: "ready"; form: HvFormDefinition; source: "live" | "cache" }
  | { k: "sent"; queued: boolean };

/**
 * Long enough for the send-off to PLAY: the logo hop is 1250ms and the line
 * pops at 760ms, so the old 1500ms closed the dialog on the bounce's last
 * frame. 2600 leaves the settled frame on screen for about a second — and a
 * click still closes it immediately, so nobody is held here.
 *
 * Under `prefers-reduced-motion` the settled frame is instant (styles.css), and
 * this simply becomes a beat of reading time.
 */
const CLOSE_AFTER_MS = 2_600;

/** A data: URL, because the renderer CSP is `img-src 'self' data:` with no blob:. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function FeedbackDialog({
  sessionId,
  view,
  onClose,
}: {
  sessionId: string | null;
  view: string;
  onClose: () => void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [step, setStep] = useState(0);
  const [state, setState] = useState<FormState>({});
  const [images, setImages] = useState<ImageItem[]>([]);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [includeCapture, setIncludeCapture] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    void window.hv.feedbackOpen().then((r) => {
      if (!live) return;
      if (!r.ok) {
        setPhase({ k: r.reason === "not_published" ? "closed" : "unreachable" });
        return;
      }
      setThumbnail(r.thumbnail ?? null);
      setPhase({ k: "ready", form: r.form, source: r.source });
    });
    return () => {
      live = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  /** Every close path drops main's held capture — it is memory, not a file, but it is still bytes. */
  const close = (): void => {
    void window.hv.feedbackClose();
    onClose();
  };

  const typedSomething = Object.values(state).some((v) => typeof v === "string" && v.trim().length > 0);
  const requestClose = (): void => {
    if (phase.k === "ready" && typedSomething) setConfirmDiscard(true);
    else close();
  };

  const addFiles = async (questionId: string, files: File[]): Promise<void> => {
    const el = phase.k === "ready" ? findScreenshot(phase.form, questionId) : null;
    for (const f of files) {
      if (el && (!el.acceptedMediaTypes.includes(f.type) || f.size > el.maxFileBytes)) {
        setErrors((p) => ({ ...p, [questionId]: `${f.name} is not something we can send.` }));
        continue;
      }
      const [thumb, buf] = await Promise.all([readAsDataUrl(f), f.arrayBuffer()]);
      setImages((p) => [
        ...p,
        { id: crypto.randomUUID(), questionId, name: f.name, type: f.type, bytes: new Uint8Array(buf), thumb },
      ]);
    }
  };

  /** ⌘V anywhere in the dialog, routed to this page's screenshot question if it has one. */
  const onPaste = (e: React.ClipboardEvent): void => {
    if (phase.k !== "ready") return;
    const q = screenshotOn(phase.form.pages[step]) ?? firstScreenshot(phase.form);
    if (!q) return;
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) void addFiles(q.id, files);
  };

  const send = async (): Promise<void> => {
    if (phase.k !== "ready") return;
    setSending(true);
    setBanner(null);
    const captureQuestionId = firstScreenshot(phase.form)?.id ?? null;
    const r = await window.hv.feedbackSend({
      formVersion: phase.form.formVersion,
      answers: answersFor(phase.form, state),
      images: images.map(({ questionId, name, type, bytes }) => ({ questionId, name, type, bytes })),
      includeCapture: includeCapture && !!thumbnail,
      captureQuestionId,
      sessionId,
      view,
    });
    setSending(false);
    if (r.ok) {
      setPhase({ k: "sent", queued: r.status === "pending" });
      closeTimer.current = setTimeout(close, CLOSE_AFTER_MS);
      return;
    }
    if (r.kind === "validation" && r.details?.length) {
      // Jump to the page that holds the question the server named, and say why
      // there rather than at the bottom of a form the user has scrolled past.
      const next: Record<string, string> = {};
      for (const d of r.details) if (d.questionId) next[d.questionId] = d.message;
      setErrors(next);
      const first = r.details.find((d) => d.questionId)?.questionId;
      const at = first ? pageIndexOf(phase.form, first) : -1;
      if (at >= 0) setStep(at);
      return;
    }
    setBanner(r.kind === "rate_limited" ? C.rateLimited : C.failed);
  };

  const body = (): React.JSX.Element => {
    if (phase.k === "loading") return <p className="text-sm text-ink-soft">…</p>;
    if (phase.k === "closed") return <p className="text-sm text-ink-soft">{C.closed}</p>;
    if (phase.k === "unreachable")
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">{C.unreachable}</p>
          <button type="button" onClick={() => setPhase({ k: "loading" })} className="self-start rounded-xl border-2 border-line px-3 py-1.5 text-sm font-bold cursor-pointer hover:border-honey">
            {C.retry}
          </button>
        </div>
      );
    /**
     * The send-off. The house celebration, not a new one: the same bouncing
     * brand mark and staggered pop the onboarding hand-over uses, so finishing
     * a form feels like the one other moment in the app that congratulates you.
     * Centred in the fixed frame, which is why the frame had to stop resizing.
     */
    if (phase.k === "sent")
      return (
        <div className="min-h-[15rem] flex flex-col items-center justify-center gap-5 py-6 text-center">
          {/* The hop's transform lives on the wrapper, the scale on the mark
              itself, so the two never fight. `lg` is 56px, which reads timid
              in a 466px frame — this is the one place the mark is the subject
              rather than a label. */}
          <div className="hv-logo-hop">
            <BrandLogo size="lg" className="scale-[1.6]" />
          </div>
          <p className="hv-done-title font-black text-xl tracking-tight">{phase.queued ? C.queued : C.thanks}</p>
        </div>
      );

    const blocked = unknownRequired(phase.form);
    const shot = screenshotOn(phase.form.pages[step]);
    const capture: CaptureOffer | null =
      shot && thumbnail ? { thumbnail, questionId: shot.id, included: includeCapture, onToggle: setIncludeCapture } : null;

    return (
      <div className="flex flex-col gap-5">
        {phase.source === "cache" && <p className="text-xs text-ink-soft">{C.cached}</p>}
        <FormPageView
          page={phase.form.pages[step]}
          state={state}
          onChange={(q, v) => {
            setState((p) => ({ ...p, [q]: v }));
            setErrors((p) => (p[q] ? { ...p, [q]: "" } : p));
          }}
          images={images}
          onAddFiles={(q, files) => void addFiles(q, files)}
          onRemoveImage={(id) => setImages((p) => p.filter((i) => i.id !== id))}
          capture={capture}
          errors={errors}
        />
        {banner && <p className="text-sm font-semibold text-berry">{banner}</p>}
        {blocked.length > 0 && <p className="text-xs text-ink-soft">{C.unknown}</p>}
      </div>
    );
  };

  /**
   * Back / Next / Send, pinned to the bottom of the fixed frame rather than
   * following the content. On a one-question page they used to ride up under
   * the question and on the screenshot page they sat far below it — same two
   * buttons, a different place each step.
   */
  const footer = (): React.JSX.Element | null => {
    if (phase.k !== "ready") return null;
    const blocked = unknownRequired(phase.form);
    const last = step === phase.form.pages.length - 1;
    const canNext = pageComplete(phase.form.pages[step], state, (q) => images.filter((i) => i.questionId === q).length + (includeCapture && firstScreenshot(phase.form)?.id === q ? 1 : 0));
    const primary =
      "rounded-xl bg-tangerine text-paper font-bold px-4 py-1.5 text-sm border-2 border-tangerine-deep shadow-pop cursor-pointer hover:brightness-105 disabled:opacity-40 disabled:cursor-default disabled:shadow-none";
    return (
      <div className="flex items-center gap-2 pt-4 shrink-0">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => s - 1)}
          className="rounded-xl border-2 border-line px-3 py-1.5 text-sm font-bold cursor-pointer hover:border-honey disabled:opacity-40 disabled:cursor-default"
        >
          {C.back}
        </button>
        <div className="flex-1" />
        {last ? (
          <button type="button" disabled={!canNext || sending || blocked.length > 0} onClick={() => void send()} className={primary}>
            {sending ? C.sending : C.send}
          </button>
        ) : (
          <button type="button" disabled={!canNext} onClick={() => setStep((s) => s + 1)} className={primary}>
            {C.next}
          </button>
        )}
      </div>
    );
  };

  /**
   * The dialog's ACCESSIBLE name only — never drawn.
   *
   * It started as a visible header and was wrong twice: first it read the
   * form's own `title` element, so "Feedback for HappyVibe" appeared twice on
   * the page; then, fixed to the app's own words, it was still a second heading
   * above the one the form authors. The body renders the form in authored
   * order and that is the only title the user sees.
   */
  const heading = C.title;
  const counter = phase.k === "ready" ? `${step + 1} / ${phase.form.pages.length}` : null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          onPaste={onPaste}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestClose();
          }}
          aria-describedby={undefined}
          /**
           * The frame FITS ITS CONTENT — `max-h-`, never `h-`.
           *
           * A one-question step should not be padded out to the height of the
           * five-option one. The only step that needs a floor is the send-off,
           * and it asks for that itself (`min-h` on the celebration block)
           * rather than making every other step pay for it.
           *
           * The cap is the viewport: past it the body scrolls and the header
           * and footer stay put.
           */
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[min(30rem,calc(100vw-3rem))] max-h-[calc(100vh-3rem)] overflow-hidden rounded-2xl bg-paper-deep pegboard border-2 border-ink/80 shadow-pop p-6 focus:outline-none"
        >
          <div className="flex items-start gap-3 mb-4">
            {/* Screen-reader only. Radix requires a title for the dialog's
                accessible name, but the form authors its OWN title element and
                the body renders it — chrome must not repeat the content. */}
            <Dialog.Title className="sr-only">{heading}</Dialog.Title>
            <div className="flex-1" />
            {counter && <span className="text-xs font-bold text-ink-soft pt-1">{counter}</span>}
            <button type="button" onClick={requestClose} aria-label="Close" className="text-ink-soft hover:text-ink cursor-pointer leading-none">
              ✕
            </button>
          </div>
          {confirmDiscard ? (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <p className="text-sm font-semibold">{C.discard}</p>
              {/* §20 round 24: right-aligned, confirming action last — the
                  house rule every other dialog already followed. */}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDiscard(false)} className="rounded-xl border-2 border-line px-3 py-1.5 text-sm font-bold cursor-pointer hover:border-honey">
                  {C.keep}
                </button>
                <button type="button" onClick={close} className="rounded-xl bg-berry text-paper border-2 border-berry px-3 py-1.5 text-sm font-bold cursor-pointer hover:brightness-110">
                  {C.discardYes}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* `min-h-0` is what lets this shrink and scroll once the frame
                  hits the viewport cap; below that it simply sizes to content. */}
              <div className="min-h-0 overflow-y-auto">{body()}</div>
              {footer()}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ScreenshotEl = Extract<HvKnownElement, { type: "screenshot" }>;


function screenshotOn(page: HvFormPage): ScreenshotEl | null {
  for (const el of page.elements) if (isKnown(el) && el.type === "screenshot") return el;
  return null;
}

function firstScreenshot(form: HvFormDefinition): ScreenshotEl | null {
  for (const p of form.pages) {
    const s = screenshotOn(p);
    if (s) return s;
  }
  return null;
}

function findScreenshot(form: HvFormDefinition, id: string): ScreenshotEl | null {
  for (const p of form.pages) for (const el of p.elements) if (isKnown(el) && el.type === "screenshot" && el.id === id) return el;
  return null;
}
