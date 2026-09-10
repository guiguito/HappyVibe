import { describe, expect, it } from "vitest";
import {
  TERMINAL_TOOLS,
  checkCommand,
  hasBackgroundAmpersand,
  TERMINAL_STEER_LINE,
} from "../pi-runtime/extensions/hv-terminal";
import { SAFE_TOOLS, evaluate, EMPTY_RULES } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("checkCommand", () => {
  it("accepts a single command line and trims it", () => {
    expect(checkCommand("  npm run dev  ")).toEqual({ ok: true, command: "npm run dev" });
  });

  // §26: describeCommand reads only the FIRST segment, so a two-line string
  // would be SHOWN to the user as its harmless first line. That is the whole
  // reason newlines are rejected rather than merely discouraged.
  it.each(["npm run dev\nrm -rf /", "a\r\nb", "a\rb"])("rejects embedded newlines: %j", (cmd) => {
    const r = checkCommand(cmd);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/one command line/i);
  });

  it("rejects a non-string and an empty command", () => {
    expect(checkCommand(undefined).ok).toBe(false);
    expect(checkCommand("   ").ok).toBe(false);
  });
});

describe("hasBackgroundAmpersand", () => {
  it.each(["npm run dev &", "npm run dev &> /tmp/log &", "npm run dev & echo started", "( npm run dev ) &"])(
    "detects a real background operator: %j",
    (cmd) => {
      expect(hasBackgroundAmpersand(cmd)).toBe(true);
    },
  );

  // The false positives that matter: && is a sequencer, not a backgrounder,
  // and an & inside a quoted string or a redirect is not an operator at all.
  it.each([
    "npm ci && npm run build",
    "a && b && c",
    "grep 'foo & bar' file",
    'echo "a & b"',
    "npm test 2>&1",
    "npm run dev &> /tmp/log",
  ])("does not fire on: %j", (cmd) => {
    expect(hasBackgroundAmpersand(cmd)).toBe(false);
  });
});

describe("module surface", () => {
  it("names exactly the three tools", () => {
    expect([...TERMINAL_TOOLS].sort()).toEqual(["terminal_kill", "terminal_read", "terminal_run"]);
  });

  it("steers toward terminal_run by name, in one calm sentence", () => {
    expect(TERMINAL_STEER_LINE).toContain("terminal_run");
    // A5/X2: the how belongs to terminal_run's own description and the why to
    // the bash-`&` refusal; this is one sentence of when.
    expect(TERMINAL_STEER_LINE.length).toBeLessThan(220);
    expect(TERMINAL_STEER_LINE).not.toMatch(/INDEFINITELY/);
    // Scope FIRST, exception second — bridge.test.ts and rules-bridge.test.ts
    // both depend on the model still reaching for bash.
    expect(TERMINAL_STEER_LINE.indexOf("bash")).toBeLessThan(TERMINAL_STEER_LINE.indexOf("terminal_run"));
  });
});

describe("gate placement (§26)", () => {
  it("terminal_read is safe-default allowed — polling a log must not prompt", () => {
    expect(SAFE_TOOLS.has("terminal_read")).toBe(true);
    const v = evaluate(EMPTY_RULES, { tool: "terminal_read", input: { terminalId: "t1" }, workspace: "/ws" });
    expect(v).toEqual({ action: "allow", source: "safe-default" });
  });

  it("terminal_run and terminal_kill still ask by default", () => {
    for (const tool of ["terminal_run", "terminal_kill"]) {
      expect(evaluate(EMPTY_RULES, { tool, input: { command: "npm run dev" }, workspace: "/ws" }).action).toBe("ask");
    }
  });

  // The whole point of naming the parameter `command`: a rule written for bash
  // gates the terminal too, with no new matching code.
  it("an existing command-layer rule gates terminal_run unchanged", () => {
    const rules = { global: [{ layer: "command" as const, pattern: "rm *", action: "deny" as const }], workspaces: {} };
    expect(evaluate(rules, { tool: "terminal_run", input: { command: "rm -rf /" }, workspace: "/ws" }).action).toBe("deny");
  });

  // most-restrictive-wins: a tool-layer ask beats a command-layer allow, which
  // is how a user distinguishes `npm run dev` for a turn from forever.
  it("a tool-layer ask on terminal_run beats a command-layer allow", () => {
    const rules = {
      global: [
        { layer: "command" as const, pattern: "npm*", action: "allow" as const },
        { layer: "tool" as const, pattern: "terminal_run", action: "ask" as const },
      ],
      workspaces: {},
    };
    expect(evaluate(rules, { tool: "terminal_run", input: { command: "npm run dev" }, workspace: "/ws" }).action).toBe("ask");
  });

  it("plan mode blocks terminal_run and passes read/kill without a prompt", () => {
    const run = gatePlanCall("terminal_run", { command: "npm run dev" });
    expect(run.kind).toBe("block");
    expect((run as { reason: string }).reason).toContain("terminal_run");
    // NOT floor-ask: that clamps allow→ask, so a planning agent polling a log
    // would raise a modal on every poll — the exact thing SAFE_TOOLS prevents.
    expect(gatePlanCall("terminal_read", { terminalId: "t1" })).toEqual({ kind: "pass" });
    expect(gatePlanCall("terminal_kill", { terminalId: "t1" })).toEqual({ kind: "pass" });
  });
});

describe("builtins.terminal", () => {
  it("defaults on and fails open on garbage", () => {
    expect(parseBuiltins(undefined).terminal).toBe(true);
    expect(parseBuiltins("{{{not json").terminal).toBe(true);
  });

  it("turns off only on an explicit false", () => {
    expect(parseBuiltins(JSON.stringify({ terminal: false })).terminal).toBe(false);
    expect(parseBuiltins(JSON.stringify({ terminal: "no" })).terminal).toBe(true);
  });

  // Unlike plan/askUser there is no coupling to repair: the three terminal
  // tools are one group, and nothing outside it depends on them.
  it("does not disturb the plan/askUser coupling", () => {
    const b = parseBuiltins(JSON.stringify({ terminal: false, plan: true, askUser: false }));
    expect(b.askUser).toBe(true);
    expect(b.plan).toBe(true);
  });
});
