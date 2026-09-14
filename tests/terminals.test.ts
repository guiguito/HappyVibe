import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { attachWriteErrorHandler, TerminalManager } from "../src/main/terminals";
import { DEFAULT_TERMINAL_SETTINGS } from "../src/main/terminalSettings";

const require_ = createRequire(import.meta.url);
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A POSIX shell on every platform (Git Bash on Windows) — see tests/shellFixture.ts
// for why these tests do not switch to PowerShell syntax.
import { FAST, HAS_POSIX_SHELL } from "./shellFixture";
import { FOREGROUND_SUPPORTED as FOREGROUND, SHELL_NAME } from "./shellFixture";

describe("node-pty packaging", () => {
  // node-pty ships spawn-helper WITHOUT the executable bit through npm, and
  // every pty.spawn then fails with the entirely unhelpful "posix_spawnp
  // failed." — in dev, not only when packaged. scripts/fix-pty-helper.mjs runs
  // from postinstall; this is what stops it being deleted as mysterious.
  it.skipIf(process.platform === "win32")("ships an executable spawn-helper for every prebuilt platform", () => { // no exec bit on NTFS, and conpty ships no helper
    const lib = path.dirname(require_.resolve("node-pty"));
    const prebuilds = path.join(lib, "..", "prebuilds");
    const helpers = fs
      .readdirSync(prebuilds)
      .map((d) => path.join(prebuilds, d, "spawn-helper"))
      .filter((p) => fs.existsSync(p));
    expect(helpers.length).toBeGreaterThan(0);
    for (const helper of helpers) {
      expect(fs.statSync(helper).mode & 0o111, `${helper} is not executable`).toBeTruthy();
    }
  });

  // N-API prebuilds are ABI-stable across Node AND Electron, which is why this
  // test suite can spawn a real PTY at all and why no electron-rebuild step
  // exists. If node-pty ever ships a non-N-API build, this file goes red first.
  it("loads under plain Node, not only under Electron", () => {
    expect(() => require_("node-pty")).not.toThrow();
  });
});

