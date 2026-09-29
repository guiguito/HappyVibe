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
