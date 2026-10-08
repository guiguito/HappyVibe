import { expect, test } from "vitest";
import fs from "node:fs";
import { forkScopes, stampPiTs } from "../src/renderer/src/fork";

const u = (text: string, extra = {}) => ({ kind: "user" as const, text, id: Math.random(), ...extra });

test("stampPiTs: the matching unstamped bubble gets Pi's timestamp; synthetic ones never do", () => {
  const items = [u("a", { piTs: 1 }), u("answers", { synthetic: true }), u("b"), u("c")] as never[];
  const out = stampPiTs(items, 42, "c") as Array<{ piTs?: number }>;
  expect(out[3].piTs).toBe(42);
  expect(out[2].piTs).toBeUndefined();
  // No text match (a prompt template expands): oldest unstamped real bubble.
  expect((stampPiTs(items, 7, "expanded body") as Array<{ piTs?: number }>)[2].piTs).toBe(7);
  expect((stampPiTs(items, 7, "x") as Array<{ piTs?: number }>)[1].piTs).toBeUndefined();
});

test("forkScopes: never 'files'; 'both' only when there is something to restore", () => {
  expect(forkScopes(null)).toEqual(["conversation"]);
  expect(forkScopes(undefined)).toEqual(["conversation"]);
  expect(forkScopes({ willRestore: ["a"], willDelete: [], stale: [] })).toEqual(["conversation", "both"]);
});

test("Fork shows only on a Pi-confirmed bubble inside context", () => {
  const t = fs.readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  expect(t).toMatch(/onFork && it\.piTs != null && <ForkButton/);
  const restore = fs.readFileSync("src/renderer/src/restoreMap.ts", "utf8");
  expect(restore).toContain("piTs");
});
