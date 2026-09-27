/**
 * PRD §12 decision 4 (2026-09-26): on the tintinweb path the parent model still receives
 * the child's FULL answer. tintinweb cuts the `<result>` of its `<task-notification>` at
 * `resultMaxLen` and appends a "use get_subagent_result" pointer — which costs the model
 * an extra tool call per delegation. The bridge substitutes the full text, keyed on the
 * notification's own `<task-id>`, escaped exactly as upstream escapes it.
 *
 * The fixture is the notification captured in Phase 0 (d1.md § tintinweb wire shapes),
 * with its result replaced by a truncated one in upstream's own format.
 */
import { describe, expect, it } from "vitest";
import {
  createChildOutputStore, rememberTwResult, substituteDeliveries, substituteTwNotification,
} from "../pi-runtime/extensions/hv-subagent-delivery";

const TRUNC = "\n...(truncated, use get_subagent_result for full output)";
const note = (id: string, result: string) => [
  "<task-notification>",
  `<task-id>${id}</task-id>`,
  "<tool-use-id>call_1462e7eade7740d0beac46f9</tool-use-id>",
  "<status>Done</status>",
  `<summary>Agent "List files in current folder" completed</summary>`,
  `<result>${result}</result>`,
  "<usage><total_tokens>8291</total_tokens><tool_uses>1</tool_uses><context_percent>1</context_percent><duration_ms>3858</duration_ms></usage>",
  "</task-notification>",
].join("\n");

const FULL_A = "A-line ".repeat(200).trim();
const FULL_B = "B-line ".repeat(200).trim();

describe("substituteTwNotification", () => {
  it("repairs a truncated result with the full text for ITS OWN task id", () => {
    const store = createChildOutputStore();
    rememberTwResult(store, "a1", "worker", FULL_A);
    rememberTwResult(store, "b2", "worker", FULL_B);
    const outA = substituteTwNotification(note("a1", FULL_A.slice(0, 500) + TRUNC), store)!;
    const outB = substituteTwNotification(note("b2", FULL_B.slice(0, 500) + TRUNC), store)!;
    expect(outA).toContain(`<result>${FULL_A}</result>`);
    expect(outA).not.toContain("B-line"); // two runs of the same agent, never crossed
    expect(outB).toContain(`<result>${FULL_B}</result>`);
    expect(outA).not.toContain("truncated, use get_subagent_result");
  });

  it("everything outside <result> stays byte-identical", () => {
    const store = createChildOutputStore();
    rememberTwResult(store, "a1", "worker", FULL_A);
    const before = note("a1", "x" + TRUNC);
    const after = substituteTwNotification(before, store)!;
    const strip = (s: string) => s.replace(/<result>[\s\S]*<\/result>/, "<result/>");
    expect(strip(after)).toBe(strip(before));
  });

  it("escapes the full text exactly as upstream does (&, <, >)", () => {
    const store = createChildOutputStore();
    rememberTwResult(store, "a1", "worker", "if (a < b && c > d) </result> ok");
    const out = substituteTwNotification(note("a1", "if (a &lt; b" + TRUNC), store)!;
    expect(out).toContain("<result>if (a &lt; b &amp;&amp; c &gt; d) &lt;/result&gt; ok</result>");
    expect(out.match(/<\/result>/g)).toHaveLength(1);
  });

  it("refuses what it should not touch", () => {
    const store = createChildOutputStore();
    rememberTwResult(store, "a1", "worker", FULL_A);
    // not truncated ⇒ nothing to gain
    expect(substituteTwNotification(note("a1", "short answer"), store)).toBeNull();
    // unknown id
    expect(substituteTwNotification(note("zz", "x" + TRUNC), store)).toBeNull();
    // several notifications in one message (a batch) ⇒ ambiguous
    expect(substituteTwNotification(note("a1", "x" + TRUNC) + "\n" + note("a1", "y" + TRUNC), store)).toBeNull();
    // too large to inline
    rememberTwResult(store, "big", "worker", "z".repeat(40_000));
    expect(substituteTwNotification(note("big", "z" + TRUNC), store)).toBeNull();
    // a workflow's notification (wf_ id, never remembered)
    expect(substituteTwNotification(note("wf_d6470d43bcc1", "x" + TRUNC), store)).toBeNull();
  });
});

describe("substituteDeliveries — the context hook's list", () => {
  it("repairs tintinweb's subagent-notification messages and leaves the rest alone", () => {
    const store = createChildOutputStore();
    rememberTwResult(store, "a1", "worker", FULL_A);
    const msgs = [
      { role: "user", content: "hi" },
      { role: "custom", customType: "subagent-notification", content: note("a1", "x" + TRUNC), display: true },
    ];
    const out = substituteDeliveries(msgs, store)!;
    expect(out[0]).toBe(msgs[0]);
    expect(String(out[1].content)).toContain(FULL_A);
    expect((out[1] as { display?: boolean }).display).toBe(true);
  });
});
