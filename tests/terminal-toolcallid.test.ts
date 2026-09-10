import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseTerminalEvent } from "../src/renderer/src/agents";
import { toRunAvatars } from "../src/renderer/src/runRail";

/**
 * A1 prerequisite 3 (Animations round, 2026-09-10) — the join that did not exist.
 *
 * A `terminal_run` produces two things that are the same run: a transcript CARD
 * (which knows the tool call id) and a rail CIRCLE (which knows the terminal
 * id). Nothing connected them, so the card→circle flight had no way to find its
 * own destination — and no test could catch that, because both halves were
 * individually correct.
 *
 * The bridge has the id all along and threw it away (`execute(_toolCallId, …)`).
 * It now rides `hv.terminal-run`, main echoes it on the started notify, and the
 * renderer keys the circle on it. Key-free on purpose: this is a wire shape,
 * and a shape is worth pinning at every pin bump, not only when a paid model
 * happens to be reachable.
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const BRIDGE = R("pi-runtime/extensions/happyvibe-bridge.ts");
const IPC = R("src/main/ipc.ts");

describe("a terminal's tool-call id travels bridge → main → renderer (A1)", () => {
  it("the bridge takes the id instead of discarding it, and puts it on the wire", () => {
    const run = BRIDGE.slice(
      BRIDGE.indexOf("TERMINAL_TOOL_DESCRIPTIONS.terminal_run"),
      BRIDGE.indexOf("TERMINAL_TOOL_DESCRIPTIONS.terminal_run") + 2400,
    );
    // Pi hands `execute` the tool call id as its first argument. It used to be
    // named `_toolCallId` — deliberately unused.
    expect(run).toMatch(/async execute\(toolCallId,/);
    expect(run).toMatch(/kind: "hv\.terminal-run"[\s\S]{0,200}toolCallId/);
  });

  it("main parses it off the request and echoes it on the started notify", () => {
    expect(IPC).toMatch(/toolCallId: typeof p\.toolCallId === "string" \? p\.toolCallId : undefined/);
    const started = IPC.slice(IPC.indexOf('stage: "started",'), IPC.indexOf('stage: "started",') + 700);
    expect(started).toContain("toolCallId: term.toolCallId");
  });

  it("the renderer reads it off the notify", () => {
    const ev = parseTerminalEvent({
      method: "notify",
      message: JSON.stringify({
        kind: "hv.terminal",
        stage: "started",
        terminalId: "t1",
        title: "zsh",
        toolCallId: "tc7",
      }),
    });
    expect(ev?.toolCallId).toBe("tc7");
  });

  it("a notify without one still parses — a user-opened terminal has no tool call", () => {
    const ev = parseTerminalEvent({
      method: "notify",
      message: JSON.stringify({ kind: "hv.terminal", stage: "started", terminalId: "t1", title: "zsh" }),
    });
    expect(ev?.terminalId).toBe("t1");
    expect(ev?.toolCallId).toBeUndefined();
  });

  it("the circle is keyed on the join, so the card and the circle agree", () => {
    const a = toRunAvatars([], [
      { terminalId: "t1", title: "zsh", running: true, intent: "", startedAt: 0, toolCallId: "tc7" },
    ])[0];
    // What `data-hv-run-card` on the card carries, and what
    // `data-hv-run-avatar` on the circle carries, are now the same string.
    expect(a.domKey).toBe("tc7");
    // …while the map key stays the terminal id, which is what every terminal
    // lookup in main and the renderer is keyed by.
    expect(a.key).toBe("t1");
  });

  it("main stores it against the terminal, so the circle can still find it later", () => {
    const app = R("src/renderer/src/App.tsx");
    const handler = app.slice(app.indexOf("setAgentTerms((p) => ({"), app.indexOf("setAgentTerms((p) => ({") + 400);
    expect(handler).toContain("toolCallId");
  });
});

/**
 * The "Open as tab" flight must look the run up by the SAME key the rail draws
 * it with (2026-09-10).
 *
 * `runRail.ts` keys a terminal's circle on `domKey` — the tool call id when the
 * join is present, the terminal id otherwise. `openAgentTerminalAsTab` looked
 * it up by terminalId alone, so from the moment the join shipped it matched
 * nothing and the flight silently never ran. Reported as "not really visible";
 * it was not visible at all.
 *
 * Two places computing one identity is the drift; this pins them to agree.
 */
describe("the open-as-tab flight uses the rail's own key", () => {
  const APP = R("src/renderer/src/App.tsx");
  const RAIL = R("src/renderer/src/runRail.ts");

  it("the derivation lives in ONE place", () => {
    // `domKey` is computed in runRail.ts and nowhere else. The first fix for
    // this bug re-derived it inside App, which is the same mistake one layer
    // along — a second copy that can drift.
    expect(RAIL).toContain("domKey: t.toolCallId ?? t.terminalId");
    const fn = APP.slice(APP.indexOf("const openAgentTerminalAsTab"), APP.indexOf("const openAgentTerminalAsTab") + 3000);
    expect(fn).not.toContain("?.toolCallId ?? terminalId");
  });

  it("the origin is found by the id the caller already holds", () => {
    const chat = R("src/renderer/src/components/ChatView.tsx");
    expect(chat).toContain("data-hv-run-key={a.key}");
    const fn = APP.slice(APP.indexOf("const openAgentTerminalAsTab"), APP.indexOf("const openAgentTerminalAsTab") + 3000);
    expect(fn).toContain('data-hv-run-key="${CSS.escape(terminalId)}"');
  });

  it("it waits for the destination tab instead of assuming one frame", () => {
    const fn = APP.slice(APP.indexOf("const openAgentTerminalAsTab"), APP.indexOf("const openAgentTerminalAsTab") + 3000);
    expect(fn).toContain("requestAnimationFrame(whenTabExists)");
    expect(fn).toMatch(/\+\+frames < \d+/);
  });

  it("the origin is read BEFORE the run is dropped", () => {
    // A rect from a node React has already unmounted is all zeros, and
    // `flyGhost` declines those — so the order is the whole feature.
    const fn = APP.slice(APP.indexOf("const openAgentTerminalAsTab"), APP.indexOf("const openAgentTerminalAsTab") + 1600);
    expect(fn.indexOf("const from =")).toBeLessThan(fn.indexOf("dropAgentTerminal("));
  });
});
