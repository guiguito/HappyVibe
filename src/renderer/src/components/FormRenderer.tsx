import { EmojiChoice } from "./EmojiChoice";
import { isKnown, isQuestion, type FormState } from "../feedbackForm";
import { FEEDBACK_COPY as C } from "./feedbackCopy";

/**
 * §34 — one page of an Inlet form, rendered generically.
 *
 * Elements render in AUTHORED order, so content can sit before, between or
 * after questions exactly as the form's author placed it. Nothing here knows
 * which questions HappyVibe's own forms currently ask.
 */

export interface ImageItem {
  id: string;
  questionId: string;
  name: string;
  type: string;
  bytes: Uint8Array;
  /** data: URL — the renderer CSP is `img-src 'self' data:` with no blob:. */
  thumb: string;
  /** True for the window capture, which main holds and uploads itself. */
  fromCapture?: boolean;
}

export interface CaptureOffer {
  thumbnail: string;
  questionId: string;
  included: boolean;
  onToggle: (b: boolean) => void;
}

const field = "w-full rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:border-tangerine focus:outline-none";

/** "JPEG, PNG or WebP up to 10 MB" — derived from the question, never hard-coded. */
export function acceptSentence(el: Extract<HvKnownElement, { type: "screenshot" }>): string {
  const kinds = el.acceptedMediaTypes.map((t) => t.replace("image/", "").toUpperCase()).join(", ");
  return `${kinds} up to ${Math.round(el.maxFileBytes / (1024 * 1024))} MB.`;
}

export function FormPageView({
  page,
  state,
  onChange,
  images,
  onAddFiles,
  onRemoveImage,
  capture,
  errors,
}: {
  page: HvFormPage;
  state: FormState;
  onChange: (questionId: string, v: string | string[] | undefined) => void;
  images: ImageItem[];
  onAddFiles: (questionId: string, files: File[]) => void;
  onRemoveImage: (id: string) => void;
  capture: CaptureOffer | null;
  errors: Record<string, string>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {page.elements.map((el) => {
        if (!isKnown(el)) {
          return (
            <p key={el.id} className="text-sm">
              {el.label ?? "A new question"} <span className="text-ink-soft">{C.unknown}</span>
            </p>
          );
        }
        if (el.type === "title") return <h2 key={el.id} className="font-black text-xl tracking-tight">{el.text}</h2>;
        if (el.type === "subtitle") return <h3 key={el.id} className="font-bold text-base">{el.text}</h3>;
        if (el.type === "body_text") return <p key={el.id} className="text-sm text-ink-soft">{el.text}</p>;

        const label = (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-sm">{el.label}</span>
            {el.helperText && <span className="text-xs text-ink-soft">{el.helperText}</span>}
          </div>
        );
        const error = errors[el.id];
        const errorLine = error ? <span className="text-xs font-semibold text-berry">{error}</span> : null;

        if (el.type === "choice") {
          const picked = state[el.id];
          const chosen = Array.isArray(picked) ? picked : picked ? [picked] : [];
          return (
            <div key={el.id} className="flex flex-col gap-2">
              {label}
              {el.optionKind === "emoji" ? (
                <EmojiChoice
                  options={el.options}
                  value={chosen[0]}
                  onPick={(id) => onChange(el.id, el.selection === "multi" ? toggle(chosen, id) : id)}
                />
              ) : (
                <div role={el.selection === "single" ? "radiogroup" : "group"} className="flex flex-col gap-1.5">
                  {el.options.map((o) => {
                    const on = chosen.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role={el.selection === "single" ? "radio" : "checkbox"}
                        aria-checked={on}
                        onClick={() => onChange(el.id, el.selection === "multi" ? toggle(chosen, o.id) : o.id)}
                        className={`text-left rounded-xl border-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                          on ? "border-tangerine bg-honey-soft font-semibold" : "border-line hover:border-honey"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {errorLine}
            </div>
          );
        }

        if (el.type === "text") {
          const value = typeof state[el.id] === "string" ? (state[el.id] as string) : "";
          // The counter appears only near the ceiling: a character count under
          // every field reads as a limit to respect rather than a field to fill.
          const near = value.length >= el.maxLength * 0.9;
          return (
            <div key={el.id} className="flex flex-col gap-1.5">
              {label}
              {el.multiline ? (
                <textarea
                  rows={5}
                  className={`${field} resize-y`}
                  maxLength={el.maxLength}
                  placeholder={el.placeholder}
                  value={value}
                  onChange={(e) => onChange(el.id, e.target.value)}
                />
              ) : (
                <input
                  className={field}
                  maxLength={el.maxLength}
                  placeholder={el.placeholder}
                  value={value}
                  // Inlet refuses a newline in a single-line question, so a
                  // pasted one is stripped rather than sent to be rejected.
                  onChange={(e) => onChange(el.id, e.target.value.replace(/[\r\n]+/g, " "))}
                />
              )}
              <div className="flex justify-between gap-2">
                {errorLine ?? <span />}
                {near && <span className="text-xs text-ink-soft">{value.length} / {el.maxLength}</span>}
              </div>
            </div>
          );
        }

        if (el.type === "email") {
          const value = typeof state[el.id] === "string" ? (state[el.id] as string) : "";
          return (
            <div key={el.id} className="flex flex-col gap-1.5">
              {label}
              <input type="email" className={field} placeholder={el.placeholder} value={value} onChange={(e) => onChange(el.id, e.target.value)} />
              {errorLine}
            </div>
          );
        }

        // screenshot
        const mine = images.filter((i) => i.questionId === el.id);
        const room = mine.length + (capture?.included ? 1 : 0) < el.maxCount;
        return (
          <div key={el.id} className="flex flex-col gap-3">
            {label}
            {capture && (
              <label className="flex items-center gap-3 rounded-xl border-2 border-line p-2 cursor-pointer hover:border-honey">
                <input type="checkbox" checked={capture.included} onChange={(e) => capture.onToggle(e.target.checked)} className="size-4" />
                <span className="text-sm font-semibold flex-1">{C.captureLabel}</span>
                {/* The EXACT image that will be sent — agreed to after seeing it. */}
                <img src={capture.thumbnail} alt="" className="h-14 rounded border-2 border-line" />
              </label>
            )}
            {mine.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mine.map((i) => (
                  <div key={i.id} className="relative">
                    <img src={i.thumb} alt={i.name} className="h-16 rounded-lg border-2 border-line" />
                    <button
                      type="button"
                      onClick={() => onRemoveImage(i.id)}
                      aria-label={`Remove ${i.name}`}
                      className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-ink text-paper text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {room && (
              <div className="text-sm text-ink-soft">
                {C.paste}{" "}
                <label className="underline cursor-pointer font-semibold text-ink">
                  {C.choose}
                  <input
                    type="file"
                    hidden
                    multiple
                    accept={el.acceptedMediaTypes.join(",")}
                    onChange={(e) => {
                      onAddFiles(el.id, [...(e.target.files ?? [])]);
                      e.target.value = ""; // so the same file can be chosen twice
                    }}
                  />
                </label>{" "}
                <span className="text-xs">{acceptSentence(el)}</span>
              </div>
            )}
            {errorLine}
            <p className="text-xs text-ink-soft">{C.captureWarning}</p>
          </div>
        );
      })}
    </div>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Re-exported so the dialog can ask "is this element a question" without a second import. */
export { isQuestion };
