import { defineConfig } from "vitest/config";

/**
 * There was no vitest config until now, so the suite ran on vitest's DEFAULTS —
 * and the default `testTimeout` is 5 s. Every test that talks to a real Pi child
 * needs more than that just to boot one (measured 5–15 s cold, worse with 14
 * spawning at once), so a test either passed an explicit per-test timeout or was
 * quietly a coin flip. Two in `agents-bridge.test.ts` had none and failed at
 * exactly 5000 ms — in isolation as well as in the batch, so this was never
 * flakiness, it was a missing default. Setting it once here fixes every current
 * and future sibling instead of sprinkling numbers per test; tests that need
 * longer (a real model turn) still pass their own.
 */
export default defineConfig({
  test: {
    // Every test we own lives in tests/ (verified: nothing matches outside it).
    // Pinning the glob matters because vitest's DEFAULT include walks the whole
    // tree, and §25's catalog generator caches ~199 downloaded plugin repos under
    // tools/plugin-catalog/.cache — each with its own suite. Unpinned, `npm test`
    // collected 3084 files and 1412 third-party failures, i.e. the gate became
    // other people's test results. An exclude for that one path would work today
    // and break the next time anything lands in the tree.
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Parallelism is NOT capped here: the 86-file non-live suite is pure and
    // wants all the workers it can get. The live-Pi batch is the opposite — each
    // file spawns a Pi child and a real DeepSeek session, and running several at
    // once contends for the machine AND for the provider — so its canonical
    // invocation passes `--no-file-parallelism` (see CLAUDE.md). Two suites,
    // two needs, one flag at the call site rather than a config that penalises
    // the common case.
  },
});
