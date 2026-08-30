import { describe, expect, it } from "vitest";
import { formatElapsed } from "../src/renderer/src/components/TerminalRunCard";
import { parseTerminalEvent } from "../src/renderer/src/agents";
import { toolLabel } from "../src/renderer/src/toolLabel";

// §26 (2026-08-30): the stack cap and its "N running · titles" summary strip
// are gone — every run is a circle in the shared rail now, and the rail's own
// policy is pinned in tests/run-rail.test.ts. What is left here is the wire
// shape and the labels, which the rail did not touch.

describe("formatElapsed", () => {
  it("counts seconds, then minutes with a padded remainder", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59_999)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(187_000)).toBe("3m 07s");
  });

  it("never renders a negative elapsed", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});

describe("parseTerminalEvent", () => {
  it("reads a started notify off `message`, not `title`", () => {
    const ev = parseTerminalEvent({
      method: "notify",
      message: JSON.stringify({ kind: "hv.terminal", stage: "started", terminalId: "t1", title: "vite", intent: "Starting the dev server" }),
    });
    expect(ev).toMatchObject({ stage: "started", terminalId: "t1", intent: "Starting the dev server" });
  });

  it("ignores other envelopes and non-notifies", () => {
    expect(parseTerminalEvent({ method: "notify", message: JSON.stringify({ kind: "hv.subagent", stage: "started" }) })).toBeNull();
    expect(parseTerminalEvent({ method: "input", message: JSON.stringify({ kind: "hv.terminal", stage: "started" }) })).toBeNull();
    expect(parseTerminalEvent({ method: "notify", message: "not json" })).toBeNull();
  });
});

describe("toolLabel", () => {
  // The CARD leads with the model's intent (§7)…
  it("leads with the intent when the card has one", () => {
    expect(toolLabel("terminal_run", { intent: "Starting the dev server", command: "npm run dev" }).label).toBe(
      "Starting the dev server",
    );
    expect(toolLabel("terminal_kill", { intent: "Cleaning up" }).label).toBe("Cleaning up");
  });

  // …and the permission MODAL never does: argsFromSummary rebuilds {command}
  // only, so `intent` is absent there and the factual fallback runs.
  it("falls back to the factual command when there is no intent", () => {
    const l = toolLabel("terminal_run", { command: "npm run dev" });
    expect(l.icon).toBe("terminal");
    expect(l.label).not.toContain("undefined");
    expect(l.label.length).toBeGreaterThan(0);
  });

  it("marks a destructive terminal command destructive", () => {
    expect(toolLabel("terminal_run", { command: "rm -rf build" }).destructive).toBe(true);
  });

  it("labels terminal_read without needing an intent", () => {
    expect(toolLabel("terminal_read", { terminalId: "t1" })).toEqual({ icon: "terminal", label: "Reading terminal output" });
  });
});
