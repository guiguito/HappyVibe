import { getFeedbackFormCache, setFeedbackFormCache } from "../config";
import type { FormDefinition } from "./inlet";

/**
 * §34 — the last definition Inlet served, per database.
 *
 * The forms are read at RUNTIME so a question can change with no release; the
 * cost is that an offline open would otherwise show nothing at all. Cached after
 * every successful read, used only when the network fails — never preferred over
 * a live definition, because a stale version id would be pinned to an intent
 * the server has moved past.
 *
 * Shape-checked on read: config.json is hand-editable, and a half-written cache
 * would reach the renderer as a form with no pages.
 */
export function readCachedForm(db: string): FormDefinition | null {
  const f = getFeedbackFormCache()[db] as FormDefinition | undefined;
  return f && Array.isArray(f.pages) && typeof f.formVersion === "number" ? f : null;
}

export function writeCachedForm(db: string, form: FormDefinition): void {
  setFeedbackFormCache(db, form);
}
