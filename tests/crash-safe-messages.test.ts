import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { defaultRedaction } from "inlet-sdk/crash";
import { collectSafeMessages } from "../scripts/catalog-crash-messages.mjs";
import { SAFE_MESSAGES } from "../src/main/crash/safeMessages.generated";
import { redactMessage } from "../src/main/crash/policy";

/**
 * §37 — the allowlist that lets a crash report SAY something, and the four
 * properties that make it safe to send.
 *
 * Re-DERIVED from source, the `tests/provider-catalog.test.ts` pattern: this
 * file does not agree with the committed data, it recomputes it. A new
 * `throw new Error("…")` therefore either joins the list or fails the gate,
 * rather than silently arriving as `<redacted>` forever.
 */
describe("§37 the generated safe-message set", () => {
  const derived = collectSafeMessages();

  it("the committed file matches what the source actually throws", () => {
    expect([...SAFE_MESSAGES].sort()).toEqual(derived.messages);
    expect(SAFE_MESSAGES.size, "non-vacuity: the app throws literals").toBeGreaterThan(20);
  });

  it("every entry is a literal our own source contains verbatim", () => {
    // The invariant the whole design rests on: what is in the set is exactly
    // what travels, because a plain string literal cannot interpolate.
    const src = ["src/main", "src/renderer/src"]
      .flatMap(function walk(d: string): string[] {
        return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
        );
      })
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".generated.ts"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    for (const m of SAFE_MESSAGES) {
      // Compare against BOTH the runtime string and its source spelling: the
      // generator un-escapes, so `"Name must match /^[\\w-]+$/"` in the file is
      // `/^[\w-]+$/` at runtime and a raw includes() would miss it.
      const escaped = JSON.stringify(m).slice(1, -1);
      const found = src.includes(m) || src.includes(escaped);
      expect(found, `not found in source: ${m}`).toBe(true);
    }
  });

  it("no entry looks like a path, a key, an address or a URL", () => {
    for (const m of SAFE_MESSAGES) {
      expect(m, m).not.toMatch(/\/Users\/|\/home\/|[A-Za-z]:\\/);
      expect(m, m).not.toMatch(/\b(?:sk|ipk|isk|pk)_[A-Za-z0-9_-]{6,}/);
      expect(m, m).not.toMatch(/@[\w.-]+\.\w{2,}/);
      expect(m, m).not.toMatch(/https?:\/\//);
    }
  });

  it("no entry carries an interpolation marker — the generator must refuse those", () => {
    // If one ever appears, the generator has started accepting template
    // literals and the whole safety argument is void.
    for (const m of SAFE_MESSAGES) expect(m, m).not.toMatch(/\$\{|`/);
  });

  it("an INTERPOLATED throw is not in the set, and still redacts", () => {
    // Picked from the real interpolated throws in src/: these carry a code, a
    // path or a stderr tail, which is exactly what must never travel.
    const interpolated = "mcp-oauth-bridge exited 1 with no output: Error: /Users/x/y";
    expect(SAFE_MESSAGES.has(interpolated)).toBe(false);
    expect(redactMessage(interpolated)).toBe("<redacted>");
  });
});

describe("§37 redactMessage extends upstream, it does not replace it", () => {
  it("an allowlisted message survives verbatim", () => {
    const m = [...SAFE_MESSAGES][0];
    expect(redactMessage(m)).toBe(m);
    // And it is one the DEFAULT would have thrown away — otherwise this whole
    // pre-filter buys nothing and should be deleted.
    const anyImproved = [...SAFE_MESSAGES].some((s) => defaultRedaction(s) !== s);
    expect(anyImproved, "the set must improve on the default for at least one message").toBe(true);
  });

  it("everything else falls through to upstream, unchanged", () => {
    // Upstream's safe list still applies…
    expect(redactMessage("x.foo is not a function")).toBe("x.foo is not a function");
    // …its errno rule still applies…
    expect(redactMessage("ENOENT: no such file, open '/Users/alice/secret'")).toBe("ENOENT: <redacted>");
    // …and its refusals still refuse.
    expect(redactMessage("alice@corp.com is not a valid address")).toBe("<redacted>");
    expect(redactMessage("/Users/alice/secret.docx could not be opened")).toBe("<redacted>");
    expect(redactMessage("Request failed with token sk-abc123 for /Users/me")).toBe("<redacted>");
  });

  it("the match is EXACT — a near miss does not slip through", () => {
    const m = [...SAFE_MESSAGES].find((s) => defaultRedaction(s) !== s)!;
    // Data appended to a safe message must NOT inherit its safety.
    expect(redactMessage(`${m} /Users/alice/secret`)).toBe("<redacted>");
    expect(redactMessage(`prefix ${m}`)).toBe("<redacted>");
    // Trimming is the only normalisation.
    expect(redactMessage(`  ${m}  `)).toBe(m);
  });
});
