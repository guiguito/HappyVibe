import { describe, expect, it, beforeEach, afterEach, vi, afterAll } from "vitest";
import { TerminalManager } from "../src/main/terminals";
import { AgentTerminals, MAX_AGENT_TERMINALS, HOLD_IDLE_MS } from "../src/main/agentTerminals";
import { DEFAULT_TERMINAL_SETTINGS } from "../src/main/terminalSettings";

/** `-f` skips the user's rc files, so a test does not depend on someone's dotfiles. */
import { FAST, HAS_POSIX_SHELL } from "./shellFixture";
import { FOREGROUND_SUPPORTED as FOREGROUND } from "./shellFixture";

/**
 * Assert a run succeeded, and SAY WHY when it did not.
 *
 * Every refusal in agentTerminals.run is fast, so `expect(r.ok).toBe(true)`
 * fails as a bare "expected false to be true" — throwing away `reason`, which
 * is the only part that identifies which of the five rules fired. This cost a
 * whole debugging round on Linux.
 */
function expectOk<T extends { ok: boolean; reason?: string }>(r: T, what = "run"): void {
  expect(r.ok, r.ok ? "" : `${what} refused: ${r.reason}`).toBe(true);
}
const WS = process.cwd();
const S = "sess-1";

let mgr: TerminalManager;
let agent: AgentTerminals;

beforeEach(() => {
  mgr = new TerminalManager(
    () => {},
    () => {},
    () => {},
  );
  agent = new AgentTerminals(mgr);
});
afterEach(() => mgr.killAll());

const run = (command: string, terminalId?: string): ReturnType<AgentTerminals["run"]> =>
  agent.run(S, WS, WS, FAST, command, terminalId);

describe("soft cap", () => {
  it(`refuses past ${MAX_AGENT_TERMINALS} and names what is running`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_AGENT_TERMINALS; i++) {
      const r = await run("true");
      expectOk(r);
      if (r.ok) ids.push(r.terminalId);
    }
    const over = await run("true");
    expect(over.ok).toBe(false);
    // Naming them is the mechanism: the agent's next move must be to kill one,
    // not to guess which one it may reuse.
    if (!over.ok) for (const id of ids) expect(over.reason).toContain(id);
  });

  it("frees a slot when the agent kills one", async () => {
    const first = await run("true");
    expectOk(first);
    for (let i = 1; i < MAX_AGENT_TERMINALS; i++) await run("true");
    if (first.ok) expect(agent.kill(S, first.terminalId)).toEqual({ ok: true });
    expect((await run("true")).ok).toBe(true);
  });
});

describe("busy-reuse refusal", () => {
  it.skipIf(!FOREGROUND)("refuses to reuse a terminal whose foreground is non-null, naming the process", async () => { // Windows has no foreground source (terminals.ts FOREGROUND_SUPPORTED)
    const r = await run("sleep 30");
    expectOk(r);
    if (!r.ok) return;
    // The foreground process is POLLED by node-pty, not evented — give it a beat.
    await vi.waitFor(() => expect(mgr.foreground(r.terminalId)).toBe("sleep"), { timeout: 8000, interval: 100 });
    const reuse = await run("npm test", r.terminalId);
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.reason).toContain("sleep");
  });

  it.skipIf(FOREGROUND)("on Windows a busy terminal reads as idle, and reuse is ALLOWED rather than always refused", async () => {
    // The documented gap, asserted rather than left silent: pty.process answers a
    // constant there, so believing it would refuse every reuse forever and fill the
    // agent's cap of 3 permanently. Null is the fail-open direction we chose.
    const r = await run("sleep 30");
    expectOk(r);
    if (!r.ok) return;
    expect(mgr.foreground(r.terminalId)).toBeNull();
    const reuse = await run("echo x", r.terminalId);
    expectOk(reuse);
  });

  it("allows reuse of an idle terminal", async () => {
    const r = await run("true");
    expectOk(r);
    if (!r.ok) return;
    await vi.waitFor(() => expect(mgr.foreground(r.terminalId)).toBeNull(), { timeout: 8000, interval: 100 });
    const again = await run("echo hello", r.terminalId);
    // The reason is the whole diagnostic: every refusal is fast, so a bare
    // `.ok` assertion reports "expected false to be true" and throws away the
    // one sentence that says which rule fired.
    expectOk(again);
    if (again.ok) expect(again.terminalId).toBe(r.terminalId);
  });
});

describe("ownership", () => {
  it("refuses a terminal another session owns", async () => {
    const r = await run("true");
    expectOk(r);
    if (!r.ok) return;
    expect(agent.kill("sess-2", r.terminalId).ok).toBe(false);
    expect(agent.read("sess-2", r.terminalId).ok).toBe(false);
    expect(await agent.run("sess-2", WS, WS, FAST, "echo x", r.terminalId)).toMatchObject({ ok: false });
  });

  it("releaseSession returns the ids it owned and forgets them without killing", async () => {
    const r = await run("sleep 30");
    expectOk(r);
    if (!r.ok) return;
    expect(agent.releaseSession(S)).toEqual([r.terminalId]);
    expect(agent.ownedBy(S)).toEqual([]);
    // The PTY is NOT killed — the caller decides Stop them / Keep them.
    expect(mgr.get(r.terminalId)?.running).toBe(true);
  });
});

