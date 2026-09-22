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



  it("passes every exit through — reason filtering is upstream's since 0.1.3", () => {
    // This function used to drop `clean-exit` (both kinds) and `killed` (child
    // only). inlet-sdk 0.1.3 adopted exactly that as its default, so carrying a
    // second copy could only drift from it. `crash-sdk-contract.test.ts` drives
    // upstream's real handlers and asserts the behaviour instead.
    for (const reason of ["clean-exit", "killed", "crashed", "oom"]) {
      expect(scrubEnvelope(env({ kind: "renderer-gone", exit: { reason } })), reason).not.toBeNull();
      expect(scrubEnvelope(env({ kind: "child-exit", exit: { reason, name: "pi" } })), reason).not.toBeNull();
    }
  });
});
