/**
 * §12 (2026-08-21) — the live child transcript, pulled on demand.
 *
 * pi-subagents 0.52 answers `/subagents-inspect-rpc` by emitting its reply
 * through `ctx.ui.setWidget` and immediately retracting it. Two mechanics decide
 * whether this works at all, and BOTH fail silently if they change, which is why
 * they are pinned against the vendored source rather than trusted:
 *
 *  - Pi's RPC setWidget forwards only `undefined` or an ARRAY. Upstream's
 *    encodeInspectReply returns string[], so the payload survives; a bare string
 *    would produce no frame and no error whatsoever.
 *  - The frame rides `extension_ui_request`, the same channel as permission
 *    prompts, so PiClient already re-emits it and needs no change.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  INSPECT_PREFIX,
  INSPECT_WIDGET_KEY,
  parseInspectFrame,
} from "../src/main/subagentInspect";

const reply = (over: Record<string, unknown> = {}) => ({
  kind: "pi-subagents.inspect-reply",
  version: 1,
  requestId: "q1",
  asyncId: "r1",
  messages: [{ role: "assistant", kind: "text", text: "hi" }],
  ...over,
});

const frame = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  method: "setWidget",
  widgetKey: INSPECT_WIDGET_KEY,
  widgetLines: [`${INSPECT_PREFIX}${JSON.stringify(reply())}`],
  ...over,
});

describe("parseInspectFrame", () => {
  it("parses the emit frame", () => {
    const got = parseInspectFrame(frame());
    expect(got?.requestId).toBe("q1");
    expect(got?.asyncId).toBe("r1");
    expect(got?.messages?.[0]?.text).toBe("hi");
  });

  it("ignores the RETRACT frame rather than reading it as an empty reply", () => {
    // Upstream emits then immediately retracts, in one handler. Treating the
    // retract as a reply would blank the transcript the emit just delivered.
    expect(parseInspectFrame(frame({ widgetLines: undefined }))).toBeNull();
    expect(parseInspectFrame(frame({ widgetLines: [] }))).toBeNull();
  });

  it("ignores another extension's widget", () => {
    expect(parseInspectFrame(frame({ widgetKey: "async-status" }))).toBeNull();
  });

  it("ignores a non-setWidget ui-request, so the permission channel is untouched", () => {
    // This is the important one: the inspect parser sits in FRONT of the
    // permission dispatch, and swallowing a prompt would hang the agent forever
    // (prompts never time out by design).
    expect(parseInspectFrame({ id: "x", method: "select", title: '{"kind":"hv.permission"}' })).toBeNull();
    expect(parseInspectFrame({ id: "x", method: "notify", message: '{"kind":"hv.audit"}' })).toBeNull();
    expect(parseInspectFrame({ id: "x", method: "input", title: '{"kind":"hv.plan-write"}' })).toBeNull();
  });

  it("ignores a line without the prefix, and malformed JSON after it", () => {
    expect(parseInspectFrame(frame({ widgetLines: ["just some text"] }))).toBeNull();
    expect(parseInspectFrame(frame({ widgetLines: [`${INSPECT_PREFIX}{not json`] }))).toBeNull();
  });

  it("ignores a payload that is not an inspect reply", () => {
    expect(parseInspectFrame(frame({ widgetLines: [`${INSPECT_PREFIX}{"kind":"something-else"}`] }))).toBeNull();
  });

  it("carries an ERROR reply through — the caller must see foreign_session", () => {
    // Inspection is scoped to the current session's children, so a respawn can
    // legitimately answer with an error. Dropping it would leave the UI spinning.
    const got = parseInspectFrame(frame({
      widgetLines: [`${INSPECT_PREFIX}${JSON.stringify(reply({ error: { code: "foreign_session", message: "nope" }, messages: undefined }))}`],
    }));
    expect(got?.error?.code).toBe("foreign_session");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 42, "str", {}, { method: "setWidget" }]) {
      expect(parseInspectFrame(junk)).toBeNull();
    }
  });
});

describe("the upstream mechanics this rests on", () => {
  const sub = (...p: string[]): string =>
    path.join(process.cwd(), "pi-runtime", "node_modules", "pi-subagents", ...p);

  it("upstream still returns a string ARRAY — RPC setWidget silently drops anything else", () => {
    const src = fs.readFileSync(sub("src", "runs", "background", "inspect-rpc.ts"), "utf8");
    expect(src).toMatch(/export function encodeInspectReply\([^)]*\): string\[\]/);
    expect(src).toContain('export const INSPECT_WIDGET_KEY = "subagent-inspect"');
    expect(src).toContain('export const INSPECT_WIDGET_PREFIX = "PI_SUBAGENT_INSPECT_JSON:"');
  });

  it("our copies of the key and prefix still match upstream's", () => {
    const src = fs.readFileSync(sub("src", "runs", "background", "inspect-rpc.ts"), "utf8");
    expect(src).toContain(`= "${INSPECT_WIDGET_KEY}"`);
    expect(src).toContain(`= "${INSPECT_PREFIX}"`);
  });

  it("the slash command exists and is gated on exactly the mode we run in", () => {
    const src = fs.readFileSync(sub("src", "slash", "slash-commands.ts"), "utf8");
    expect(src).toContain('pi.registerCommand("subagents-inspect-rpc"');
    // ctx.mode !== "tui" && ctx.hasUI — both true for us in --mode rpc.
    expect(src).toMatch(/ctx\.mode === "tui"/);
    expect(src).toMatch(/if \(!ctx\.hasUI\) return;/);
    // emit-then-retract in one handler
    expect(src).toMatch(/setWidget\(INSPECT_WIDGET_KEY, encodeInspectReply\(reply\)\)[\s\S]{0,120}setWidget\(INSPECT_WIDGET_KEY, undefined\)/);
  });

  it("Pi's RPC setWidget forwards ONLY undefined or an array", () => {
    const rpc = fs.readFileSync(
      path.join(process.cwd(), "pi-runtime", "node_modules", "@earendil-works",
                "pi-coding-agent", "dist", "modes", "rpc", "rpc-mode.js"), "utf8");
    expect(rpc).toMatch(/content === undefined \|\| Array\.isArray\(content\)/);
    expect(rpc).toMatch(/method: "setWidget"/);
  });

  it("PiClient already re-emits it, so no client change is needed", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "main", "pi", "PiClient.ts"), "utf8");
    expect(src).toMatch(/msg\.type === "extension_ui_request"[\s\S]{0,80}emit\("ui-request"/);
  });
});
