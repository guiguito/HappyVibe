import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { TerminalManager } from "../src/main/terminals";
import { DEFAULT_TERMINAL_SETTINGS } from "../src/main/terminalSettings";

const require_ = createRequire(import.meta.url);
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `-f` skips the user's rc files, so a test does not depend on someone's dotfiles. */
const FAST = { ...DEFAULT_TERMINAL_SETTINGS, shellArgs: ["-f"], shellPath: "/bin/zsh" };

describe("node-pty packaging", () => {
  // node-pty ships spawn-helper WITHOUT the executable bit through npm, and
  // every pty.spawn then fails with the entirely unhelpful "posix_spawnp
  // failed." — in dev, not only when packaged. scripts/fix-pty-helper.mjs runs
  // from postinstall; this is what stops it being deleted as mysterious.
  it("ships an executable spawn-helper for every prebuilt platform", () => {
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
      expect(m.foreground(t.id)).toBe("sleep");
    } finally {
      m.killAll();
    }
  }, 25_000);

  it("pushes a title change when a command takes the foreground", async () => {
    const titles: string[] = [];
    const m = new TerminalManager(() => {}, () => {}, (_id, t) => titles.push(t));
    const t = m.create("ws1", process.cwd(), FAST, 80, 24);
    try {
      expect(t.title).toBe("zsh");
      await settle(800);
      m.write(t.id, "sleep 4\n");
      await settle(1200);
      expect(titles).toContain("sleep");
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
      expect(m.get(t.id)!.title).toBe("sleep");
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
