import { expect, test } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * §16 finding 7 — ATTEMPTED AND REVERTED (2026-07-30).
 *
 * The finding was that a spawn with no resolvable model falls back to a
 * hardcoded `deepseek/deepseek-v4-flash`, so a user whose only provider was a
 * removed custom endpoint lands on a provider they never configured.
 *
 * The attempted fix was to omit --provider/--model and let Pi use its own
 * default, which its CLI does support (`if (parsed.model)` in dist/main.js
 * buildSessionOptions). It was reverted, but NOT because it was disproven: an
 * A/B of 3 isolated runs per arm against tests/agents-bridge.test.ts was
 * INCONCLUSIVE — 2-of-3 runs failed in BOTH arms, because those two tests have
 * 5s timeouts and the machine was loaded (a live app + dev server). Same
 * failure rate with and without the change means no signal either way.
 *
 * So the default stays as the status quo — changing spawn behaviour on an
 * inconclusive experiment is the wrong trade — and this test pins the CURRENT
 * behaviour, not a claim about the alternative. Finding 7 remains open; the
 * better fix is a UI signal when no tier resolves, which is a product decision.
 * To settle it, re-run the A/B on a quiet machine.
 */

const argPair = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

test("a resolved model reaches the spawn args", () => {
  const spec = resolvePiSpawn("/ws", "/sess", "/rt", {
    model: { provider: "openrouter", modelId: "deepseek/deepseek-chat" },
  });
  expect(argPair(spec.args, "--provider")).toBe("openrouter");
  expect(argPair(spec.args, "--model")).toBe("deepseek/deepseek-chat");
});

test("no resolvable model still sends flags — omitting them hangs the spawn", () => {
  for (const opts of [{}, { model: null }, { model: undefined }]) {
    const spec = resolvePiSpawn("/ws", "/sess", "/rt", opts);
    expect(spec.args).toContain("--provider");
    expect(spec.args).toContain("--model");
    expect(argPair(spec.args, "--provider")).toBe("deepseek");
  }
});
