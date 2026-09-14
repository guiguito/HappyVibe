import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportSessionHtml } from "../src/main/sessionExport";
import { sessionFilePath } from "../src/main/store";

/**
 * §17 round 24 — the export runs Pi's own CLI against a session FILE.
 *
 * Key-free and model-free on purpose: `--export` reads the JSONL and writes
 * HTML, so this is a real end-to-end check of the route that still belongs in
 * the non-live suite. If Pi ever moves or renames the flag, this goes red here
 * rather than in front of a user.
 *
 * Why the FILE route and not the RPC one: Pi 0.85.0 ships both, and
 * `export_html` over RPC needs a live client — it would cover open sessions
 * only and would have to wake a hibernated one first.
 */
const RUNTIME = path.join(process.cwd(), "pi-runtime");
let dir = "";

/**
 * CAPTURED from a real Pi session, never hand-written — and the first attempt
 * proved why. A plausible-looking fixture (session line + two message lines)
 * exported to a perfectly valid, perfectly EMPTY page: Pi's entries are a
 * linked list threaded on `parentId`, with the first entry's parent `null`, and
 * the exporter walks that chain back from the leaf. A fixture with no chain has
 * no leaf, so nothing renders and exit code 0 says everything is fine.
 *
 * `tests/fixtures/pi-session.jsonl` is a real 5-line session (the `cwd` is the
 * only thing rewritten): a model_change, a thinking_level_change, one user
 * message and one assistant message that carries a `thinking` block — so the
 * assertions below cover the reasoning path too.
 */
function writeSession(file: string): void {
  writeFileSync(file, readFileSync(path.join(process.cwd(), "tests/fixtures/pi-session.jsonl"), "utf8"), "utf8");
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hv-export-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("exportSessionHtml", () => {
  test("writes a self-contained page at the path it is given", async () => {
    const src = path.join(dir, "session.jsonl");
    const out = path.join(dir, "out.html");
    writeSession(src);

    const r = await exportSessionHtml(RUNTIME, src, out);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe(out);
    expect(existsSync(out)).toBe(true);

    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    // Self-contained: the styling and the highlighter are inlined, not linked
    // out — the file has to open on a machine with no network and no Pi.
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);

    /**
     * The transcript is NOT plain HTML in the page — it is the whole session
     * JSON, base64'd into a `#session-data` script tag, which the page's own
     * JS decodes and renders. Grepping the HTML for a message therefore finds
     * nothing whether the export worked or not, and this test passed that way
     * on a fixture with no conversation in it at all. Decode the blob.
     */
    const blob = /id="session-data"[^>]*>([A-Za-z0-9+/=\s]+)</.exec(html)?.[1];
    expect(blob).toBeTruthy();
    const data = JSON.parse(Buffer.from(blob!.replace(/\s/g, ""), "base64").toString("utf8"));
    expect(data.entries.length).toBe(4);
    expect(data.leafId).toBe("2d67f68b");
    expect(JSON.stringify(data.entries)).toContain("Reply with exactly one word: ok");
    // The assistant's reasoning travels too — the export is a full record.
    expect(JSON.stringify(data.entries)).toContain("thinking");
  }, 60_000);

  test("a missing session file fails with a message, never a throw", async () => {
    const r = await exportSessionHtml(RUNTIME, path.join(dir, "nope.jsonl"), path.join(dir, "nope.html"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("the path the handler exports is confined", () => {
  /**
   * Built with `path.resolve`, never written as a literal: `sessionFilePath`
   * resolves both sides, and on Windows a bare "/tmp/sessions/a.jsonl" comes
   * back as "D:\tmp\sessions\a.jsonl" — which is the function working, not
   * failing. The first cut hard-coded the POSIX spelling and was the one red
   * test on CI's Windows job (PRD §4's round: portable first, skip last).
   */
  const dir = path.resolve(tmpdir(), "hv-sessions");
  const evil = path.resolve(tmpdir(), "hv-sessions-evil");

  test("a session file inside the app's session dir resolves", () => {
    const inside = path.join(dir, "a.jsonl");
    expect(sessionFilePath(dir, inside)).toBe(inside);
  });

  /**
   * piSessionFile is Pi-REPORTED, so it is untrusted input on every route that
   * touches it — delete, the cost read, and now the export.
   */
  test("an escape resolves to null rather than exporting someone's home directory", () => {
    expect(sessionFilePath(dir, path.resolve(tmpdir(), "elsewhere.jsonl"))).toBe(null);
    // The sibling that merely shares the prefix — a bare startsWith lets it through.
    expect(sessionFilePath(dir, path.join(evil, "a.jsonl"))).toBe(null);
    // The directory itself is not a file inside it.
    expect(sessionFilePath(dir, dir)).toBe(null);
    expect(sessionFilePath(dir, undefined)).toBe(null);
  });
});
