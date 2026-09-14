/**
 * §26 — PTYs are owned by MAIN. The renderer is a view.
 *
 * Each terminal is a node-pty process PLUS an `@xterm/headless` mirror fed the
 * same bytes. The mirror is the scrollback buffer, and it is a headless
 * terminal rather than a raw byte ring because it serves three readers and
 * only one of them wants bytes:
 *
 *   - the LIVE renderer          → raw bytes, straight to term.write()
 *   - a RE-ATTACHING renderer    → snapshot(), i.e. addon-serialize, which
 *                                  repaints correctly even mid-TUI where a
 *                                  replayed byte ring shows noise until the
 *                                  program next redraws
 *   - (part 2) the agent's read  → readText(), the rendered grid as plain
 *                                  text, cursor-addressed output already
 *                                  resolved. strip-ansi over a raw ring turns
 *                                  a \r-rewriting progress bar into gibberish.
 *
 * node-pty is required LAZILY, inside create(), so importing this module never
 * loads a native binding — the same electron-free discipline as pi/spawn.ts.
 */

import path from "node:path";
import { platform } from "./platform";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { resolveSpawn, type TerminalSettings } from "./terminalSettings";

export interface TerminalInfo {
  id: string;
  workspaceId: string;
  /** The foreground command, else the shell name. What the tab strip shows. */
  title: string;
  running: boolean;
  exitCode: number | null;
}

/** The slice of node-pty we use. Declared so this file needs no @types shim. */
interface Pty {
  readonly pid: number;
  readonly process: string;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

interface Entry {
  info: TerminalInfo;
  pty: Pty | null;
  mirror: Terminal;
  serializer: SerializeAddon;
  /** The basename of the spawned shell — how we tell "idle" from "running". */
  shellName: string;
  /** The command line we tried, for the diagnostic on a failed spawn. */
  file: string;
  /** Did this terminal ever emit a byte? Distinguishes "died" from "ran". */
  sawData: boolean;
  /** §7 round 12: a name the user typed. Beats the foreground-process poll;
   *  cleared by renaming to "", which returns the tab to following the command.
   *  Not on TerminalInfo — the renderer reads one `title`, whoever won it. */
  userTitle?: string;
}

let seq = 0;

/**
 * How often the foreground process is re-read.
 *
 * It has to be POLLED, and that is not laziness: `pty.process` changes with no
 * corresponding data event, so a purely event-driven title misses the whole
 * interesting case. `sleep 30` prints nothing at all — the first version of
 * this file updated titles inside onData and reported `zsh` for the entire run.
 */
const TITLE_POLL_MS = 500;

/**
 * Can `pty.process` name the foreground command on this platform? (PRD §4, Windows
 * round — measured, not assumed.)
 *
 * On Unix node-pty asks the OS for the tty's foreground process. On Windows the
 * getter is literally `return this._name` — the `name` option we pass at spawn — so
 * it answers the constant "xterm-256color" whether the shell is idle or running
 * something. Two consequences if believed: every Windows tab is titled
 * "xterm-256color", and `foreground()` never returns null, so every terminal reads as
 * permanently busy.
 *
 * There is no second source. Walking the Win32 process tree was measured in a real
 * Electron process: `pty.pid` is the ConPTY host, its only descendant is the shell,
 * and a command run under Git Bash never appears as a child at all (MSYS re-parents)
 * — while the query itself costs ~900 ms, far past a 500 ms poll.
 *
 * So on Windows the tab follows the SHELL name, and "is something running" is
 * unanswerable. Both degrade to a quieter UI rather than a wrong one.
 */
const FOREGROUND_SUPPORTED = !platform.isWindows;

/**
 * node-pty's write socket, which upstream leaves unguarded (see the call site).
 * Shaped as "whatever is there", because none of it is public API.
 */
interface PtyInternals {
  _agent?: { inSocket?: { on?: (event: string, cb: (err: Error) => void) => void } };
}

/** True when the private write socket was found and a handler attached. */
export function attachWriteErrorHandler(child: unknown, id: string): boolean {
  const sock = (child as PtyInternals)?._agent?.inSocket;
  if (typeof sock?.on !== "function") return false;
  sock.on("error", (err: Error) => {
    // Nothing to recover: the pty is going away. Log so a real pipe problem is
    // visible, and swallow so main survives it.
    console.error("[terminal] pty write error", id, err?.message ?? err);
  });
  return true;
}

export class TerminalManager {
  private readonly entries = new Map<string, Entry>();
  private poll: NodeJS.Timeout | null = null;

