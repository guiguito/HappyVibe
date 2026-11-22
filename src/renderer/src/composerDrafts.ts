/**
 * The unsent message of each session, kept while its composer is not on screen.
 *
 * A ChatView is mounted only for the chat tabs of the ACTIVE workspace (App.tsx
 * `chatSessions`), so switching workspace unmounts every composer of the one you
 * left — and a half-written message lived only in that component's state. A file
 * tab's unsaved buffer was already protected (it stays mounted); this is the
 * composer's equivalent, without keeping whole transcripts mounted to get it.
 *
 * In memory, for the life of this window: the same lifetime a mounted composer
 * had, so a reload or a restart still starts empty. Keyed by session id, so
 * closing a chat tab and opening it again finds the message too; a tab moved to
 * another window takes it along (`carryDraft`/`adoptDraft`). Sending empties the
 * composer, which forgets the draft; deleting the session drops it.
 */
import type { DocumentAttachment, ImageAttachment } from "./composer";

export interface ComposerDraft {
  text: string;
  images: ImageAttachment[];
  documents: DocumentAttachment[];
  /** `@mention` label → workspace-relative path: what `extractMentions` resolves on send. */
  mentions: Array<[string, string]>;
}

const drafts = new Map<string, ComposerDraft>();

/** Nothing worth keeping: no text (whitespace counts as none), no attachment. */
export function isEmptyDraft(d: ComposerDraft): boolean {
  return !d.text.trim() && d.images.length === 0 && d.documents.length === 0;
}

/** A fresh empty draft every time: the composer's state arrays must never be shared. */
export function readDraft(sessionId: string | null): ComposerDraft {
  return (sessionId && drafts.get(sessionId)) || { text: "", images: [], documents: [], mentions: [] };
}

/** An empty draft is forgotten rather than stored, so the map only holds real messages. */
export function saveDraft(sessionId: string | null, d: ComposerDraft): void {
  if (!sessionId) return;
  if (isEmptyDraft(d)) drafts.delete(sessionId);
  else drafts.set(sessionId, d);
}

/** The session is gone (deleted, or moved to another window): so is its draft, pictures included. */
export function dropDraft(sessionId: string | null): void {
  if (!sessionId) return;
  drafts.delete(sessionId);
  appliedInserts.delete(sessionId);
}

/**
 * A chat tab moving to another window: its draft rides the same `draft` string
 * a file tab's buffer does (`moveTab`, `dragBegin`), as JSON. Undefined when
 * there is nothing to carry.
 */
export function carryDraft(sessionId: string | null): string | undefined {
  const d = readDraft(sessionId);
  return isEmptyDraft(d) ? undefined : JSON.stringify(d);
}

/** The receiving window's half of `carryDraft`. Anything malformed is dropped, never thrown. */
export function adoptDraft(sessionId: string | null, carried: string): void {
  try {
    const d = JSON.parse(carried) as Partial<ComposerDraft>;
    saveDraft(sessionId, {
      text: typeof d.text === "string" ? d.text : "",
      images: Array.isArray(d.images) ? d.images : [],
      documents: Array.isArray(d.documents) ? d.documents : [],
      mentions: Array.isArray(d.mentions) ? d.mentions : [],
    });
  } catch {
    /* not a draft — the tab still arrives, with an empty composer */
  }
}

/**
 * The `composerInsert` nonce each session's composer has already applied.
 *
 * App keeps ONE insert (a refused send handed back, Take back, a rewind or a
 * fork) and never clears it, so a composer that mounts again — the workspace
 * switch this module exists for — would apply it a second time on top of the
 * restored draft. Remembering the nonce here makes an insert land exactly once:
 * one that arrived while the composer was away still lands when it comes back.
 */
const appliedInserts = new Map<string, number>();

export function appliedInsert(sessionId: string | null): number {
  return (sessionId && appliedInserts.get(sessionId)) || 0;
}

export function noteInsertApplied(sessionId: string | null, nonce: number): void {
  if (sessionId) appliedInserts.set(sessionId, nonce);
}
