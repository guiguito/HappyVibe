/**
 * §34 — the only code that talks to Inlet.
 *
 * It lives in MAIN because the renderer CSP is `default-src 'self'` with no
 * `connect-src` (index.html), and §27's voice download set the rule: sidestep
 * the CSP from main, never weaken it.
 *
 * `fetch` is INJECTED so the whole error table is unit-tested against a fake
 * without a server — the six response rows the dialog has to distinguish are
 * exactly the ones that are painful to reproduce live.
 *
 * API: https://github.com/guiguito/inlet/blob/main/docs/API.md
 * Element union mirrors packages/shared/src/form.ts (client shape: a screenshot
 * question carries acceptedMediaTypes and maxFileBytes, injected by the server,
 * so the app never hard-codes an upload limit).
 */

export type InletErrorKind =
  | "not_published"
  | "validation"
  | "expired"
  | "rate_limited"
  | "conflict"
  | "network"
  | "server"
  | "unauthorized";

export class InletError extends Error {
  constructor(
    public kind: InletErrorKind,
    message: string,
    public status?: number,
    public details?: Array<{ questionId?: string; message: string }>,
  ) {
    super(message);
    this.name = "InletError";
  }
}

export type KnownElement =
  | { id: string; type: "title" | "subtitle" | "body_text"; text: string }
  | {
      id: string;
      type: "choice";
      label: string;
      helperText?: string;
      required: boolean;
      optionKind: "text" | "emoji";
      selection: "single" | "multi";
      orientation: "vertical" | "horizontal";
      options: Array<{ id: string; label: string; emoji?: string }>;
    }
  | { id: string; type: "text"; label: string; helperText?: string; required: boolean; multiline: boolean; maxLength: number; placeholder?: string }
  | { id: string; type: "email"; label: string; helperText?: string; required: boolean; placeholder?: string }
  | {
      id: string;
      type: "screenshot";
      label: string;
      helperText?: string;
      required: boolean;
      maxCount: number;
      acceptedMediaTypes: string[];
      maxFileBytes: number;
    };

/**
 * Forward-compatible: a type this build does not know.
 *
 * A SEPARATE type rather than a branch, because a branch with `type: string`
 * overlaps every literal and stops the union discriminating at all — the
 * renderer's mirror splits it the same way for the same reason.
 */
export interface UnknownElement {
  id: string;
  type: string;
  label?: string;
  required?: boolean;
}

export type FormElement = KnownElement | UnknownElement;

export interface FormPage {
  id: string;
  elements: FormElement[];
}

export interface FormDefinition {
  feedbackDatabaseId: string;
  formVersionId: string;
  formVersion: number;
  publishedAt: string;
  pages: FormPage[];
}

export type Answers = Record<
  string,
  { optionId: string } | { optionIds: string[] } | { value: string } | { attachmentIds: string[] }
>;

export interface Upload {
  questionId: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface SendResult {
  submissionId: string;
  status: "accepted" | "duplicate";
  attachments: number;
  bytes: number;
  formVersion: number;
}

export interface Intent {
  intentId: string;
  token: string;
  formVersion: number;
}

export interface InletClient {
  readForm(db: string): Promise<FormDefinition>;
  openIntent(db: string, formVersion: number): Promise<Intent>;
  upload(db: string, intent: { intentId: string; token: string }, u: Upload): Promise<{ attachmentId: string; bytes: number }>;
  submit(
    db: string,
    intent: { intentId: string; token: string },
    body: { formVersion: number; answers: Answers; clientContext: Record<string, unknown> },
  ): Promise<{ submissionId: string; status: "accepted" | "duplicate" }>;
}

const CODE_TO_KIND: Record<string, InletErrorKind> = {
  form_not_published: "not_published",
  validation_failed: "validation",
  intent_expired: "expired",
  submission_deleted: "expired",
  rate_limit_exceeded: "rate_limited",
  intent_payload_conflict: "conflict",
  unauthorized: "unauthorized",
  feedback_database_inaccessible: "unauthorized",
};

async function toError(res: Response): Promise<InletError> {
  let body: { error?: { code?: string; message?: string; details?: Array<{ questionId?: string; message: string }> } } = {};
  // A proxy or a gateway can answer HTML; the status still classifies it.
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-JSON body — fall through to the status mapping */
  }
  const code = body.error?.code ?? "";
  const kind: InletErrorKind =
    CODE_TO_KIND[code] ??
    (res.status === 401 || res.status === 403
      ? "unauthorized"
      : res.status === 429
        ? "rate_limited"
        : res.status === 400
          ? "validation"
          : "server");
  return new InletError(kind, body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.details);
}

