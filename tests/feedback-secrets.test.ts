import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §34 — the app carries a PUBLISHABLE Inlet key and nothing else.
 *
 * `ipk_` can read a form, open an intent, upload and submit; it cannot read a
 * single response. `isk_` carries project Admin authority — read and export
 * every submission, delete data. It lives in `.env` for the MCP reading side
 * and the live test's cleanup, and must never be reachable from `src/`.
 *
 * A scan rather than a review, because the failure mode is a paste.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("feedback secrets never reach src/", () => {
  const files = walk("src");

  it("no isk_ server key literal anywhere under src/", () => {
    const hits = files.filter((f) => /\bisk_[A-Za-z0-9_-]{8,}/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("nothing under src/ reads FEEDBACK_API_KEY (either channel)", () => {
    const hits = files.filter((f) => /FEEDBACK_API_KEY/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the committed publishable keys are ipk_ keys", () => {
    const src = fs.readFileSync("src/main/feedback/config.ts", "utf8");
    const keys = [...src.matchAll(/"(i[ps]k_[A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith("ipk_")).toBe(true);
  });
});
