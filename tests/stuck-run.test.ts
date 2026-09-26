/** §12 decision 8 (2026-09-26): stuck = waiting on the model, quiet for 10 min. Never a long tool call. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isStuck, STUCK_MS } from "../src/main/stuckRun";
import { TW_CHILD_DIR, twChildStatus } from "../src/main/twChildren";

describe("isStuck", () => {
  it("waiting on the model for 10 minutes is stuck", () => expect(isStuck(true, STUCK_MS)).toBe(true));
  it("9 minutes is not", () => expect(isStuck(true, STUCK_MS - 1)).toBe(false));
  it("a long tool call never is", () => expect(isStuck(false, 60 * 60_000)).toBe(false));
});

describe("awaitingModel, from the child's own file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-stuck-"));
  fs.mkdirSync(path.join(dir, TW_CHILD_DIR));
  const line = (o: unknown) => JSON.stringify(o) + "\n";
  const head = line({ type: "session", id: "x", parentSession: path.join(dir, "p.jsonl") });
  const asst = (content: unknown[]) => line({ type: "message", message: { role: "assistant", content } });
  const write = (name: string, body: string) => { const f = path.join(dir, TW_CHILD_DIR, name); fs.writeFileSync(f, head + body); return f; };

  it("after a tool result the child is waiting on the model", () => {
    const f = write("a.jsonl", asst([{ type: "toolCall", id: "t1", name: "read" }]) + line({ type: "message", message: { role: "toolResult", toolCallId: "t1", content: [] } }));
    expect(twChildStatus(dir, f)!.awaitingModel).toBe(true);
  });
  it("with a tool call in flight it is NOT (the tool is working)", () => {
    const f = write("b.jsonl", asst([{ type: "toolCall", id: "t1", name: "bash" }]));
    expect(twChildStatus(dir, f)!.awaitingModel).toBe(false);
  });
  it("after its first user message it is waiting on the model", () => {
    const f = write("c.jsonl", line({ type: "message", message: { role: "user", content: [{ type: "text", text: "go" }] } }));
    expect(twChildStatus(dir, f)!.awaitingModel).toBe(true);
  });
});

describe("the card says it, and the rail promotes it", () => {
  it("the stuck copy is exported and used by the run card", async () => {
    const src = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
    expect(src).toMatch(/export const NO_ACTIVITY_COPY = "No activity for 10 min — Stop\?"/);
    expect(src).toMatch(/run\.live\?\.attentionReason === "no-activity" \? NO_ACTIVITY_COPY/);
    // Promotion is by activityState (runRail.ts), which the poller sets — nothing new to wire.
    const { toRunAvatars, promotedKeys } = await import("../src/renderer/src/runRail");
    const avatars = toRunAvatars([{ id: "r1", kind: "async", runId: "r1", agent: "worker", label: "x", startedAt: 0, status: "running", live: { activityState: "needs_attention", attentionReason: "no-activity" } }] as never, []);
    expect(promotedKeys(avatars)).toEqual(["r1"]);
  });
});