export function createInletClient(
  cfg: { baseUrl: string; publishableKey: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): InletClient {
  const base = cfg.baseUrl.replace(/\/+$/, "");

  const call = async (path: string, init: RequestInit & { intentToken?: string } = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${cfg.publishableKey}`);
    if (init.intentToken) headers.set("x-inlet-intent-token", init.intentToken);
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // Offline, DNS, TLS, or the 20 s timeout. One kind: nothing was sent.
      throw new InletError("network", e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) throw await toError(res);
    return res;
  };

  const jsonBody = (o: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(o),
    headers: { "content-type": "application/json" },
  });

  return {
    readForm: async (db) => (await call(`/v1/feedback-databases/${db}/form`)).json() as Promise<FormDefinition>,
    openIntent: async (db, formVersion) =>
      (await call(`/v1/feedback-databases/${db}/submission-intents`, jsonBody({ formVersion }))).json() as Promise<Intent>,
    upload: async (db, intent, u) => {
      const fd = new FormData();
      fd.set("questionId", u.questionId);
      fd.set("file", new File([u.bytes as BlobPart], u.name, { type: u.type }));
      return (await call(`/v1/feedback-databases/${db}/submission-intents/${intent.intentId}/attachments`, {
        method: "POST",
        body: fd,
        intentToken: intent.token,
      })).json() as Promise<{ attachmentId: string; bytes: number }>;
    },
    submit: async (db, intent, body) =>
      (await call(`/v1/feedback-databases/${db}/submission-intents/${intent.intentId}/submit`, {
        ...jsonBody(body),
        intentToken: intent.token,
      })).json() as Promise<{ submissionId: string; status: "accepted" | "duplicate" }>,
  };
}

/**
 * intent → uploads → submit, with ONE transparent retry on an expired intent.
 *
 * The intent TTL is 30 minutes and the dialog is a thing the user can leave
 * open, so expiry is an ordinary outcome rather than an error worth showing.
 * Exactly one retry: a second expiry means something else is wrong, and a loop
 * would upload the same images forever.
 *
 * Attachment ids are filled into `answers` here rather than by the caller —
 * the caller does not know them until the upload returns.
 */
export async function sendSubmission(
  client: InletClient,
  db: string,
  req: { formVersion: number; answers: Answers; uploads: Upload[]; clientContext: Record<string, unknown> },
): Promise<SendResult> {
  const attempt = async (): Promise<SendResult> => {
    const intent = await client.openIntent(db, req.formVersion);
    const answers: Answers = { ...req.answers };
    let bytes = 0;
    const byQuestion = new Map<string, string[]>();
    for (const u of req.uploads) {
      const r = await client.upload(db, intent, u);
      bytes += r.bytes ?? u.bytes.byteLength;
      byQuestion.set(u.questionId, [...(byQuestion.get(u.questionId) ?? []), r.attachmentId]);
    }
    for (const [q, ids] of byQuestion) answers[q] = { attachmentIds: ids };
    const r = await client.submit(db, intent, { formVersion: req.formVersion, answers, clientContext: req.clientContext });
    return { submissionId: r.submissionId, status: r.status, attachments: req.uploads.length, bytes, formVersion: req.formVersion };
  };

  try {
    return await attempt();
  } catch (e) {
    if (e instanceof InletError && e.kind === "expired") return attempt();
    throw e;
  }
}
