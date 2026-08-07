import { describe, expect, it } from "vitest";
import { visibleRuns, summaryLabel, STACK_CAP, type TerminalRun } from "../src/renderer/src/components/TerminalRunCard";
import { parseTerminalEvent } from "../src/renderer/src/agents";
import { toolLabel } from "../src/renderer/src/toolLabel";

const t = (id: string, title: string, running = true): TerminalRun => ({
  terminalId: id,
  title,
  running,
  intent: `run ${id}`,
  startedAt: 0,
});

describe("stack cap", () => {
  it("shows up to two cards in full", () => {
    const runs = [t("a", "vite"), t("b", "vitest")];
    expect(visibleRuns(runs)).toEqual({ cards: runs, collapsed: [] });
  });

  // §26: a terminal card pins INDEFINITELY, unlike a delegation card which
  // assumes termination — so without a cap three dev servers eat the chat.
  it("collapses everything beyond two into a summary strip", () => {
    const runs = [t("a", "vite"), t("b", "vitest"), t("c", "docker")];
    const v = visibleRuns(runs);
    expect(v.cards).toHaveLength(0);
    expect(v.collapsed).toHaveLength(3);
    expect(summaryLabel(v.collapsed)).toBe("3 running · vite, vitest, docker");
  });

  // The regression the design risks: closing one of three must return the stack
  // to two FULL cards, not leave a strip still claiming three. Driving it off
  // live state rather than a captured count is what makes that automatic.
  it("returns to full cards when one of three exits", () => {
    const runs = [t("a", "vite"), t("b", "vitest"), t("c", "docker", false)];
    const v = visibleRuns(runs);
    expect(v.collapsed).toHaveLength(0);
    expect(v.cards.map((r) => r.terminalId)).toEqual(["a", "b"]);
  });

  it("drops exited terminals from the stack", () => {
    const runs = [t("a", "vite"), t("b", "vitest", false)];
    expect(visibleRuns(runs).cards.map((r) => r.terminalId)).toEqual(["a"]);
  });

  it("caps at two", () => {
    expect(STACK_CAP).toBe(2);
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
