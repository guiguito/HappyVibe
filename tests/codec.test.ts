import { describe, expect, test } from "vitest";
import { NdjsonDecoder, encodeCommand } from "../src/main/pi/codec";

describe("NdjsonDecoder", () => {
  test("parses complete lines", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"agent_start"}\n{"type":"agent_end"}\n'))
      .toEqual([{ type: "agent_start" }, { type: "agent_end" }]);
  });
  test("buffers partial lines across chunks", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"agent')).toEqual([]);
    expect(d.push('_start"}\n')).toEqual([{ type: "agent_start" }]);
  });
  test("skips malformed lines without throwing", () => {
    const d = new NdjsonDecoder();
    expect(d.push('not json\n{"type":"ok"}\n')).toEqual([{ type: "ok" }]);
  });
});

test("encodeCommand appends newline", () => {
  expect(encodeCommand({ id: "1", type: "prompt", message: "hi" }))
    .toBe('{"id":"1","type":"prompt","message":"hi"}\n');
});
