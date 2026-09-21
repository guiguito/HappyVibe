import { describe, expect, it } from "vitest";
import { defaultRedaction } from "inlet-sdk/crash";
import type { CrashEnvelope } from "inlet-sdk/crash";
import { TAG_ALLOW, scrubEnvelope } from "../src/main/crash/policy";

const env = (over: Partial<CrashEnvelope> = {}): CrashEnvelope => ({
  eventId: "e1",
  timestamp: "2026-09-21T00:00:00.000Z",
  sdk: { name: "inlet-sdk", version: "0.1.2" },
  kind: "exception",
  release: { version: "0.1.0" },
  ...over,
});

describe("§37 scrubEnvelope — the one content rule the app holds", () => {
  it("drops `context` unconditionally, on every kind", () => {
    for (const kind of ["exception", "child-exit", "renderer-gone", "unclean-exit", "message"]) {
      const out = scrubEnvelope(env({ kind, context: { workspace: "/Users/alice/secret" } }));
      expect(out, kind).not.toBeNull();
      expect(out, kind).not.toHaveProperty("context");
    }
  });

  it("filters tags to the allowlist and keeps nothing else", () => {
    const out = scrubEnvelope(env({ tags: { runtime: "Pi 0.86.1", channel: "dev", workspace: "/Users/alice" } }));
    expect(Object.keys(out!.tags!).sort()).toEqual([...TAG_ALLOW].sort());
    expect(JSON.stringify(out)).not.toContain("/Users/");
  });

  it("a tag whose value is not a string is dropped rather than coerced", () => {
    const out = scrubEnvelope(env({ tags: { runtime: 7 as unknown as string, channel: "dev" } }));
    expect(out!.tags).toEqual({ channel: "dev" });
  });

  it("nulls a deliberate exit — a normal window close is not a crash", () => {
    // The SDK reports `renderer-gone` for every window close and
    // `child-process-gone` for the voice host's own kill(). Both are correct at
    // its level and neither is ours. If this stops being true, every user files
    // a crash report every time they close a window.
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "clean-exit" } }))).toBeNull();
    expect(scrubEnvelope(env({ kind: "child-exit", exit: { reason: "killed", name: "voice" } }))).toBeNull();
  });

  it("keeps a real one", () => {
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "crashed" } }))).not.toBeNull();
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "oom" } }))).not.toBeNull();
    // `clean-exit` on a kind that is not an exit kind must NOT swallow the report.
    expect(scrubEnvelope(env({ kind: "exception", exit: { reason: "clean-exit" } }))).not.toBeNull();
  });
});

describe("§37 upstream redaction — a PIN, because we deleted our own wrapper", () => {
  // We pass NO `redaction` option, so `defaultRedaction` IS the app's privacy
  // policy for a message. inlet-sdk 0.1.0 leaked the leading token, which
  // shipped an email address and an absolute path verbatim. A bump that
  // reintroduces that fails here rather than in production.
  it("keeps a known-safe shape verbatim", () => {
    expect(defaultRedaction("x.foo is not a function")).toBe("x.foo is not a function");
  });

  it("keeps an errno-shaped leading token and redacts the rest", () => {
    expect(defaultRedaction("ENOENT: no such file, open '/Users/alice/secret'")).toBe("ENOENT: <redacted>");
    expect(defaultRedaction("ERR_MODULE_NOT_FOUND cannot find /Users/me/x.js")).toBe("ERR_MODULE_NOT_FOUND <redacted>");
  });

  it("redacts an address or a path with NO leading token — the 0.1.0 leak", () => {
    expect(defaultRedaction("alice@corp.com is not a valid address")).toBe("<redacted>");
    expect(defaultRedaction("/Users/alice/secret.docx could not be opened")).toBe("<redacted>");
    expect(defaultRedaction("Request failed with token sk-abc123 for /Users/me")).toBe("<redacted>");
  });
});
