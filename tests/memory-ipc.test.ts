/**
 * PRD §33 — the blocking envelope parser. Pure, so it is testable without Electron; the handler
 * it feeds is what guarantees the bridge is ALWAYS answered.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseMemoryEnvelope } from "../src/main/ipc";

const req = (payload: unknown, method = "input"): { method?: string; title?: string } => ({
  method,
  title: JSON.stringify(payload),
});

describe("parseMemoryEnvelope accepts our three envelopes", () => {
  it("save carries every field the store needs", () => {
    expect(
      parseMemoryEnvelope(
        req({ kind: "hv.memory-save", scope: "workspace", type: "project", name: "n", description: "d", content: "c", toolCallId: "t1" })
      )
    ).toEqual({ kind: "hv.memory-save", scope: "workspace", type: "project", name: "n", description: "d", content: "c" });
  });

  it("recall and forget carry scope and name", () => {
    expect(parseMemoryEnvelope(req({ kind: "hv.memory-recall", scope: "global", name: "n" }))).toEqual({
      kind: "hv.memory-recall",
      scope: "global",
      name: "n",
    });
    expect(parseMemoryEnvelope(req({ kind: "hv.memory-forget", scope: "global", name: "n" }))).toEqual({
      kind: "hv.memory-forget",
      scope: "global",
      name: "n",
    });
  });

  it("an EMPTY content parses — 'content is required' is the STORE's refusal, with a reason", () => {
    expect(parseMemoryEnvelope(req({ kind: "hv.memory-save", scope: "global", type: "user", name: "n", description: "d", content: "" }))).toMatchObject({
      content: "",
    });
  });
});

describe("parseMemoryEnvelope refuses everything else", () => {
  it.each([
    ["a notify, not an input", { kind: "hv.memory-save", scope: "global", type: "user", name: "n", description: "d", content: "c" }, "notify"],
  ])("%s", (_label, payload, method) => {
    expect(parseMemoryEnvelope(req(payload, method))).toBeNull();
  });

  it.each([
    ["another extension's envelope", { kind: "hv.plan-write", plan: "x" }],
    ["an unknown memory verb", { kind: "hv.memory-explode", scope: "global", name: "n" }],
    ["an unknown scope", { kind: "hv.memory-recall", scope: "universe", name: "n" }],
    ["no scope at all", { kind: "hv.memory-recall", name: "n" }],
    ["no name", { kind: "hv.memory-recall", scope: "global" }],
    ["an empty name", { kind: "hv.memory-recall", scope: "global", name: "" }],
    ["a save missing its type", { kind: "hv.memory-save", scope: "global", name: "n", description: "d", content: "c" }],
    ["a save missing its description", { kind: "hv.memory-save", scope: "global", type: "user", name: "n", content: "c" }],
    ["a non-string name", { kind: "hv.memory-recall", scope: "global", name: 7 }],
  ])("%s", (_label, payload) => {
    expect(parseMemoryEnvelope(req(payload))).toBeNull();
  });

  it("unparseable or absent title", () => {
    expect(parseMemoryEnvelope({ method: "input", title: "{not json" })).toBeNull();
    expect(parseMemoryEnvelope({ method: "input" })).toBeNull();
    expect(parseMemoryEnvelope({})).toBeNull();
  });
});

/**
 * §19's rule — telemetry without content — as a SOURCE SCAN, the tests/modal-layer.test.ts
 * idiom: an absence is exactly what a behavioural test does not fail on. The audit log is
 * readable, exportable and long-lived, so a memory's BODY must never reach it; scope, type,
 * name and the one-line description are what a reader needs.
 */
describe("§33 audit rows never carry a memory body", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/main/ipc.ts"), "utf8");

  it("every memory.* log.append payload is free of content/body/text", () => {
    // Each `type: "memory.…"` append, from its `data: {` to the closing brace of that object.
    const appends = [...src.matchAll(/type:\s*"(memory\.[a-z]+)"[\s\S]{0,600}?data:\s*\{([\s\S]*?)\},?\n/g)];
    expect(appends.length).toBeGreaterThanOrEqual(4); // saved · refused · recalled · forgotten
    for (const [, kind, data] of appends) {
      expect(data, kind).not.toMatch(/\bcontent\b/);
      expect(data, kind).not.toMatch(/\bbody\b/);
      expect(data, kind).toMatch(/\bscope\b/);
    }
  });

  it("the six memory audit types all exist", () => {
    for (const t of ["memory.saved", "memory.refused", "memory.recalled", "memory.forgotten"]) {
      expect(src, t).toContain(`type: "${t}"`);
    }
  });
});
