import { expect, test, describe } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { THINKING_LEVELS, resolveThinking, type ThinkingLevel } from "../src/main/thinking";

const runtime = path.join(process.cwd(), "pi-runtime");

describe("THINKING_LEVELS", () => {
  test("is exactly Pi's own union, in order", () => {
    // pi-agent-core dist/types.d.ts:260. A pin bump that changes it fails here.
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  test("is DERIVED from the vendored CLI, not hand-listed beside it", () => {
    // The contract-test pattern this repo uses for pin bumps: read upstream's
    // own list rather than agreeing with our copy of it. Measured against the
    // real CLI, `--thinking enormous` prints
    //   Warning: Invalid thinking level "enormous". Valid values: off, minimal, …
    // so this is the list that message is built from.
    const args = readFileSync(
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js"),
      "utf8",
    );
    const upstream = JSON.parse(
      args.match(/const VALID_THINKING_LEVELS = (\[[^\]]*\])/)![1].replace(/'/g, '"'),
    );
    expect([...THINKING_LEVELS]).toEqual(upstream);
  });
});

describe("resolveThinking", () => {
  test("session beats global", () => {
    expect(resolveThinking("low", "high")).toBe("low");
  });

  test("global is the fallback", () => {
    expect(resolveThinking(null, "high")).toBe("high");
    expect(resolveThinking(undefined, "high")).toBe("high");
  });

  test("nothing resolved is null, not a guessed default", () => {
    // Same rule as the model: the app refuses to invent one. Pi's own
    // precedence then applies, which is the only honest fallback.
    expect(resolveThinking(null, null)).toBeNull();
  });

  test("an unknown stored value is ignored rather than passed to Pi", () => {
    // config.json is hand-editable. Measured: an invalid level does NOT crash
    // Pi — it warns on stderr and runs at the default, i.e. it silently gives
    // the user a level they did not choose. That is the failure this whole
    // feature exists to end, so garbage is dropped here instead.
    expect(resolveThinking("enormous" as ThinkingLevel, "high")).toBe("high");
    expect(resolveThinking(null, "enormous" as ThinkingLevel)).toBeNull();
  });
});

describe("resolvePiSpawn --thinking", () => {
  test("emits the flag when a level resolves", () => {
    const spec = resolvePiSpawn("/ws", "/sessions", runtime, { thinking: "low" });
    const i = spec.args.indexOf("--thinking");
    expect(i).toBeGreaterThan(-1);
    expect(spec.args[i + 1]).toBe("low");
  });

  test("emits nothing when none does — Pi's own precedence then applies", () => {
    expect(resolvePiSpawn("/ws", "/sessions", runtime).args).not.toContain("--thinking");
  });

  test("the flag rides beside the model flags, not instead of them", () => {
    const spec = resolvePiSpawn("/ws", "/sessions", runtime, {
      model: { provider: "openrouter", modelId: "z-ai/glm-5.3-flash" },
      thinking: "max",
    });
    expect(spec.args).toContain("--provider");
    expect(spec.args).toContain("--thinking");
  });
});
