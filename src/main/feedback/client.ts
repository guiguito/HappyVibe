import path from "node:path";
import {
  FeedbackClient,
  FileStore,
  type AnswerInput,
  type FeedbackError,
  type PublishedForm,
  type SubmitOutcome,
} from "inlet-sdk/feedback/node";

/**
 * §34 — the only code that talks to Inlet, now through `inlet-sdk/feedback`.
 *
 * It lives in MAIN because the renderer CSP is `default-src 'self'` with no
 * `connect-src` (index.html), and §27's voice download set the rule: sidestep
 * the CSP from main, never weaken it. The SDK's own Electron adapter does not
 * fit: it serves ONE database on a fixed IPC channel, and we collect into two.
 *
 * What the SDK carries that the hand-written client did not: a disk queue (a
 * submission lost to the network is replayed on the next start, never dropped),
 * duplicate-safe replay through the intent, and the server's own validation
 * rules bundled in. Import-free of `electron` so vitest can load it — the
 * `crash/client.ts` rule.
 */

export type FeedbackKind =
  | "not_published"
  | "validation"
  | "expired"
  | "rate_limited"
  | "conflict"
  | "network"
  | "server"
  | "unauthorized";

export type FormDefinition = PublishedForm;
export type Answers = Record<string, AnswerInput>;

export interface Upload {
  questionId: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export type SendReply =
  | {
      ok: true;
      /** Null while `pending`: the server has not answered yet, so there is no id. */
      submissionId: string | null;
      status: "accepted" | "duplicate" | "pending";
      attachments: number;
      bytes: number;
      formVersion: number;
    }
  | { ok: false; kind: FeedbackKind; message: string; details?: Array<{ questionId?: string; message: string }> };

export interface FeedbackClients {
  general: FeedbackClient;
  session: FeedbackClient;
}

/** One client per database, each with its own disk queue under `queueRoot`. */
export function createFeedbackClients(
  cfg: { baseUrl: string; publishableKey: string; databases: { general: string; session: string } },
  queueRoot: string,
  fetchImpl?: typeof fetch,
): FeedbackClients {
  const make = (name: "general" | "session"): FeedbackClient =>
    new FeedbackClient({
      baseUrl: cfg.baseUrl,
      publishableKey: cfg.publishableKey,
      feedbackDatabaseId: cfg.databases[name],
      store: new FileStore(path.join(queueRoot, name)),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  return { general: make("general"), session: make("session") };
}

/** Server codes plus the SDK's own local ones, onto the kinds the dialog tells apart. */
const CODE_TO_KIND: Record<string, FeedbackKind> = {
  form_not_published: "not_published",
  validation_failed: "validation",
  missing_required_answer: "validation",
  unknown_question: "validation",
  too_many_attachments: "validation",
  unsupported_image_format: "validation",
  file_too_large: "validation",
  client_context_too_large: "validation",
  intent_expired: "expired",
  submission_deleted: "expired",
  form_version_unknown: "expired",
  rate_limit_exceeded: "rate_limited",
  intent_payload_conflict: "conflict",
  submission_already_pending: "conflict",
  unauthorized: "unauthorized",
  feedback_database_inaccessible: "unauthorized",
  network_unavailable: "network",
};

export function failure(e: FeedbackError): Extract<SendReply, { ok: false }> {
  return { ok: false, kind: CODE_TO_KIND[e.code] ?? "server", message: e.message, details: e.details };
}

export function fromOutcome(
  o: SubmitOutcome,
  facts: { attachments: number; bytes: number; formVersion: number },
): SendReply {
  switch (o.status) {
    case "accepted":
    case "duplicate":
      return { ok: true, submissionId: o.submissionId, status: o.status, ...facts };
    case "pending":
      // Queued on disk and replayed until the server answers — the user's words
      // are safe, so this is a success the dialog words differently.
      return { ok: true, submissionId: null, status: "pending", ...facts };
    case "invalid":
      return { ok: false, kind: "validation", message: "The server refused an answer.", details: o.details };
    case "failed":
      return failure(o.error);
  }
}

/**
 * One respondent's answers, sent as a session pinned to the version the user saw.
 * Screenshots upload under the session's intent; the SDK fills their attachment
 * ids into the answers and renews an expired intent by itself.
 */
export async function sendFeedback(
  client: FeedbackClient,
  req: { formVersion: number; answers: Answers; uploads: Upload[]; clientContext: Record<string, unknown> },
): Promise<SendReply> {
  const s = await client.createSession({ formVersion: req.formVersion, clientContext: req.clientContext });
  if (!s.ok) return failure(s.error);
  const session = s.value;
  for (const [questionId, answer] of Object.entries(req.answers)) session.setAnswer(questionId, answer);
  let bytes = 0;
  for (const u of req.uploads) {
    const r = await session.addScreenshot(u.questionId, { data: u.bytes, mediaType: u.type, filename: u.name });
    if (!r.ok) {
      session.abandon();
      return failure(r.error);
    }
    bytes += r.value.bytes;
  }
  return fromOutcome(await session.submit(), { attachments: req.uploads.length, bytes, formVersion: req.formVersion });
}
