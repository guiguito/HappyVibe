import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { NdjsonDecoder, encodeCommand } from "./codec";
import { platform } from "../platform";
import type { PiResponse } from "./types";

interface SpawnSpec { execPath: string; args: string[]; env: Record<string, string>; cwd: string }
type Pending = { resolve: (r: PiResponse) => void; reject: (e: Error) => void };

/** How much of the child's stderr is kept for a crash report. */
const STDERR_KEEP_LINES = 40;
const TAIL_LINES = 8;
const TAIL_CHARS = 600;

/**
 * The part of a dead child's stderr worth showing a human.
 *
 * A Pi child that dies during module load used to leave the user a bare
 * "The session crashed (code 1)" and a Restart button, while the sentence that
 * explained it — e.g. `SyntaxError: Unexpected token 'with'` — went to
 * console.error and no further. The app knew and showed a number.
 *
 * The tail is taken rather than summarised, deliberately: the interesting line
 * is in a different place for every class of failure (a syntax error names
 * itself, a missing binary is an ENOENT, an OOM says nothing at all), and a
 * heuristic that guessed would sometimes hide the one line that mattered.
 * Blank lines go, so the cap buys real content rather than spacing.
 */
export function stderrTail(
  lines: readonly string[],
  maxLines = TAIL_LINES,
  maxChars = TAIL_CHARS,
): string {
  const kept = lines.map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  const text = kept.slice(-maxLines).join("\n");
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

export class PiClient extends EventEmitter {
  private child?: ChildProcess;
  private decoder = new NdjsonDecoder();
  private pending = new Map<string, Pending>();
  private seq = 0;
  /** Recent stderr, for the crash report. Bounded — see STDERR_KEEP_LINES. */
  private stderrLines: string[] = [];

  constructor(private spec: SpawnSpec) { super(); }

  /** OS pid of the Pi subprocess (for persisted pid tracking / orphan sweep). */
  get pid(): number | undefined { return this.child?.pid; }

  async start(): Promise<void> {
    this.child = spawn(this.spec.execPath, this.spec.args, {
      cwd: this.spec.cwd, env: this.spec.env, stdio: ["pipe", "pipe", "pipe"],
      // Windows: without this every session pops a console window for a moment.
      windowsHide: true,
    });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => {
      for (const msg of this.decoder.push(chunk)) this.route(msg as Record<string, unknown>);
    });
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (d: string) => {
      console.error("[pi:stderr]", d.trim());
      // Bounded ring: a chatty or looping child must not grow this without end.
      for (const line of d.split("\n")) this.stderrLines.push(line);
      if (this.stderrLines.length > STDERR_KEEP_LINES) {
        this.stderrLines.splice(0, this.stderrLines.length - STDERR_KEEP_LINES);
      }
    });
    this.child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error("pi exited"));
      this.pending.clear();
      // Carried on the exit event so a crash can say WHY, not just a number.
      // §37: the TAIL is the human-readable cause and stays local (the
      // `session.crash` row). The full ring goes too, for frame extraction
      // only — `stderrTail` is 8 lines and a stack is longer than that, so
      // reporting from the tail would find no frames at all.
      this.emit("exit", { code, stderr: stderrTail(this.stderrLines), stderrLines: [...this.stderrLines] });
    });
  }

  private route(msg: Record<string, unknown>): void {
    if (msg.type === "response" && typeof msg.id === "string" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      p.resolve(msg as unknown as PiResponse);
    } else if (msg.type === "extension_ui_request") {
      this.emit("ui-request", msg);
    } else {
      this.emit("event", msg);
    }
  }

  send(cmd: { type: string; [k: string]: unknown }): Promise<PiResponse> {
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(encodeCommand({ id, ...cmd }));
    });
  }

  // Field names must match docs/validation/d1.md (observed wire shape).
  respondUi(id: string, payload: object): void {
    this.child!.stdin!.write(encodeCommand({ type: "extension_ui_response", id, ...payload }));
  }

  /**
   * PRD §4 (Windows round): the tree, not the process.
   *
   * `child.kill()` is TerminateProcess on Windows, which runs no handler — so Pi's
   * own SIGTERM path and its killTrackedDetachedChildren() never happen, and every
   * running bash command and stdio MCP server outlives the session. Hibernation and
   * MCP live-reload both come through here, so that is an orphan per reload.
   *
   * No grace period before /F, measured rather than assumed: Pi appends its session
   * file with appendFileSync, so nothing already written is lost, and its own SIGTERM
   * branch deliberately skips the stdout flush anyway.
   */
  stop(): void {
    const pid = this.child?.pid;
    if (pid !== undefined) platform.killTree(pid);
    else this.child?.kill();
  }
}
