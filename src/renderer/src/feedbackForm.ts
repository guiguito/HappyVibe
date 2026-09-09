/**
 * §34 — the form logic, pure, so the renderer suite (which has no DOM) can hold
 * it to Inlet's contract.
 *
 * The app renders whatever Inlet publishes: a question, an option or the emoji
 * scale can change with no HappyVibe release. That is the property the whole
 * feature rests on, and it is why nothing here is written against the CURRENT
 * five pages — every function walks the definition it is handed.
 */

/** questionId → text/email value | chosen optionId | chosen optionIds. */
export type FormState = Record<string, string | string[] | undefined>;

/** The element types this build knows how to render. Anything else is named, not guessed. */
export const KNOWN_TYPES = ["title", "subtitle", "body_text", "choice", "text", "email", "screenshot"] as const;

const QUESTION_TYPES = ["choice", "text", "email", "screenshot"] as const;

/** A type PREDICATE, not a boolean: it is what makes `el.type === "choice"` narrow. */
export function isKnown(el: HvFormElement): el is HvKnownElement {
  return (KNOWN_TYPES as readonly string[]).includes(el.type);
}

export function isQuestion(el: HvFormElement): boolean {
  return (QUESTION_TYPES as readonly string[]).includes(el.type);
}

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const arr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : []);

/**
 * Inlet refuses a newline in a single-line question and a value over the
 * question's own limit. Refusing them here first turns a round trip into a
 * sentence under the field.
 */
export function textError(el: Extract<HvFormElement, { type: "text" }>, value: string): string | null {
  if (!el.multiline && /[\r\n]/.test(value)) return "This answer has to stay on one line.";
  if (value.length > el.maxLength) return `${value.length} characters — the limit is ${el.maxLength}.`;
  return null;
}

/** Validated only when non-empty: the question is optional, a blank is an answer withheld. */
export function emailError(value: string): string | null {
  if (!value.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : "That does not look like an email address.";
}

/**
 * May the user leave this page?
 *
 * Required questions must be answered, and any answer that IS present must be
 * valid — an optional email typed wrong would otherwise fail at Send, four
 * pages later, which is where a form loses people.
 */
export function pageComplete(page: HvFormPage, state: FormState, imageCount: (questionId: string) => number): boolean {
  for (const el of page.elements) {
    // An unknown REQUIRED question cannot be satisfied by this build; an unknown
    // optional one is simply not asked.
    if (!isKnown(el)) {
      if (el.required === true) return false;
      continue;
    }
    if (!isQuestion(el)) continue;
    const v = state[el.id];
    if (el.type === "choice") {
      const picked = el.selection === "multi" ? arr(v).length > 0 : str(v).length > 0;
      if (el.required && !picked) return false;
    } else if (el.type === "text") {
      const value = str(v);
      if (el.required && !value.trim()) return false;
      if (value && textError(el, value)) return false;
    } else if (el.type === "email") {
      const value = str(v);
      if (el.required && !value.trim()) return false;
      if (emailError(value)) return false;
    } else if (el.type === "screenshot") {
      if (el.required && imageCount(el.id) === 0) return false;
    }
  }
  return true;
}

/** Unknown element types that would make a submission impossible. Send says so instead of failing. */
export function unknownRequired(form: HvFormDefinition): HvFormElement[] {
  return form.pages.flatMap((p) => p.elements.filter((el) => !isKnown(el) && el.required === true));
}

/**
 * Inlet's five answer shapes, keyed by stable question id.
 *
 * Screenshot questions are deliberately ABSENT: their attachment ids do not
 * exist until the upload returns, so main fills them in (`sendSubmission`).
 * A blank is OMITTED rather than sent as "" — an empty value never satisfies a
 * required question anyway, and omitting is what Inlet documents.
 */
export function answersFor(form: HvFormDefinition, state: FormState): HvAnswers {
  const out: HvAnswers = {};
  for (const page of form.pages) {
    for (const el of page.elements) {
      if (!isKnown(el) || !isQuestion(el) || el.type === "screenshot") continue;
      const v = state[el.id];
      if (el.type === "choice") {
        if (el.selection === "multi") {
          const ids = arr(v);
          if (ids.length) out[el.id] = { optionIds: ids };
        } else {
          const id = str(v);
          if (id) out[el.id] = { optionId: id };
        }
      } else {
        const value = str(v).trim();
        if (value) out[el.id] = { value };
      }
    }
  }
  return out;
}

/** Which page holds a question — how a 400 jumps to the field it names. */
export function pageIndexOf(form: HvFormDefinition, questionId: string): number {
  return form.pages.findIndex((p) => p.elements.some((e) => e.id === questionId));
}

/**
 * Can this form be rendered as the ONE inline pulse row?
 *
 * Exactly one page holding exactly one single-select emoji question. Anything
 * richer is a form, and the pulse degrades to an invitation that opens the
 * dialog rather than guessing at a layout it was not designed for.
 */
export function pulseShape(
  form: HvFormDefinition,
): { questionId: string; options: Array<{ id: string; label: string; emoji: string }> } | null {
  if (form.pages.length !== 1) return null;
  const questions = form.pages[0].elements.filter(isQuestion);
  if (questions.length !== 1) return null;
  const q = questions[0];
  if (!isKnown(q) || q.type !== "choice" || q.optionKind !== "emoji" || q.selection !== "single") return null;
  if (!q.options.every((o) => o.emoji)) return null;
  return { questionId: q.id, options: q.options.map((o) => ({ id: o.id, label: o.label, emoji: o.emoji as string })) };
}