  constructor(
    private readonly onData: (id: string, data: string) => void,
    private readonly onExit: (id: string, code: number) => void,
    private readonly onTitle: (id: string, title: string) => void,
  ) {}

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      for (const entry of this.entries.values()) {
        if (!entry.pty) continue;
        const next = this.titleOf(entry);
        if (next !== entry.info.title) {
          entry.info.title = next;
          this.onTitle(entry.info.id, next);
        }
      }
    }, TITLE_POLL_MS);
    // Never hold the process open for a title.
    this.poll.unref?.();
  }

  private stopPollingIfIdle(): void {
    if (this.poll && ![...this.entries.values()].some((e) => e.pty)) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  create(
    workspaceId: string,
    cwd: string,
    settings: TerminalSettings,
    cols = 80,
    rows = 24,
  ): TerminalInfo {
    // Lazy: keeps the module importable without the native binding.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pty = require("node-pty") as {
      spawn: (
        file: string,
        args: string[],
        opts: {
          name: string;
          cols: number;
          rows: number;
          cwd: string;
          env: Record<string, string>;
          useConpty?: boolean;
        },
      ) => Pty;
    };

    const { file, args, env } = resolveSpawn(settings, process.env, platform);
    const id = `t${++seq}-${Date.now().toString(36)}`;
    const shellName = path.basename(file);

    const mirror = new Terminal({
      cols,
      rows,
      scrollback: settings.scrollback,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    mirror.loadAddon(serializer);

    const info: TerminalInfo = {
      id,
      workspaceId,
      title: shellName,
      running: true,
      exitCode: null,
    };

    const entry: Entry = { info, pty: null, mirror, serializer, shellName, file, sawData: false };
    this.entries.set(id, entry);

    let child: Pty;
    try {
      // useConpty is the default on Windows >= 1809, and is stated because it is
      // load-bearing: the winpty fallback renders a TUI wrong, and `pty.process`
      // (which the title poll reads) only reports the real foreground under ConPTY.
      child = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env, useConpty: true });
    } catch (err) {
      // Some failures throw here (an unreadable cwd), and some do not — a bad
      // shell PATH does not: node-pty's posix path spawns its helper fine and
      // the exec fails inside it, surfacing as an immediate non-zero exit.
      // Both routes have to land on the same inert state, so this branch and
      // the onExit one below share `fail()`.
      this.fail(entry, err instanceof Error ? err.message : String(err));
      return entry.info;
    }

    entry.pty = child;
    this.startPolling();

    // A write racing a dying ConPTY fails ASYNCHRONOUSLY on Windows (`write EAGAIN`,
    // from the socket's completion callback). Uncaught, that is not a broken terminal
    // — it is the whole app going down because a terminal nobody was watching went
    // away, since this runs in MAIN.
    //
    // node-pty's own `error` handler does not cover it: it guards the OUTPUT socket
    // (`_socket`), and `terminal.on("error")` forwards there too — but writes go to
    // `_agent.inSocket`, a different socket with no handler at all (measured; the two
    // are not the same object). So the listener has to go on that one.
    //
    // Private field, reached deliberately and pinned by tests/terminals.test.ts, so a
    // node-pty bump that renames it fails loudly instead of quietly restoring a crash.
    attachWriteErrorHandler(child, id);

    child.onData((data) => {
      entry.sawData = true;
      mirror.write(data);
      this.onData(id, data);
    });

    child.onExit(({ exitCode }) => {
      entry.info.running = false;
      entry.info.exitCode = exitCode;
      entry.pty = null;
      this.stopPollingIfIdle();
      // A shell that dies without ever printing a byte did not "exit" — it
      // never started. §26 wants the path it tried named, because otherwise a
      // typo'd shell path is an empty tab with no explanation anywhere.
      if (exitCode !== 0 && !entry.sawData) {
        mirror.write(`\r\n\x1b[31mCould not start ${file} (exit ${exitCode})\x1b[0m\r\n`);
      }
      this.onExit(id, exitCode);
    });

    return info;
  }

  /** Land a terminal that never started on the same inert state as one that exited. */
  private fail(entry: Entry, message: string): void {
    entry.info.running = false;
    entry.info.exitCode = -1;
    entry.pty = null;
    entry.mirror.write(`\r\n\x1b[31mCould not start ${entry.file}: ${message}\x1b[0m\r\n`);
    queueMicrotask(() => this.onExit(entry.info.id, -1));
  }

  private titleOf(entry: Entry): string {
    // §7 round 12: a name the user typed OUTRANKS the poller. Without this the
    // 500 ms tick above would take the tab's name back on the next command.
    if (entry.userTitle) return entry.userTitle;
    if (!FOREGROUND_SUPPORTED) return entry.shellName;
    const fg = entry.pty?.process;
    return typeof fg === "string" && fg.length > 0 ? fg : entry.shellName;
  }

  /**
   * Rename a terminal tab. An empty name RETURNS it to following its foreground
   * process, so the rename is undoable without a second control.
   */
  rename(id: string, title: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.userTitle = title.trim() || undefined;
    const next = this.titleOf(entry);
    if (next === entry.info.title) return;
    entry.info.title = next;
    this.onTitle(id, next);
  }

  write(id: string, data: string): void {
    const entry = this.entries.get(id);
    // A write to a pty whose shell has already exited throws, and on Windows it
    // throws ASYNCHRONOUSLY (`write EAGAIN`, from the socket's completion callback)
    // — uncaught, that takes the main process down over a terminal nobody is
    // watching any more. The `running` check covers the ordinary race (the shell
    // exited a moment ago); the catch covers the pipe breaking under the write.
    if (!entry?.pty || !entry.info.running) return;
    try {
      entry.pty.write(data);
    } catch {
      /* the pty died between the check and the write */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const c = Math.max(1, Math.floor(cols));
    const r = Math.max(1, Math.floor(rows));
    entry.mirror.resize(c, r);
    // A resize on a dead pty throws on some platforms; the mirror still needs it.
    try {
      entry.pty?.resize(c, r);
    } catch {
      /* the process is gone — the buffer is still worth resizing */
    }
  }

  /** addon-serialize output: replays this buffer into a fresh emulator. */
  snapshot(id: string): string | null {
    const entry = this.entries.get(id);
    return entry ? entry.serializer.serialize() : null;
  }

  /**
   * The rendered grid as plain text, newest `lines` rows. No escape codes.
   * Part 2's `terminal_read` is the caller this exists for.
   */
  readText(id: string, lines = 200): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const buf = entry.mirror.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const start = Math.max(0, end - lines + 1);
    const out: string[] = [];
    for (let i = start; i <= end; i++) {
      out.push(buf.getLine(i)?.translateToString(true) ?? "");
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n");
  }

  /**
   * The foreground process, or null when it is just the shell sitting at a
   * prompt. What "is something still running?" means for the close confirm,
   * and node-pty is the only thing that can answer it — knowing whether you
   * are at a prompt is otherwise unsolvable without shell integration.
   */
  foreground(id: string): string | null {
    const entry = this.entries.get(id);
    if (!entry?.pty) return null;
    // Windows cannot answer this — see FOREGROUND_SUPPORTED. Returning null means
    // "at a prompt", which is the fail-OPEN direction on purpose: the alternative,
    // `pty.process`'s constant "xterm-256color", is !== shellName and would report
    // EVERY Windows terminal as permanently busy — the close confirm always warning
    // and the agent never able to reuse a terminal, filling its cap of 3 for good.
    if (!FOREGROUND_SUPPORTED) return null;
    const fg = entry.pty.process;
    return typeof fg === "string" && fg.length > 0 && fg !== entry.shellName ? fg : null;
  }

  get(id: string): TerminalInfo | null {
    return this.entries.get(id)?.info ?? null;
  }

  list(workspaceId?: string): TerminalInfo[] {
    const all = [...this.entries.values()].map((e) => e.info);
    return workspaceId === undefined ? all : all.filter((i) => i.workspaceId === workspaceId);
  }

  /** Closing a terminal tab kills its PTY — a terminal tab IS its terminal. */
  kill(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      entry.pty?.kill();
    } catch {
      /* already gone */
    }
    entry.pty = null;
    entry.mirror.dispose();
    this.entries.delete(id);
    this.stopPollingIfIdle();
  }

  killWorkspace(workspaceId: string): void {
    for (const info of this.list(workspaceId)) this.kill(info.id);
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id);
  }
}
