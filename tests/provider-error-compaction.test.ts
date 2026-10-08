import { expect, test } from "vitest";
import { describeProviderError } from "../src/main/providerError";
import { readFileSync } from "node:fs";

const RAW = "400 This model's maximum context length is 131072 tokens";

test("overflow with auto-compaction OFF says so and offers Compact", () => {
  const i = describeProviderError(RAW, { autoCompaction: false });
  expect(i.kind).toBe("context_overflow");
  expect(i.hint).toBe("Automatic compaction is off. Compact now, or fork from an earlier message (hover it, then Fork).");
  expect(i.action).toBe("compact");
  expect(i.doc).toEqual({ slug: "first-session", anchor: "context-what-the-agent-can-see" });
});

test("overflow with it ON keeps today's custom-endpoint hint and no action", () => {
  const i = describeProviderError(RAW, { autoCompaction: true });
  expect(i.hint).toMatch(/custom endpoint/);
  expect(i.action).toBeUndefined();
});

test("the off-confirm copy is pinned and the guide anchor exists", async () => {
  const src = readFileSync("src/renderer/src/components/ModelsView.tsx", "utf8");
  expect(src).toContain("Turn off automatic compaction?");
  expect(src).toContain("When the context fills up, the next message fails instead of being summarized.");
  const guide = readFileSync("docs/guide/src/content/docs/first-session.md", "utf8");
  expect(guide).toMatch(/^## Context: what the agent can see$/m);
});