describe("TerminalManager", () => {
  it("runs a command and mirrors its output into the headless buffer", async () => {
    const seen: string[] = [];
    const m = new TerminalManager((_id, d) => seen.push(d), () => {}, () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(700);
      m.write(t.id, "echo HVMANAGER_$((6*7))\n");
      await settle(1500);
      expect(seen.join("")).toMatch(/HVMANAGER_42/);
      // The mirror is fed the same bytes — this is what a re-attaching
      // renderer and part 2's agent read both depend on.
      expect(m.readText(t.id)).toMatch(/HVMANAGER_42/);
      expect(typeof m.snapshot(t.id)).toBe("string");
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("readText returns plain text, with no escape codes", async () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(700);
      m.write(t.id, "printf '\\033[31mRED\\033[0m\\n'\n");
      await settle(1500);
      const text = m.readText(t.id)!;
      expect(text).toMatch(/RED/);
      // eslint-disable-next-line no-control-regex
      expect(text).not.toMatch(/\x1b\[/);
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("reports the foreground process, and null at an idle prompt", async () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(800);
      expect(m.foreground(t.id)).toBeNull();
      m.write(t.id, "sleep 4\n");
      await settle(1200);
      // Windows cannot answer this and says so by staying null (terminals.ts
      // FOREGROUND_SUPPORTED, measured). The assertion is written for BOTH arms
      // rather than skipped, so the Windows contract is covered rather than absent:
      // what must never happen there is a non-null answer, which would mark every
      // terminal permanently busy.
      expect(m.foreground(t.id)).toBe(FOREGROUND ? "sleep" : null);
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("pushes a title change when a command takes the foreground", async () => {
    const titles: string[] = [];
    const m = new TerminalManager(() => {}, () => {}, (_id, t) => titles.push(t));
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      expect(t.title).toBe(SHELL_NAME);
      await settle(800);
      m.write(t.id, "sleep 4\n");
      await settle(1200);
      // On Windows the tab keeps the SHELL's name — there is no foreground source —
      // and the one thing that must never happen is the terminal NAME leaking into
      // the tab, which is what pty.process returns there.
      if (FOREGROUND) expect(titles).toContain("sleep");
      else expect(titles).not.toContain("xterm-256color");
    } finally {
      m.killAll();
    }
  }, 25_000);

  /**
   * §7 round 12 — renaming a tab. The rule needs a REAL pty because the thing a
   * user title has to beat is the 500 ms foreground poll: without precedence,
   * the next command silently takes the tab's name back.
   */
  it("a user title outranks the foreground poll", async () => {
    const titles: string[] = [];
    const m = new TerminalManager(() => {}, () => {}, (_id, t) => titles.push(t));
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(800);
      m.rename(t.id, "build watcher");
      expect(m.get(t.id)!.title).toBe("build watcher");

      // Run something that WOULD retitle the tab, and let several polls pass.
      m.write(t.id, "sleep 4\n");
      await settle(1500);
      expect(m.get(t.id)!.title).toBe("build watcher");
      expect(titles).not.toContain("sleep");
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("renaming to empty returns the tab to following its process", async () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(800);
      m.rename(t.id, "pinned");
      m.rename(t.id, "   ");
      m.write(t.id, "sleep 4\n");
      await settle(1500);
      // The point of the test is that clearing a user title RETURNS the tab to
      // whatever the platform can follow — the command on POSIX, the shell name on
      // Windows. What must not survive is the pinned title.
      expect(m.get(t.id)!.title).toBe(FOREGROUND ? "sleep" : SHELL_NAME);
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("scopes list and kill by workspace, and killAll leaves nothing", async () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    try {
      m.create("ws1", process.cwd(), FAST, 80, 24);
      m.create("ws1", process.cwd(), FAST, 80, 24);
      m.create("ws2", process.cwd(), FAST, 80, 24);
      expect(m.list("ws1")).toHaveLength(2);
      expect(m.list("ws2")).toHaveLength(1);
      expect(m.list()).toHaveLength(3);

      // Removing a workspace kills its terminals — and only its terminals.
      m.killWorkspace("ws1");
      expect(m.list("ws1")).toHaveLength(0);
      expect(m.list("ws2")).toHaveLength(1);

      m.killAll();
      expect(m.list()).toHaveLength(0);
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("a terminal that exits stays listed as not-running rather than vanishing", async () => {
    // §26: show an inert "process exited (code N)" state; never close a tab
    // out from under someone.
    const exits: [string, number][] = [];
    const m = new TerminalManager(() => {}, (id, c) => exits.push([id, c]), () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      await settle(800);
      m.write(t.id, "exit 3\n");
      await settle(1500);
      expect(exits[0]?.[0]).toBe(t.id);
      expect(exits[0]?.[1]).toBe(3);
      const info = m.get(t.id);
      expect(info?.running).toBe(false);
      expect(info?.exitCode).toBe(3);
      expect(m.list("ws1")).toHaveLength(1);
      // …and it must not claim something is still running.
      expect(m.foreground(t.id)).toBeNull();
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("an unspawnable shell yields an inert exited terminal, not a throw", async () => {
    // A bad shell path does NOT throw from pty.spawn — node-pty spawns its
    // helper successfully and the exec fails inside it, surfacing as an
    // immediate non-zero exit. Discovered by this test; the manager routes
    // both that and the throwing case onto one inert state.
    const exits: number[] = [];
    const m = new TerminalManager(() => {}, (_id, c) => exits.push(c), () => {});
    let info!: ReturnType<TerminalManager["create"]>;
    expect(() => {
      info = m.create("ws1", process.cwd(), { ...FAST, shellPath: "/nope/not/a/shell" }, 80, 24);
    }).not.toThrow();
    try {
      await settle(1500);
      expect(exits).toHaveLength(1);
      const after = m.get(info.id);
      expect(after?.running).toBe(false);
      expect(after?.exitCode).not.toBe(0);
      // The message names the path it tried, so a typo is diagnosable instead
      // of being an empty tab with no explanation anywhere.
      expect(m.readText(info.id)).toMatch(/\/nope\/not\/a\/shell/);
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("is total on an unknown id", () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    expect(() => m.write("nope", "x")).not.toThrow();
    expect(() => m.resize("nope", 10, 10)).not.toThrow();
    expect(() => m.kill("nope")).not.toThrow();
    expect(m.snapshot("nope")).toBeNull();
    expect(m.readText("nope")).toBeNull();
    expect(m.foreground("nope")).toBeNull();
    expect(m.get("nope")).toBeNull();
  });

  it("gives every terminal a distinct id", () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    try {
      const ids = new Set([
        m.create("ws1", process.cwd(), FAST).id,
        m.create("ws1", process.cwd(), FAST).id,
        m.create("ws1", process.cwd(), FAST).id,
      ]);
      expect(ids.size).toBe(3);
    } finally {
      m.killAll();
    }
  }, 25_000);
});

describe("the pty write socket is guarded", () => {
  /**
   * A write racing a dying ConPTY fails asynchronously on Windows (`write EAGAIN`).
   * This code runs in MAIN, so uncaught it takes the whole app down over a terminal
   * nobody was watching. node-pty guards its OUTPUT socket and rethrows everything
   * else; the write path uses `_agent.inSocket`, a different socket with no handler.
   *
   * BOTH arms are asserted rather than the win32 one skipped (the windows-skips
   * rule): `_agent` belongs to WindowsPtyAgent and does not exist on a UnixTerminal,
   * whose `_socket` node-pty already guards itself (unixTerminal.js). So off win32
   * the honest answer is "nothing to attach", and asserting it is what stops a
   * future silent true — a handler on a socket that is not the write path.
   *
   * Both halves are pinned because both can rot: the private field can be renamed by
   * a bump, and the reason can be forgotten.
   */
  it("finds node-pty's private write socket where ConPTY has one, and says so where it does not", () => {
    const m = new TerminalManager(() => {}, () => {}, () => {});
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      const entry = (m as unknown as { entries: Map<string, { pty: unknown }> }).entries.get(t.id);
      expect(
        attachWriteErrorHandler(entry?.pty, "probe"),
        process.platform === "win32"
          ? "node-pty renamed _agent.inSocket"
          : "a UnixTerminal has no _agent — node-pty guards its own _socket",
      ).toBe(process.platform === "win32");
    } finally {
      m.killAll();
    }
  });

  it("says so rather than throwing when the shape is gone", () => {
    expect(attachWriteErrorHandler({}, "x")).toBe(false);
    expect(attachWriteErrorHandler(null, "x")).toBe(false);
  });
});
