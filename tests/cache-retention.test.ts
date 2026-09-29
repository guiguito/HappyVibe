import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

/**
 * PI_CACHE_RETENTION is pi-ai's only knob for extended prompt caching (each
 * api/*.js module's resolveCacheRetention; the set is pinned below) — so this
 * pins the exact env var name against a pin bump, not just our own plumbing.
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

// ── docs round #18: who honours it, pinned against pi-ai itself ─────────────
const PI_AI = path.resolve(
  __dirname,
  "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist",
);
const HAVE_RUNTIME = fs.existsSync(path.join(PI_AI, "api"));
/** The pi-ai api modules that read PI_CACHE_RETENTION. A bump that adds or drops one fails here — re-check the Models copy. */
const READERS = [
  "anthropic-messages.js",
  "bedrock-converse-stream.js",
  "openai-completions.js",
  "openai-responses.js",
  "pi-messages.js",
];
/** Providers the Models copy names as ignoring it: catalog id → the word on screen. */
const IGNORES: Record<string, string> = { google: "Google", mistral: "Mistral", "openai-codex": "OpenAI Codex", xai: "xAI" };

describe.skipIf(!HAVE_RUNTIME)("PI_CACHE_RETENTION, as pi-ai reads it", () => {
  test("exactly these api modules read the env var", () => {
    const dir = path.join(PI_AI, "api");
    const readers = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(dir, f), "utf8").includes("PI_CACHE_RETENTION"))
      .sort();
    expect(readers).toEqual(READERS);
  });

  test("every provider the Models copy says ignores it really does", async () => {
    type M = { api: string; compat?: { supportsLongCacheRetention?: boolean } };
    const { MODELS } = (await import(pathToFileURL(path.join(PI_AI, "models.generated.js")).href)) as {
      MODELS: Record<string, Record<string, M>>;
    };
    const readerApis = new Set(READERS.map((f) => f.replace(/\.js$/, "")));
    for (const id of Object.keys(IGNORES)) {
      const models = Object.values(MODELS[id] ?? {});
      expect(models.length, `${id} is still in pi-ai's registry`).toBeGreaterThan(0);
      for (const m of models) {
        const honours = readerApis.has(m.api) && m.compat?.supportsLongCacheRetention !== false;
        expect(honours, `${id} (${m.api}) now gets long retention — the Models copy says it ignores it`).toBe(false);
      }
    }
  });
});

test("the Models copy names who ignores it, and no longer says everyone else does", () => {
  const src = fs
    .readFileSync(path.join(__dirname, "../src/renderer/src/components/ModelsView.tsx"), "utf8")
    .replace(/\s+/g, " ");
  expect(src).not.toContain("Other providers ignore it");
  for (const label of Object.values(IGNORES)) expect(src, label).toContain(label);
  expect(src).toContain("Most other providers get the same request; Google, Mistral, OpenAI Codex, xAI and a few others ignore it.");
});
