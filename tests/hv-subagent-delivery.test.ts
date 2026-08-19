/**
 * The sub-agent delivery repair (pi-runtime/extensions/hv-subagent-delivery.ts).
 *
 * pi-subagents truncates the completion payload at a hardcoded 1,000 chars, so the
 * model receives invalid JSON, announces the result was truncated, and fetches it
 * from disk — four tool calls for one delegation. We already hold the child's full
 * output at completion, so we put it back before the model sees the message.
 *
 * Fixtures are VERBATIM from a measured run (2026-08-19): the header wording, the
 * `"runId": "65227ea7"` child id, and the fact that the id in the message is the
 * CHILD's rather than the workflow's UUID. Key-free.
 */
import { describe, expect, it } from "vitest";
import { REDACTED_PROMPT } from "../pi-runtime/extensions/hv-rules";
import {
  MAX_INLINE_DELIVERY,
  createChildOutputStore,
  rememberChildOutputs,
  substituteDeliveries,
  substituteDelivery,
} from "../pi-runtime/extensions/hv-subagent-delivery";

/** The real thing, trimmed: header, blank line, then a JSON blob cut mid-string. */
const TRUNCATED =
  'Background task completed: **workflow**\n\nWorkflow completed with 1 child run(s). Return: {\n'
  + '  "key": "main",\n  "ok": true,\n  "agent": "code-explorer",\n  "runId": "65227ea7",\n'
  + '  "output": "## Detailed Report\\n\\nBelow is every section heading and both of its fa'
  + ' Trace: 2 event(s).';

const FULL = "## Detailed Report\n\nSection 1: topic-1\n- fact 1A: the value is 3\n…every section…";

const storeWith = (over: Record<string, unknown> = {}): ReturnType<typeof createChildOutputStore> => {
  const s = createChildOutputStore();
  rememberChildOutputs(s, [{ runId: "65227ea7", agent: "code-explorer", output: FULL, ...over }]);
  return s;
};

describe("remembering what the child said", () => {
  it("keys by the CHILD run id, which is what the message names", () => {
    // Measured: the notify says "runId": "65227ea7" while the workflow's async id is
    // a UUID (a2df09d4-…). Keying by the workflow id would never match.
    const s = storeWith();
    expect(s.has("65227ea7")).toBe(true);
    expect(substituteDelivery(TRUNCATED, s)).toContain(FULL);
  });

  it("prefers `output`, falling back to `summary`", () => {
    const s = createChildOutputStore();
    rememberChildOutputs(s, [{ runId: "a", output: "the answer", summary: "a rendering" }]);
    expect(s.get("a")?.output).toBe("the answer");
    rememberChildOutputs(s, [{ runId: "b", summary: "only a summary" }]);
    expect(s.get("b")?.output).toBe("only a summary");
  });

  it("ignores junk instead of throwing", () => {
    const s = createChildOutputStore();
    for (const bad of [undefined, null, "nope", 7, [], [{}], [{ runId: "x" }], [{ output: "y" }]]) {
      expect(() => rememberChildOutputs(s, bad)).not.toThrow();
    }
    expect(s.size).toBe(0);
  });

  it("never stores the redaction", () => {
    const s = createChildOutputStore();
    rememberChildOutputs(s, [{ runId: "a", output: REDACTED_PROMPT }]);
    expect(s.size).toBe(0);
  });

  it("stays bounded — a delivery follows its completion, so history is not needed", () => {
    const s = createChildOutputStore();
    for (let i = 0; i < 100; i++) rememberChildOutputs(s, [{ runId: `run-${i}`, output: `out ${i}` }]);
    expect(s.size).toBeLessThanOrEqual(32);
    expect(s.has("run-99")).toBe(true);
  });
});

