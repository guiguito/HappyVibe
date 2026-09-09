import { describe, expect, it } from "vitest";
import { createInletClient, sendSubmission, type Upload } from "../src/main/feedback/inlet";

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(route: Route): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return route(url, init);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const cfg = { baseUrl: "https://inlet.test", publishableKey: "ipk_test" };
const png: Upload = { questionId: "el_shot", name: "a.png", type: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };

describe("createInletClient", () => {
  it("readForm sends the bearer key and returns the definition", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { feedbackDatabaseId: "fdb_1", formVersionId: "fv_1", formVersion: 2, publishedAt: "x", pages: [] }),
    );
    const form = await createInletClient(cfg, fetch).readForm("fdb_1");
    expect(form.formVersion).toBe(2);
    expect(calls[0].url).toBe("https://inlet.test/v1/feedback-databases/fdb_1/form");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer ipk_test");
  });

  it("409 form_not_published → InletError not_published", async () => {
    const { fetch } = fakeFetch(() => json(409, { error: { code: "form_not_published", message: "…" } }));
    await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind: "not_published", status: 409 });
  });

  it("401 → unauthorized; 429 → rate_limited; 500 → server", async () => {
    for (const [status, code, kind] of [
      [401, "unauthorized", "unauthorized"],
      [429, "rate_limit_exceeded", "rate_limited"],
      [500, "internal", "server"],
    ] as const) {
      const { fetch } = fakeFetch(() => json(status, { error: { code, message: "…" } }));
      await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind });
    }
  });

  it("a thrown fetch (offline) → network", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind: "network" });
  });

  it("a non-JSON error body still maps by status rather than throwing", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>502</html>", { status: 502 }));
    await expect(createInletClient(cfg, fetch).readForm("fdb_1")).rejects.toMatchObject({ kind: "server", status: 502 });
  });

  it("upload is multipart with questionId + file and the intent token header", async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { attachmentId: "att_1", bytes: 10 }));
    const r = await createInletClient(cfg, fetch).upload("fdb_1", { intentId: "int_1", token: "tok" }, png);
    expect(r.attachmentId).toBe("att_1");
    expect(calls[0].url).toBe("https://inlet.test/v1/feedback-databases/fdb_1/submission-intents/int_1/attachments");
    expect(new Headers(calls[0].init.headers).get("x-inlet-intent-token")).toBe("tok");
    const fd = calls[0].init.body as FormData;
    expect(fd.get("questionId")).toBe("el_shot");
    expect((fd.get("file") as File).type).toBe("image/png");
  });
});

describe("sendSubmission", () => {
  const happy =
    (overrides: Partial<Record<"intent" | "upload" | "submit", Route>> = {}): Route =>
    (url, init) => {
      if (url.endsWith("/submission-intents"))
        return (overrides.intent ?? (() => json(201, { intentId: "int_1", token: "tok", formVersion: 2, expiresAt: "x" })))(url, init);
      if (url.endsWith("/attachments")) return (overrides.upload ?? (() => json(201, { attachmentId: "att_9", bytes: 4 })))(url, init);
      if (url.endsWith("/submit"))
        return (overrides.submit ?? (() => json(201, { submissionId: "sub_1", status: "accepted", formVersion: 2, createdAt: "x" })))(url, init);
      throw new Error("unexpected " + url);
    };
  const req = { formVersion: 2, answers: { el_text: { value: "hi" } }, uploads: [png], clientContext: { appVersion: "0.1.0" } };

  it("intent → upload → submit, and the attachment id lands under the screenshot question", async () => {
    const { fetch, calls } = fakeFetch(happy());
    const r = await sendSubmission(createInletClient(cfg, fetch), "fdb_1", req);
    expect(r).toEqual({ submissionId: "sub_1", status: "accepted", attachments: 1, bytes: 4, formVersion: 2 });
    const body = JSON.parse(String(calls[2].init.body));
    expect(body.answers.el_shot).toEqual({ attachmentIds: ["att_9"] });
    expect(body.formVersion).toBe(2);
    expect(body.clientContext).toEqual({ appVersion: "0.1.0" });
  });

  it("200 duplicate is success", async () => {
    const { fetch } = fakeFetch(happy({ submit: () => json(200, { submissionId: "sub_1", status: "duplicate", formVersion: 2, createdAt: "x" }) }));
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).resolves.toMatchObject({ status: "duplicate" });
  });

  it("410 intent_expired → a NEW intent, re-upload, resubmit, once", async () => {
    let submits = 0;
    const { fetch, calls } = fakeFetch(
      happy({
        submit: () =>
          ++submits === 1
            ? json(410, { error: { code: "intent_expired", message: "…" } })
            : json(201, { submissionId: "sub_2", status: "accepted", formVersion: 2, createdAt: "x" }),
      }),
    );
    const r = await sendSubmission(createInletClient(cfg, fetch), "fdb_1", req);
    expect(r.submissionId).toBe("sub_2");
    expect(calls.filter((c) => c.url.endsWith("/submission-intents")).length).toBe(2);
    expect(calls.filter((c) => c.url.endsWith("/attachments")).length).toBe(2);
  });

  it("a second 410 is surfaced, not looped", async () => {
    const { fetch } = fakeFetch(happy({ submit: () => json(410, { error: { code: "intent_expired", message: "…" } }) }));
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).rejects.toMatchObject({ kind: "expired" });
  });

  it("400 validation_failed carries the per-question details", async () => {
    const { fetch } = fakeFetch(
      happy({
        submit: () => json(400, { error: { code: "validation_failed", message: "…", details: [{ questionId: "el_text", message: "too long" }] } }),
      }),
    );
    await expect(sendSubmission(createInletClient(cfg, fetch), "fdb_1", req)).rejects.toMatchObject({
      kind: "validation",
      details: [{ questionId: "el_text", message: "too long" }],
    });
  });

  it("with no uploads, no attachments call is made and no screenshot key is added", async () => {
    const { fetch, calls } = fakeFetch(happy());
    await sendSubmission(createInletClient(cfg, fetch), "fdb_1", { ...req, uploads: [] });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["submission-intents", "submit"]);
    expect(JSON.parse(String(calls[1].init.body)).answers).toEqual({ el_text: { value: "hi" } });
  });

  it("two images on one question become one attachmentIds array, in order", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(happy({ upload: () => json(201, { attachmentId: `att_${++n}`, bytes: 4 }) }));
    const r = await sendSubmission(createInletClient(cfg, fetch), "fdb_1", { ...req, uploads: [png, { ...png, name: "b.png" }] });
    expect(JSON.parse(String(calls[3].init.body)).answers.el_shot).toEqual({ attachmentIds: ["att_1", "att_2"] });
    expect(r.attachments).toBe(2);
    expect(r.bytes).toBe(8);
  });
});
