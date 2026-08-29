/**
 * §19 — a silently substituted model becomes visible.
 *
 * pi-subagents 0.57 caches "this model failed" verdicts and skips the model on
 * every later delegation. One flaky child is enough, the default TTL is 24 HOURS,
 * and the store is keyed per-UID so it spans every session and workspace. The only
 * upstream signal is a console.warn that reaches a terminal, not a user — so the
 * chat keeps showing the model the user picked while their sub-agents run on a
 * fallback and are billed at a different rate. Observed on a real install
 * 2026-08-29: openrouter/qwen/qwen3.8-flash excluded for 24h with nothing on screen.
 *
 * Key-free; stays in the non-live suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  EXCLUSIONS_PATH_ENV,
  exclusionKey,
  exclusionModel,
  formatExclusionNotice,
  liveExclusions,
  readExclusions,
} from "../src/main/modelExclusions";

/** The real record shape, captured verbatim from the install where this was found. */
const REAL = {
  modelId: "qwen/qwen3.8-flash",
  provider: "openrouter",
  reason: "Subagent produced no output (possible model cold-start or empty response).",
  recordedAt: 1787999751349,
  expiresAt: 1788086151349,
};
const NOW = REAL.recordedAt;

describe("reading pi-subagents' exclusion store", () => {
  it("names the model the way upstream's own skip message does", () => {
    expect(exclusionModel(REAL)).toBe("openrouter/qwen/qwen3.8-flash");
    expect(exclusionModel({ modelId: "bare-model" })).toBe("bare-model");
    expect(exclusionModel({ provider: "x" })).toBeUndefined();
    expect(exclusionModel(undefined)).toBeUndefined();
  });

  it("keeps only LIVE exclusions — an expired record is history", () => {
    expect(liveExclusions({ exclusions: [REAL] }, NOW)).toHaveLength(1);
    expect(liveExclusions({ exclusions: [REAL] }, REAL.expiresAt + 1)).toHaveLength(0);
    expect(liveExclusions({ exclusions: [{ modelId: "x", provider: "y" }] }, NOW), "no expiry = not live").toHaveLength(0);
    expect(liveExclusions({}, NOW)).toHaveLength(0);
    expect(liveExclusions(null, NOW)).toHaveLength(0);
  });

  it("keys on model AND expiry, so a RE-exclusion is reported again", () => {
    const first = exclusionKey(REAL);
    const later = exclusionKey({ ...REAL, expiresAt: REAL.expiresAt + 60_000 });
    expect(first).toBeDefined();
    expect(later).not.toBe(first);
    // …but the same live one is never reported twice.
    expect(exclusionKey({ ...REAL })).toBe(first);
  });

  it("says what was skipped, why, and for how long", () => {
    const notice = formatExclusionNotice(REAL, NOW)!;
    expect(notice).toContain("openrouter/qwen/qwen3.8-flash");
    expect(notice, "the reason upstream gave").toContain("Subagent produced no output");
    expect(notice, "24h expressed in hours").toMatch(/~24h/);
    expect(notice, "and what happens meanwhile").toContain("fall back");
  });

  it("expresses a short exclusion in minutes — the TTL we configure", () => {
    const notice = formatExclusionNotice({ ...REAL, expiresAt: NOW + 5 * 60_000 }, NOW)!;
    expect(notice).toMatch(/~5 min/);
  });

  it("never trusts the provider's reason text", () => {
    const notice = formatExclusionNotice({ ...REAL, reason: `${"x".repeat(400)}\n\nnewlines` }, NOW)!;
    expect(notice.length).toBeLessThan(400);
    expect(notice).not.toContain("\n");
  });

  it("degrades to nothing on a missing or malformed store, never a throw", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hv-excl-"));
    expect(readExclusions(path.join(dir, "absent.json"), NOW)).toEqual([]);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(readExclusions(bad, NOW)).toEqual([]);
    const locked = path.join(dir, "locked.json");
    writeFileSync(locked, JSON.stringify({ exclusions: [REAL] }));
    chmodSync(locked, 0o000);
    expect(readExclusions(locked, NOW)).toEqual([]);
    chmodSync(locked, 0o600);
  });

  it("reads the real captured file shape end to end", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hv-excl-"));
    const f = path.join(dir, "model-exclusions.json");
    writeFileSync(f, JSON.stringify({ version: 1, exclusions: [REAL] }));
    const live = readExclusions(f, NOW);
    expect(live).toHaveLength(1);
    expect(formatExclusionNotice(live[0], NOW)).toContain("qwen3.8-flash");
  });
});

describe("the wiring that makes it reachable", () => {
  const src = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf8");

  it("hands upstream a path WE own instead of re-deriving its tmp layout", () => {
    // CLAUDE.md's standing rule after the MCP keychain drift: never mirror an
    // upstream storage location. pi-subagents reads PI_MODEL_EXCLUSIONS_PATH, so
    // spawn.ts sets it and main reads the file it chose.
    expect(EXCLUSIONS_PATH_ENV).toBe("PI_MODEL_EXCLUSIONS_PATH");
    expect(src("src", "main", "pi", "spawn.ts")).toContain("PI_MODEL_EXCLUSIONS_PATH");
    expect(src("src", "main", "ipc.ts")).toMatch(/modelExclusionsFile: modelExclusionsPath\(\)/);
  });

  it("upstream still reads that env var — the pin this rests on", () => {
    const store = src("pi-runtime", "node_modules", "pi-subagents", "src", "runs", "shared", "model-exclusions.ts");
    expect(store).toContain('EXCLUSIONS_PATH_ENV = "PI_MODEL_EXCLUSIONS_PATH"');
    expect(store, "and honours it before the default path").toMatch(/envPath[\s\S]{0,120}return envPath\.trim\(\)/);
  });

  it("shortens the 24h default so one blip cannot cost a day", () => {
    // Upstream's DEFAULT_MODEL_EXCLUSION_TTL_MS is 24h. Setting the key explicitly
    // also shortens entries already on disk, so a stale record self-heals.
    expect(src("src", "main", "config.ts")).toMatch(/modelExclusions[\s\S]{0,200}defaultTtlMs: 5 \* 60_000/);
    const store = src("pi-runtime", "node_modules", "pi-subagents", "src", "runs", "shared", "model-exclusions.ts");
    expect(store).toContain("DEFAULT_MODEL_EXCLUSION_TTL_MS = 24 * 60 * 60_000");
  });

  it("reports on a delegation, deduped, and the audit page can read it", () => {
    const ipc = src("src", "main", "ipc.ts");
    expect(ipc, "checked where it starts mattering").toMatch(/reportModelExclusions\(sessionId/);
    expect(ipc, "deduped by key").toContain("reportedExclusions.has(key)");
    expect(ipc, "and the page reads the type").toMatch(/log\.read\(\{ type: "model\.excluded"/);
    expect(src("src", "renderer", "src", "components", "AuditView.tsx")).toContain('e.type === "model.excluded"');
  });

  it("stays out of the Stats numbers — it has no cost and no tokens", () => {
    // §19 ruling 3's shape: never render an unknown price as a number. An
    // exclusion is a FACT for the audit log, not a figure for the dashboard.
    expect(src("src", "main", "analytics.ts"), "named so the switch stays an inventory")
      .toContain('case "model.excluded":');
  });
});
