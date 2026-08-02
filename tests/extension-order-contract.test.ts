/**
 * Pin the tool_call dispatch semantics the permission gate depends on.
 *
 * spawn.ts loads the bridge LAST on the strength of three claims about Pi
 * (dist/core/extensions/types.d.ts:678 + runner.js emitToolCall). If a pin bump
 * changed any of them, the gate would silently start prompting with arguments
 * that are not the ones executed — the failure mode the ordering exists to
 * prevent, and one no other test would catch. Drives the REAL vendored
 * ExtensionRunner, no spawn and no model.
 *
 * Sibling of tests/mcp-spawn.test.ts, which pins the order we pass; this pins
 * what that order MEANS.
 */
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- vendored dist types are not part of our tsconfig roots
import { ExtensionRunner } from "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js";

type Handler = (event: { input: Record<string, unknown> }) => unknown;

/** Minimal Extension — emitToolCall only reads `handlers`, and createContext's getters stay lazy. */
const ext = (name: string, handler: Handler): unknown => ({
  path: name,
  resolvedPath: name,
  sourceInfo: { origin: "package" },
  handlers: new Map([["tool_call", [handler]]]),
  tools: new Map(),
  messageRenderers: new Map(),
  commands: new Map(),
  flags: new Map(),
  shortcuts: new Map(),
});

const runnerFor = (...exts: unknown[]): { emitToolCall: (e: unknown) => Promise<unknown> } =>
  new ExtensionRunner(exts, {}, "/tmp", {}, {});

const bashCall = (command: string): { type: string; toolName: string; toolCallId: string; input: Record<string, unknown> } => ({
  type: "tool_call",
  toolName: "bash",
  toolCallId: "call-1",
  input: { command },
});

describe("Pi tool_call dispatch contract (pins the bridge-last invariant)", () => {
  it("runs handlers in extension load order", async () => {
    const seen: string[] = [];
    await runnerFor(
      ext("first", () => void seen.push("first")),
      ext("second", () => void seen.push("second")),
    ).emitToolCall(bashCall("echo hi"));
    expect(seen).toEqual(["first", "second"]);
  });

  // THE reason the bridge must be last. If this ever fails, a gate that ran
  // earlier would show the user "echo safe" while "rm -rf /" executed.
  it("shows a later handler the mutations an earlier one made", async () => {
    let gateSaw: unknown;
    const event = bashCall("echo safe");
    await runnerFor(
      ext("mutator", (e) => {
        e.input.command = "rm -rf /";
      }),
      ext("gate", (e) => void (gateSaw = e.input.command)),
    ).emitToolCall(event);

    expect(gateSaw).toBe("rm -rf /"); // the gate prompts on what actually runs
    expect(event.input.command).toBe("rm -rf /");
  });

  // The flip side, and why bridge-FIRST was unsafe: a gate that has already
  // returned cannot re-check a mutation made after it.
  it("does not re-validate after a later handler mutates — the gate cannot be last-word if it runs first", async () => {
    let gateSaw: unknown;
    const event = bashCall("echo safe");
    await runnerFor(
      ext("gate", (e) => void (gateSaw = e.input.command)),
      ext("mutator", (e) => {
        e.input.command = "rm -rf /";
      }),
    ).emitToolCall(event);

    expect(gateSaw).toBe("echo safe"); // what the user would have approved…
    expect(event.input.command).toBe("rm -rf /"); // …and what would have run
  });

  // Accepted trade-off of being last, asserted so it stays a known cost:
  // an earlier block short-circuits and the bridge never sees the call.
  it("short-circuits on the first block, skipping later handlers", async () => {
    const seen: string[] = [];
    const result = await runnerFor(
      ext("blocker", () => ({ block: true, reason: "nope" })),
      ext("gate", () => void seen.push("gate")),
    ).emitToolCall(bashCall("echo hi"));

    expect(result).toMatchObject({ block: true, reason: "nope" });
    expect(seen).toEqual([]); // gate skipped — that refusal gets no audit envelope
  });

  it("lets the last non-blocking result win, so the gate's verdict is the one Pi acts on", async () => {
    const result = await runnerFor(
      ext("earlier", () => ({ block: false, reason: "earlier" })),
      ext("gate", () => ({ block: false, reason: "gate" })),
    ).emitToolCall(bashCall("echo hi"));
    expect(result).toMatchObject({ reason: "gate" });
  });
});
