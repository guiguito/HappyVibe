/**
 * hv.ask-user wire parsing (V2.B) — mirrors permission.ts/auth.ts. The bridge's
 * ask_user tool rides ctx.ui.input with the JSON payload in `title`. Routing is
 * KIND-based: hv.auth prompts also use method "input" and must keep going to
 * the auth flow, never here.
 */
import type { UiRequest } from "./permission";

export interface AskOption {
  label: string;
  description: string;
  /** Monospace markdown block — single-select questions only (bridge-enforced). */
  preview?: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

export interface AskUserInfo {
  intent: string;
  questions: AskQuestion[];
}

/** Per-question answer sent back as the input-response value (JSON array). */
export interface AskAnswer {
  question: string;
  header: string;
  answers: string[];
  note?: string;
}

export function parseAskUser(r: UiRequest): AskUserInfo | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "");
    if (p?.kind === "hv.ask-user" && Array.isArray(p.questions)) {
      return { intent: String(p.intent ?? ""), questions: p.questions as AskQuestion[] };
    }
  } catch {
    /* not JSON → not ours */
  }
  return null;
}

/** User-style transcript echo: "Answered: Auth → OAuth; Library → X (note: …)". */
export function answersSummary(answers: AskAnswer[]): string {
  return (
    "Answered: " +
    answers
      .map((a) => `${a.header || a.question} → ${a.answers.length ? a.answers.join(", ") : "(no selection)"}${a.note ? ` (note: ${a.note})` : ""}`)
      .join("; ")
  );
}
