import { expect, test } from "vitest";
import fs from "node:fs";
import { forkMeta } from "../src/main/sessionFork";
import type { SessionMeta } from "../src/main/store";

const orig: SessionMeta = {
  id: "o1", title: "Fix login", workspaceId: "/w", createdAt: "x", updatedAt: "x", archived: false,
  titleSource: "model", model: { provider: "p", modelId: "m" }, thinking: "high", scheduleId: "sch1", hibernated: true,
};

test("a fork carries model, thinking and title source — never the schedule", () => {
  const m = forkMeta(orig, "fork", "2026-10-09T10:00:00.000Z");
  expect(m).toEqual({
    title: "Fix login (fork)", titleSource: "model", model: { provider: "p", modelId: "m" }, thinking: "high",
    forkedFrom: { sessionId: "o1", at: "2026-10-09T10:00:00.000Z" },
  });
  expect(m).not.toHaveProperty("scheduleId");
  expect(forkMeta(orig, "duplicate", "t").title).toBe("Fix login (copy)");
});

test("duplicate refuses mid-turn in MAIN too, and the fork reads the file before any spawn", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const dup = ipc.slice(ipc.indexOf('"hv:session-duplicate"'), ipc.indexOf('"hv:session-duplicate"') + 400);
  expect(dup).toContain("activity.isBusy(sessionId)");
  const fork = ipc.slice(ipc.indexOf('"hv:session-fork"'), ipc.indexOf('"hv:session-fork"') + 500);
  expect(fork).toContain("userEntryAt(");
});
