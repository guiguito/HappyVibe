import { expect, test } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

/**
 * PI_CACHE_RETENTION is pi-ai's only knob for extended prompt caching
 * (providers/anthropic.js resolveCacheRetention, providers/openai-completions.js
 * buildParams) — so this pins the exact env var name against a pin bump, not
 * just our own plumbing.
 */
test("longCache → PI_CACHE_RETENTION=long", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { longCache: true });
  expect(spec.env.PI_CACHE_RETENTION).toBe("long");
});

test("off by default — we add nothing, so the 5min TTL stands", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime);
  // Compared against the ambient value, not undefined: env is passed through
  // wholesale, so a shell that already exported it is honoured, not clobbered.
  expect(spec.env.PI_CACHE_RETENTION).toBe(process.env.PI_CACHE_RETENTION);
});
