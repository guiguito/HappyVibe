/**
 * §26 part 2 — which terminals an agent session owns, and the three rules that
 * make handing a PTY to a model safe.
 *
 * TerminalManager stays session-ignorant: a terminal belongs to a WORKSPACE
 * (part 1's locked decision), and this module is the only thing that also knows
 * a session started one. Ending a session therefore never has to kill a PTY —
 * it releases a claim, and the human picks Stop them / Keep them as terminals.
 */
import type { TerminalManager, TerminalInfo } from "./terminals";
import type { TerminalSettings } from "./terminalSettings";

/** §26: unbounded is how you end up with eleven dev servers on eleven ports. */
export const MAX_AGENT_TERMINALS = 3;

/**
 * How long the agent's held write waits for the user to stop typing.
 *
 * ponytail: an approximation, and §26 says so. Nothing in the app can see the
 * user's input line — part 1's `foreground()` comment records that knowing you
 * are at a prompt is unsolvable without shell integration. What we CAN see is
 * who wrote last. Upgrade path: OSC 133 prompt markers.
 */
export const HOLD_IDLE_MS = 1500;

/** §26: ~200 lines by default and hard-capped — the failure mode is burning the
 *  context window, not missing output. Matches TerminalManager.readText's default. */
export const MAX_READ_LINES = 200;

export type RunResult = { ok: true; terminalId: string; title: string } | { ok: false; reason: string };
export type ReadResult =
  | { ok: true; text: string; running: boolean; exitCode: number | null; userTyped: boolean }
  | { ok: false; reason: string };
export type KillResult = { ok: true } | { ok: false; reason: string };

interface Claim {
  sessionId: string;
  /** Set when the user types, cleared on a line ending. Drives the hold. */
  userMidLine: boolean;
  /** Set when the user types, cleared by the next terminal_read. */
  userTypedSinceRead: boolean;
  /** When the user last typed — the debounce is measured from here. */
  lastUserInputAt: number;
}

/** Enter, Ctrl-C, Ctrl-U — after any of these the user's input line is gone. */
const LINE_ENDERS = /[\r\n\x03\x15]/;

export class AgentTerminals {
  private readonly claims = new Map<string, Claim>();

  constructor(private readonly mgr: TerminalManager) {}

  /** The live terminals this session started. Dead ids are pruned lazily here. */
  ownedBy(sessionId: string): string[] {
    return [...this.claims.entries()]
      .filter(([id, c]) => c.sessionId === sessionId && this.mgr.get(id))
      .map(([id]) => id);
  }

  async run(
    sessionId: string,
    workspaceId: string,
    cwd: string,
    settings: TerminalSettings,
    command: string,
    terminalId?: string,
  ): Promise<RunResult> {
    let id = terminalId;
    if (id) {
      const claim = this.claims.get(id);
      if (!claim || claim.sessionId !== sessionId) {
        return { ok: false, reason: `No terminal '${id}' belongs to this session.` };
      }
      const info = this.mgr.get(id);
      if (!info?.running) return { ok: false, reason: `Terminal '${id}' has exited. Start a new one.` };
      // The §2 hazard arriving through the parameter that was meant to be safe:
      // `npm test` sent into a terminal running `npm run dev` is keystrokes into
      // Vite, not a command. foreground() is the only thing that can tell.
      const fg = this.mgr.foreground(id);
      if (fg) {
        return {
          ok: false,
          reason:
            `Terminal '${id}' is busy running '${fg}' — sending a command there would type into ` +
            `that process, not the shell. Start a new terminal, or terminal_kill this one first.`,
        };
      }
    } else {
      const owned = this.ownedBy(sessionId);
      if (owned.length >= MAX_AGENT_TERMINALS) {
        const running = owned.map((t) => `${t} (${this.mgr.get(t)?.title ?? "?"})`).join(", ");
        return {
          ok: false,
          reason:
            `This session already has ${owned.length} terminals open, the maximum. ` +
            `Running: ${running}. terminal_kill one before starting another.`,
        };
      }
      const info = this.mgr.create(workspaceId, cwd, settings);
      if (!info.running) return { ok: false, reason: `The terminal could not start (exit ${info.exitCode}).` };
      id = info.id;
      this.claims.set(id, { sessionId, userMidLine: false, userTypedSinceRead: false, lastUserInputAt: 0 });
    }

    await this.waitForUserIdle(id);
    this.mgr.write(id, command + "\r");
    return { ok: true, terminalId: id, title: this.mgr.get(id)?.title ?? "" };
  }

  read(sessionId: string, terminalId: string, lines?: number): ReadResult {
    const claim = this.claims.get(terminalId);
    if (!claim || claim.sessionId !== sessionId) {
      return { ok: false, reason: `No terminal '${terminalId}' belongs to this session.` };
    }
    const info = this.mgr.get(terminalId);
    if (!info) return { ok: false, reason: `Terminal '${terminalId}' no longer exists.` };
    const capped = Math.min(Math.max(1, Math.floor(lines ?? MAX_READ_LINES)), MAX_READ_LINES);
    const text = this.mgr.readText(terminalId, capped) ?? "";
    // Reported once, then cleared: the model re-reads because the user touched
    // it, and a flag that never clears would make it re-read forever.
    const userTyped = claim.userTypedSinceRead;
    claim.userTypedSinceRead = false;
    return { ok: true, text, running: info.running, exitCode: info.exitCode, userTyped };
  }

  kill(sessionId: string, terminalId: string): KillResult {
    const claim = this.claims.get(terminalId);
    if (!claim || claim.sessionId !== sessionId) {
      return { ok: false, reason: `No terminal '${terminalId}' belongs to this session.` };
    }
    this.mgr.kill(terminalId);
    this.claims.delete(terminalId);
    return { ok: true };
  }

  /**
   * Every byte the USER typed. Main is the only place that sees both writers,
   * which is what makes the interleave hold possible at all — card and tab
   * route through the same IPC handler.
   */
  noteUserInput(terminalId: string, data: string): void {
    const claim = this.claims.get(terminalId);
    if (!claim) return;
    claim.userTypedSinceRead = true;
    claim.lastUserInputAt = Date.now();
    claim.userMidLine = !LINE_ENDERS.test(data);
  }

  /** Drop this session's claims WITHOUT killing anything — the caller decides. */
  releaseSession(sessionId: string): string[] {
    const owned = this.ownedBy(sessionId);
    for (const id of owned) this.claims.delete(id);
    return owned;
  }

  /**
   * §9's seam, for terminals. Ids and titles only, never output — the point is
   * "here is what you started", one line each, a few dozen tokens, so an agent
   * can still find a dev server it opened three compactions ago.
   */
  buildOpenTerminalsBlock(sessionId: string): string {
    const rows = this.ownedBy(sessionId)
      .map((id) => this.mgr.get(id))
      .filter((i): i is TerminalInfo => !!i)
      .map((i) => `${i.id}\t${i.title}\t${i.running ? "running" : `exited ${i.exitCode}`}`);
    if (!rows.length) return "";
    // Sorted, so an unchanged set renders byte-identically and the change check
    // in ipc.ts can be a plain string comparison (same trick as openFilesChanged).
    return `<open-terminals>\n${rows.sort().join("\n")}\n</open-terminals>`;
  }

  private waitForUserIdle(terminalId: string): Promise<void> {
    const claim = this.claims.get(terminalId);
    if (!claim?.userMidLine) return Promise.resolve();
    const remaining = Math.max(0, HOLD_IDLE_MS - (Date.now() - claim.lastUserInputAt));
    if (remaining === 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
