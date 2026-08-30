import { expect, test, describe } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { THINKING_LEVELS, resolveThinking, type ThinkingLevel } from "../src/main/thinking";

const runtime = path.join(process.cwd(), "pi-runtime");

describe("THINKING_LEVELS", () => {
  test("is exactly Pi's own union, in order", () => {
    // pi-agent-core dist/types.d.ts:260. A pin bump that changes it fails here.
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
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
    // config.json is hand-editable; --thinking rejects an invalid level and
    // Pi exits, which would make a bad config unrecoverable from the UI.
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
