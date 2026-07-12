/**
 * HappyVibe ask_user tool (V2.B) — PURE module, zero imports (hv-rules pattern).
 *
 * Validation/clamping of the model's input and (de)serialization of the
 * user's answers. The bridge registers the tool and rides the payload over
 * ctx.ui.input (blocking, NO timeout — permission invariant); this module is
 * imported by the bridge, src/main-side tests and vitest — logic never forks.
 *
 * DEGRADE, NEVER THROW: the model's input is clamped (headers >12 chars
 * truncated, >4 questions/options dropped, previews stripped off multi-select
 * questions) and every adjustment is collected as a note that rides back on
 * the tool result — the model learns without the call failing.
 */

export interface AskOption {
  label: string;
  description: string;
  /** Monospace markdown block, single-select questions only. */
  preview?: string;
}

export interface AskQuestion {
  question: string;
  /** ≤12-char chip. */
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

/** Per-question answer payload the renderer sends back (and the model reads). */
export interface AskAnswer {
  question: string;
  header: string;
  /** Chosen option labels and/or the free-text "Other" entry. */
  answers: string[];
  note?: string;
}

export const HEADER_MAX = 12;
export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;

export const DISMISSED_RESULT =
  "User dismissed the question — proceed with your best judgment.";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Clamp the model's `questions` input to spec. Returns the sanitized
 * questions plus human-readable notes for every adjustment made.
 */
export function normalizeQuestions(raw: unknown): { questions: AskQuestion[]; notes: string[] } {
  const notes: string[] = [];
  if (!Array.isArray(raw)) return { questions: [], notes: ["`questions` must be an array"] };

  let list = raw;
  if (list.length > MAX_QUESTIONS) {
    notes.push(`only the first ${MAX_QUESTIONS} of ${list.length} questions were shown`);
    list = list.slice(0, MAX_QUESTIONS);
  }

  const questions: AskQuestion[] = [];
  for (const [i, q] of list.entries()) {
    const question = str((q as AskQuestion)?.question).trim();
    if (!question) {
      notes.push(`question ${i + 1} had no text and was dropped`);
      continue;
    }
    let header = str((q as AskQuestion)?.header).trim() || `Q${i + 1}`;
    if (header.length > HEADER_MAX) {
      notes.push(`header "${header}" truncated to ${HEADER_MAX} chars`);
      header = header.slice(0, HEADER_MAX);
    }
    const multiSelect = (q as AskQuestion)?.multiSelect === true;

    let rawOpts = Array.isArray((q as AskQuestion)?.options) ? (q as AskQuestion).options : [];
    if (rawOpts.length > MAX_OPTIONS) {
      notes.push(`question "${header}": only the first ${MAX_OPTIONS} options were shown`);
      rawOpts = rawOpts.slice(0, MAX_OPTIONS);
    }
    const options: AskOption[] = [];
    for (const o of rawOpts) {
      const label = str((o as AskOption)?.label).trim();
      if (!label) continue; // unusable option — skip silently, Other still exists
      const opt: AskOption = { label, description: str((o as AskOption)?.description).trim() };
      const preview = str((o as AskOption)?.preview);
      if (preview) {
        if (multiSelect) notes.push(`question "${header}": previews are single-select only, dropped`);
        else opt.preview = preview;
      }
      options.push(opt);
    }
    if (options.length < 2) notes.push(`question "${header}" has fewer than 2 options`);
    questions.push({ question, header, multiSelect, options });
  }
  return { questions, notes };
}

/**
 * Parse the renderer's input-response value into answers. Accepts a bare
 * array or `{answers: [...]}`. Returns null when the payload isn't ours.
 */
export function parseAnswers(value: string): AskAnswer[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { answers?: unknown })?.answers)
      ? (parsed as { answers: unknown[] }).answers
      : null;
  if (!arr) return null;
  const out: AskAnswer[] = [];
  for (const a of arr) {
    const answers = Array.isArray((a as AskAnswer)?.answers)
      ? (a as AskAnswer).answers.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    const note = str((a as AskAnswer)?.note).trim();
    out.push({
      question: str((a as AskAnswer)?.question),
      header: str((a as AskAnswer)?.header),
      answers,
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/** Readable markdown tool result the model consumes naturally. */
export function answersMarkdown(answers: AskAnswer[]): string {
  const lines = ["The user answered:"];
  for (const a of answers) {
    const head = a.header || a.question || "Question";
    const picked = a.answers.length ? a.answers.join(", ") : "(no selection)";
    lines.push(`- **${head}** — ${a.question}: ${picked}${a.note ? ` _(note: ${a.note})_` : ""}`);
  }
  return lines.join("\n");
}
