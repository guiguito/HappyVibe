import { afterEach, expect, test } from "vitest";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { promptCommand } from "../src/main/pi/commands";
import { applyQueueUpdate, emptyQueue, takeCleared } from "../src/renderer/src/queue";

test("promptCommand carries streamingBehavior only when given", () => {
  expect(promptCommand("hi")).toEqual({ type: "prompt", message: "hi" });
  expect(promptCommand("hi", "steer")).toEqual({ type: "prompt", message: "hi", streamingBehavior: "steer" });
  expect(promptCommand("hi", "followUp")).toEqual({ type: "prompt", message: "hi", streamingBehavior: "followUp" });
});

const fakeSpec = {
  execPath: process.execPath,
  args: [path.join(__dirname, "fixtures/fake-pi.mjs")],
  env: { ...process.env } as Record<string, string>,
  cwd: process.cwd(),
};
let client: PiClient;
afterEach(() => client?.stop());

test("streamingBehavior passes through PiClient and queue_update flows back with the wire shape", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const queueEvt = new Promise<Record<string, unknown>>((r) =>
    client.on("event", (e) => e.type === "queue_update" && r(e))
  );
  const res = await client.send(promptCommand("focus on tests", "steer"));
  expect(res.success).toBe(true);
  expect(res.data).toEqual({ streamingBehavior: "steer" });
  const q = await queueEvt;
  // Wire shape per docs/rpc.md: string arrays keyed steering / followUp.
  expect(q.steering).toEqual(["focus on tests"]);
  expect(q.followUp).toEqual([]);
});

test("applyQueueUpdate mirrors chips and reports delivered messages", () => {
  const e1 = { type: "queue_update", steering: ["a", "b"], followUp: ["c"] };
  const { queue: q1, delivered: d1 } = applyQueueUpdate(emptyQueue, e1);
  expect(q1).toEqual({ steering: ["a", "b"], followUp: ["c"] });
  expect(d1).toEqual([]);

  // "a" leaves the steering queue → it was delivered to the agent.
  const e2 = { type: "queue_update", steering: ["b"], followUp: ["c"] };
  const { queue: q2, delivered: d2 } = applyQueueUpdate(q1, e2);
  expect(q2.steering).toEqual(["b"]);
  expect(d2).toEqual(["a"]);

  // Malformed/missing arrays degrade to empty (everything pending counts delivered).
  const { queue: q3, delivered: d3 } = applyQueueUpdate(q2, { type: "queue_update" });
  expect(q3).toEqual(emptyQueue);
  expect(d3).toEqual(["b", "c"]);
});

// Round 27: Pi announces clear_queue with an ordinary queue_update, so a text that left the
// queue was either DELIVERED (transcript) or CLEARED (back to the box). The clear_queue answer
// names exactly what it cleared; the event and the answer can arrive in either order.
test("takeCleared: what Pi cleared is consumed, the rest was delivered", () => {
  expect(takeCleared(["a", "b"], ["b"])).toEqual({ delivered: ["a"], owed: [] });
});
test("takeCleared: the same text queued twice is a multiset, not a set", () => {
  expect(takeCleared(["a", "a"], ["a"])).toEqual({ delivered: ["a"], owed: [] });
});
test("takeCleared: an answer that arrives BEFORE its event leaves the texts owed", () => {
  expect(takeCleared([], ["a", "b"])).toEqual({ delivered: [], owed: ["a", "b"] });
  expect(takeCleared(["a", "b"], ["a", "b"])).toEqual({ delivered: [], owed: [] });
});
