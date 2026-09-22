import { describe, expect, it } from "vitest";
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

  it("nulls a normal window close — the SDK reports one for every single close", () => {
    // Without this, each user files a crash report every time they close a
    // window. It is the highest-volume noise source in the whole feature.
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "clean-exit" } }))).toBeNull();
    expect(scrubEnvelope(env({ kind: "child-exit", exit: { reason: "clean-exit" } }))).toBeNull();
  });

  it("nulls a killed CHILD but keeps a killed RENDERER — the two rules differ", () => {
    // Found by the GUI pass: the first version used one set for both kinds and
    // silently swallowed every renderer death, so the server received nothing.
    // A child killed is the voice host's own kill(), which we asked for. A
    // renderer is never killed on purpose by this app, so `killed` there is the
    // OS doing it — an OOM kill — which is precisely the crash worth hearing.
    expect(scrubEnvelope(env({ kind: "child-exit", exit: { reason: "killed", name: "voice" } }))).toBeNull();
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "killed" } }))).not.toBeNull();
  });

  it("keeps a real one", () => {
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "crashed" } }))).not.toBeNull();
    expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason: "oom" } }))).not.toBeNull();
    expect(scrubEnvelope(env({ kind: "child-exit", exit: { reason: "crashed", name: "pi" } }))).not.toBeNull();
    // `clean-exit` on a kind that is not an exit kind must NOT swallow the report.
    expect(scrubEnvelope(env({ kind: "exception", exit: { reason: "clean-exit" } }))).not.toBeNull();
  });
});