describe("repairing the delivery", () => {
  it("replaces the truncated body and corrects the agent name", () => {
    const out = substituteDelivery(TRUNCATED, storeWith())!;
    // Upstream says **workflow** for every top-level delegation; the child's real
    // name is what the parent should read.
    expect(out.split("\n")[0]).toBe("Background task completed: **code-explorer**");
    expect(out).toContain(FULL);
    // The mangled JSON is gone.
    expect(out).not.toContain('"key": "main"');
    expect(out).not.toContain("Trace: 2 event(s).");
  });

  it("keeps upstream's parseable shape: header, blank line, body", () => {
    // parseSubagentNotifyContent reads line 0 and takes the body from line 2.
    const lines = substituteDelivery(TRUNCATED, storeWith())!.split("\n");
    expect(lines[0]).toMatch(/^Background task completed: \*\*.+\*\*$/);
    expect(lines[1]).toBe("");
    expect(lines.slice(2).join("\n")).toBe(FULL);
  });

  it("preserves a non-completed status rather than claiming success", () => {
    const failed = TRUNCATED.replace("completed:", "failed:");
    expect(substituteDelivery(failed, storeWith())!.split("\n")[0])
      .toBe("Background task failed: **code-explorer**");
  });
});

describe("refusing to touch what it should not", () => {
  it("leaves a message alone when we never saw that child", () => {
    expect(substituteDelivery(TRUNCATED, createChildOutputStore())).toBeNull();
  });

  it("refuses a parallel fan-out naming several children", () => {
    // Otherwise every child's message would be replaced by ONE child's answer.
    const many = TRUNCATED.replace('"runId": "65227ea7"', '"runId": "65227ea7"\n  "runId": "other123"');
    expect(substituteDelivery(many, storeWith())).toBeNull();
  });

  it("falls through untouched when upstream rewords the header", () => {
    // A future format must arrive unmangled rather than half-rewritten by us.
    expect(substituteDelivery(TRUNCATED.replace("Background task completed:", "Task done:"), storeWith())).toBeNull();
    expect(substituteDelivery("", storeWith())).toBeNull();
  });

  it("defers to the artifact when the output is too big to inline", () => {
    const huge = "x".repeat(MAX_INLINE_DELIVERY + 1);
    expect(substituteDelivery(TRUNCATED, storeWith({ output: huge }))).toBeNull();
  });

  it("does nothing when upstream already delivered the whole answer", () => {
    // Short outputs are never truncated, so there is nothing to repair.
    const small = 'Background task completed: **code-explorer**\n\n"runId": "65227ea7" all of it';
    const s = createChildOutputStore();
    rememberChildOutputs(s, [{ runId: "65227ea7", output: "all of it" }]);
    expect(substituteDelivery(small, s)).toBeNull();
  });
});

describe("applying it across a context message list", () => {
  const notify = (content: string): Record<string, unknown> => ({ role: "custom", customType: "subagent-notify", content });

  it("rewrites only the notify, and returns a new array", () => {
    const messages = [
      { role: "user", content: "go" },
      { role: "toolResult", content: 'has "runId": "65227ea7" but is not a notify' },
      notify(TRUNCATED),
    ];
    const out = substituteDeliveries(messages, storeWith())!;
    expect(out).not.toBe(messages);
    expect(out[0]).toBe(messages[0]); // untouched objects are passed through by reference
    expect(out[1]).toBe(messages[1]);
    expect(String((out[2] as { content: string }).content)).toContain(FULL);
    // The original is not mutated.
    expect(String((messages[2] as { content: string }).content)).toBe(TRUNCATED);
  });

  it("returns null when nothing changed, so the context is left untouched", () => {
    expect(substituteDeliveries([notify(TRUNCATED)], createChildOutputStore())).toBeNull();
    expect(substituteDeliveries([{ role: "user", content: "hi" }], storeWith())).toBeNull();
    expect(substituteDeliveries(undefined, storeWith())).toBeNull();
    expect(substituteDeliveries([], storeWith())).toBeNull();
  });
});
