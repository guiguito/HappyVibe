import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { ledgerTotal, parseCalls } from "../src/main/calls";
import { readSessionFile } from "../src/main/store";

// Line shapes are copied from a real Pi session file (verified 2026-07-30 against
// ~/Library/Application Support/HappyVibe/sessions/*.jsonl): every entry is
// {type, ...} and a billed API call is type:"message" with message.role
// "assistant", carrying timestamp/provider/model + the full usage breakdown.
const line = (o: unknown): string => JSON.stringify(o);

const assistant = (over: Record<string, unknown> = {}): string =>
  line({
    type: "message",
    message: {
      role: "assistant",
      timestamp: 1785395073769,
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      usage: {
        input: 1000,
        output: 200,
        cacheRead: 9000,
        cacheWrite: 0,
        totalTokens: 10200,
        cost: { input: 0.00088, output: 0.00056, cacheRead: 0.00151, cacheWrite: 0, total: 0.00295 },
      },
      ...over,
    },
  });

describe("parseCalls", () => {
  test("extracts one call per assistant message, in file order", () => {
    const jsonl = [
      line({ type: "session", sessionId: "s1" }),
      line({ type: "message", message: { role: "user", timestamp: 1, content: [] } }),
      assistant(),
      line({ type: "message", message: { role: "toolResult", timestamp: 2, toolName: "read" } }),
      assistant({ timestamp: 1785395999999, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 3, totalTokens: 15, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 4, total: 7 } } }),
      line({ type: "model_change" }),
    ].join("\n");

    const calls = parseCalls(jsonl);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      ts: "2026-07-30T07:04:33.769Z",
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      input: 1000,
      output: 200,
      cacheRead: 9000,
      cacheWrite: 0,
      cost: 0.00295,
      priced: true,
    });
    expect(calls[1].ts).toBe("2026-07-30T07:19:59.999Z");
    expect(calls[1].cacheWrite).toBe(3);
    expect(calls[1].cost).toBe(7);
  });

  test("a call with tokens but zero cost is UNPRICED, not free", () => {
    // The real hv-nvidia-cloud case: modelsJson wrote no `cost`, so Pi's
    // provider-composer defaulted every rate to 0 and billed 60k tokens at $0.
    const jsonl = assistant({
      provider: "hv-nvidia-cloud",
      usage: {
        input: 60023, output: 74, cacheRead: 0, cacheWrite: 0, totalTokens: 60097,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const [call] = parseCalls(jsonl);
    expect(call.priced).toBe(false);
    expect(call.cost).toBe(0);
  });

  test("a genuinely free call (no tokens at all) is not flagged unpriced", () => {
    const jsonl = assistant({
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    expect(parseCalls(jsonl)[0].priced).toBe(true);
  });

  test("survives torn lines, blank lines, and missing usage without throwing", () => {
    const jsonl = [
      "",
      '{"type":"message","message":{"role":"assis',           // torn tail (crash mid-append)
      line({ type: "message", message: { role: "assistant", timestamp: 5 } }), // no usage
      assistant(),
      "   ",
    ].join("\n");
    const calls = parseCalls(jsonl);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ input: 0, output: 0, cost: 0, provider: "?", model: "?" });
  });

  test("non-finite numbers are coerced to 0 rather than poisoning the total", () => {
    const jsonl = assistant({
      usage: { input: Number.NaN, output: 10, cacheRead: null, cacheWrite: 0, cost: { total: "1.5" } },
    });
    const [call] = parseCalls(jsonl);
    expect(call.input).toBe(0);
    expect(call.cacheRead).toBe(0);
    expect(call.output).toBe(10);
    expect(call.cost).toBe(0);
  });

  test("empty input yields no calls", () => {
    expect(parseCalls("")).toEqual([]);
    expect(parseCalls(null)).toEqual([]);
  });
});

describe("ledgerTotal", () => {
  test("sums every column and counts unpriced calls", () => {
    const calls = parseCalls([
      assistant(),
      assistant({ provider: "hv-nvidia-cloud", usage: { input: 500, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } }),
    ].join("\n"));

    expect(ledgerTotal(calls)).toEqual({
      calls: 2,
      input: 1500,
      output: 205,
      cacheRead: 9000,
      cacheWrite: 0,
      cost: 0.00295,
      unpriced: 1,
    });
  });

  test("an empty ledger totals to zero, not NaN", () => {
    expect(ledgerTotal([])).toEqual({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 });
  });
});

// piSessionFile is Pi-reported — treated as untrusted, exactly like
// deleteSessionFile (store.ts). A read must never escape the session dir.
describe("readSessionFile confinement", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-calls-"));
  const sessions = path.join(tmp, "sessions");
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, "ok.jsonl"), "hello");
  const secret = path.join(tmp, "secret.txt");
  fs.writeFileSync(secret, "TOP SECRET");
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("reads a file inside the session dir", () => {
    expect(readSessionFile(sessions, path.join(sessions, "ok.jsonl"))).toBe("hello");
  });

  test("refuses an absolute path outside the session dir", () => {
    expect(readSessionFile(sessions, secret)).toBeNull();
  });

  test("refuses a traversal that escapes the session dir", () => {
    expect(readSessionFile(sessions, path.join(sessions, "..", "secret.txt"))).toBeNull();
  });

  test("refuses the session dir itself (prefix match must not accept it)", () => {
    expect(readSessionFile(sessions, sessions)).toBeNull();
  });

  test("refuses a sibling dir sharing the session dir's name prefix", () => {
    const evil = path.join(tmp, "sessions-evil");
    fs.mkdirSync(evil, { recursive: true });
    fs.writeFileSync(path.join(evil, "x.jsonl"), "nope");
    expect(readSessionFile(sessions, path.join(evil, "x.jsonl"))).toBeNull();
  });

  test("a missing or undefined file is null, not a throw", () => {
    expect(readSessionFile(sessions, path.join(sessions, "gone.jsonl"))).toBeNull();
    expect(readSessionFile(sessions, undefined)).toBeNull();
  });
});