describe("read", () => {
  it("caps lines at 200 even when the model asks for more", async () => {
    const r = await run("true");
    expectOk(r);
    if (!r.ok) return;
    const spy = vi.spyOn(mgr, "readText");
    agent.read(S, r.terminalId, 10_000);
    expect(spy).toHaveBeenCalledWith(r.terminalId, 200);
  });

  it("reports userTyped once, then clears it", async () => {
    const r = await run("true");
    expectOk(r);
    if (!r.ok) return;
    agent.noteUserInput(r.terminalId, "x");
    const first = agent.read(S, r.terminalId);
    expect(first.ok && first.userTyped).toBe(true);
    const second = agent.read(S, r.terminalId);
    expect(second.ok && second.userTyped).toBe(false);
  });
});

describe("interleave hold", () => {
  /**
   * The hold only exists on the REUSE path, so the terminal has to be idle
   * first — otherwise the busy-reuse refusal fires and the test passes (or
   * fails) for the wrong reason. Both tests below assert `ok` for exactly that:
   * an early refusal is also fast, so a timing-only assertion is vacuous.
   */
  const idleTerminal = async (): Promise<string> => {
    const r = await run("true");
    expectOk(r);
    if (!r.ok) throw new Error("could not open a terminal");
    await vi.waitFor(() => expect(mgr.foreground(r.terminalId)).toBeNull(), { timeout: 8000, interval: 100 });
    return r.terminalId;
  };

  it("holds the agent's write while the user is mid-line and releases on idle", async () => {
    const id = await idleTerminal();
    agent.noteUserInput(id, "npm ls"); // user typed, no Enter yet
    const spy = vi.spyOn(mgr, "write");
    const started = Date.now();
    const res = await run("echo queued", id);
    const waited = Date.now() - started;
    expectOk(res);
    expect(spy).toHaveBeenCalled();
    // Held for the debounce rather than interleaving into the user's half-typed
    // line. Real timers: HOLD_IDLE_MS is 1.5s and this is the only place it runs.
    expect(waited).toBeGreaterThanOrEqual(HOLD_IDLE_MS - 100);
  }, 15_000);

  it("does not hold once the user's line is ended", async () => {
    const id = await idleTerminal();
    for (const ender of ["npm ls\r", "\x03", "\x15"]) {
      // Back to a prompt before EACH pass, not just before the first. This test
      // measures the hold; a terminal still finishing the previous `echo` is
      // refused by the busy-reuse rule instead — and a refusal is also fast, so
      // the timing assertion below would pass while `ok` was false. macOS
      // happened to return to idle inside the loop's own overhead and Linux does
      // not, which is the whole reason this line exists.
      await vi.waitFor(() => expect(mgr.foreground(id)).toBeNull(), { timeout: 8000, interval: 100 });
      agent.noteUserInput(id, ender);
      const started = Date.now();
      const res = await run("echo now", id);
      expectOk(res);
      expect(Date.now() - started).toBeLessThan(HOLD_IDLE_MS / 2);
    }
  }, 15_000);
});

describe("open-terminals context block", () => {
  it("is empty with no terminals and lists one line each otherwise", async () => {
    expect(agent.buildOpenTerminalsBlock(S)).toBe("");
    const r = await run("sleep 30");
    expectOk(r);
    if (!r.ok) return;
    const block = agent.buildOpenTerminalsBlock(S);
    expect(block).toContain("<open-terminals>");
    expect(block).toContain("</open-terminals>");
    expect(block).toContain(r.terminalId);
    expect(block).toContain("running");
  });

  it("renders byte-identically for an unchanged set, so the change check can be a string compare", async () => {
    await run("sleep 30");
    await run("sleep 30");
    expect(agent.buildOpenTerminalsBlock(S)).toBe(agent.buildOpenTerminalsBlock(S));
  });

  it("shows only this session's terminals", async () => {
    const mine = await run("sleep 30");
    await agent.run("sess-2", WS, WS, FAST, "sleep 30");
    expectOk(mine);
    if (!mine.ok) return;
    const block = agent.buildOpenTerminalsBlock(S);
    expect(block.split("\n").filter((l) => l.startsWith("t"))).toHaveLength(1);
    expect(block).toContain(mine.terminalId);
  });
});

/**
 * Let Windows finish tearing down the native handles this file opened before the
 * worker process exits.
 *
 * `FSWatcher.close()` and `pty.kill()` both return immediately and complete
 * ASYNCHRONOUSLY on Windows — the ConPTY teardown is visible in CI's own cleanup,
 * which reports orphaned `conhost` and `bash` processes. When the worker exits with
 * that work in flight, the completion lands on a dead process and the worker dies with
 * ACCESS_VIOLATION (0xC0000005) or STATUS_STACK_BUFFER_OVERRUN (0xC0000409) — after
 * every test in the file has PASSED, which is how it presented: a green file list and
 * a failed run.
 *
 * Deterministic on the Windows runner, never reproducible on a Windows dev box. It is
 * a test-harness accommodation for a platform behaviour, not a product bug: the app
 * does not exit microseconds after killing a terminal.
 */
afterAll(async () => {
  if (process.platform === "win32") await new Promise((r) => setTimeout(r, 300));
});
