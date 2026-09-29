import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeProviderError } from "../src/main/providerError";
import { docUrl, docsIndexUrl, ERROR_GUIDE_LABEL } from "../src/renderer/src/docsLinks";
import { ONBOARDING_COPY } from "../src/renderer/src/onboarding";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const headings = (slug: string): string[] =>
  [...read("docs", "guide", "src", "content", "docs", `${slug}.md`).matchAll(/^#{2,4} (.+)$/gm)].map((m) => kebab(m[1]));

describe("guide URLs (Docs in the app, 2026-09-29)", () => {
  it("a slug alone keeps the per-screen shape", () => {
    expect(docUrl("mcp")).toBe("https://happyvibe.dev/docs/mcp/?embed=1");
  });
  it("an anchor goes AFTER the query, or the browser reads it as part of the path", () => {
    expect(docUrl("models", "add-a-custom-endpoint")).toBe("https://happyvibe.dev/docs/models/?embed=1#add-a-custom-endpoint");
  });
  it("the front page has no slug and no double slash", () => {
    expect(docsIndexUrl).toBe("https://happyvibe.dev/docs/?embed=1");
    expect(docsIndexUrl.replace("https://", "")).not.toContain("//");
  });
  it("the error-card label is one string", () => {
    expect(ERROR_GUIDE_LABEL).toBe("Read the guide ↗");
  });
});

const ENDPOINT = { slug: "models", anchor: "add-a-custom-endpoint" };
const DOCS: Array<[string, string, { slug: string; anchor: string } | undefined]> = [
  ["401 Unauthorized", "auth", { slug: "connect-a-model", anchor: "if-the-provider-rejects-the-key" }],
  ["404 model not found", "model_not_found", ENDPOINT],
  ["maximum context length exceeded", "context_overflow", ENDPOINT],
  ["insufficient_quota", "balance", undefined],
  ["429 Too Many Requests", "rate_limit", undefined],
  ["529 status code (no body)", "overloaded", undefined],
  ["503 Service Unavailable", "server", undefined],
  ["fetch failed", "network", undefined],
  ["something odd happened", "other", undefined],
  ["", "other", undefined],
];

describe("provider errors link to the guide only where a page fixes them", () => {
  test.each(DOCS)("%j is %s", (raw, kind, doc) => {
    const d = describeProviderError(raw);
    expect(d.kind).toBe(kind);
    expect(d.doc).toEqual(doc);
  });
  it("every linked page and anchor exists in the guide", () => {
    for (const [, , doc] of DOCS) if (doc) expect(headings(doc.slug), `${doc.slug}#${doc.anchor}`).toContain(doc.anchor);
  });
  it("providerError.ts stays import-free — the renderer imports it", () => {
    expect(read("src", "main", "providerError.ts")).not.toMatch(/^import /m);
  });
  it("§39: usage statistics read the kind and never the doc", () => {
    expect(read("src", "main", "usage", "turns.ts")).not.toMatch(/\.doc\b/);
  });
  it("the card links only when the item carries a doc, through the shared label", () => {
    const t = read("src", "renderer", "src", "components", "Transcript.tsx");
    expect(t).toMatch(/it\.doc && onOpenDoc/);
    expect(t).toContain("ERROR_GUIDE_LABEL");
  });
  it("App hands the error's doc to the card and the card's opener is openDocs", () => {
    const app = read("src", "renderer", "src", "App.tsx");
    expect(app).toMatch(/doc: info\.doc/);
    expect(app).toMatch(/onOpenDoc=\{openDocs\}/);
  });
});

describe("the setup dialog links to the setup guide", () => {
  const dialog = read("src", "renderer", "src", "components", "OnboardingDialog.tsx");
  const app = read("src", "renderer", "src", "App.tsx");
  it("the copy is one string", () => expect(ONBOARDING_COPY.guideLink).toBe("Read the setup guide ↗"));
  it("the dialog renders it in the brand column, and not on the celebration screen", () => {
    expect(dialog).toMatch(/!complete && !welcome && \(\s*<button[^>]*onClick=\{onOpenGuide\}/);
    expect(dialog).toContain("C.guideLink");
  });
  it("it always opens the SYSTEM browser — a pane opened behind a modal is invisible", () => {
    const at = app.indexOf("onOpenGuide=");
    expect(at).toBeGreaterThan(-1);
    const call = app.slice(at, at + 200);
    expect(call).toContain('window.hv.openExternal(docUrl("first-launch"))');
    expect(call).not.toContain("openDocs");
  });
});
