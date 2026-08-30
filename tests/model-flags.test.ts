import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * §16 finding 7 — CLOSED (2026-08-29, providers round).
 *
 * The finding: a spawn with no resolvable model fell back to a hardcoded
 * `deepseek/deepseek-v4-flash`, so a user whose only provider was a removed
 * custom endpoint landed on a provider they never configured — and, once the
 * catalog widened to 29 providers, there are simply more ways to end up
 * holding a removed one.
 *
 * The 2026-07-30 attempt was "omit the flags and let Pi pick its own default",
 * A/B'd against agents-bridge and INCONCLUSIVE (2-of-3 runs failed in BOTH
 * arms on a loaded machine). This fix does not re-run that experiment, because
 * it does not depend on the answer: **a chat session with no model is refused
 * before anything spawns**, so the flagless path is never how a real turn runs.
 * Flags are omitted only where no model is needed at all — the utility client,
 * which exists to drive /hv-login before any provider is configured.
 */

const argPair = (args: string[], flag: string): string => args[args.indexOf(flag) + 1]!;

test("a resolved model reaches the spawn args", () => {
  const spec = resolvePiSpawn("/ws", "/sess", "/rt", {
    model: { provider: "openrouter", modelId: "deepseek/deepseek-chat" },
  });
  expect(argPair(spec.args, "--provider")).toBe("openrouter");
  expect(argPair(spec.args, "--model")).toBe("deepseek/deepseek-chat");
});

test("no resolvable model omits the flags — never a provider the user never chose", () => {
  for (const opts of [{}, { model: null }, { model: undefined }]) {
    const spec = resolvePiSpawn("/ws", "/sess", "/rt", opts);
    expect(spec.args).not.toContain("--provider");
    expect(spec.args).not.toContain("--model");
    expect(spec.args.join(" ")).not.toContain("deepseek");
  }
});

test("no model-resolving path defaults to a model ref of its own", () => {
  // The fallback existed in THREE places — the spawn path and both one-shot
  // callers (titles, AGENTS.md) — and fixing only the one named in the finding
  // would have left a session title generated against a provider the user never
  // configured. The absence is the fix, so it is asserted as such.
  //
  // Matched on the CODE shape (`?? { provider: … }`) rather than on the old
  // model name, so it catches a fallback to any model — and so that the
  // comments explaining this history do not trip their own test.
  for (const f of ["src/main/pi/spawn.ts", "src/main/titles.ts", "src/main/agentsMd.ts"]) {
    const src = readFileSync(f, "utf8");
    expect(src, `${f} still defaults a model ref`).not.toMatch(/\?\?\s*\{\s*provider:/);
    expect(src, `${f} still names a model in code`).not.toMatch(/modelId:\s*"[^"]/);
  }
});
