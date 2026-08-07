import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_SETTINGS,
  mergeTerminalSettings,
  resolveSpawn,
} from "../src/main/terminalSettings";

describe("terminal settings defaults", () => {
  it("match the §26 tables", () => {
    const d = DEFAULT_TERMINAL_SETTINGS;
    expect(d.style).toBe("workshop");
    expect(d.fontSize).toBe(13);
    expect(d.lineHeight).toBe(1.4);
    expect(d.letterSpacing).toBe(0);
    expect(d.cursorStyle).toBe("bar");
    expect(d.cursorBlink).toBe(true);
    expect(d.minimumContrastRatio).toBe(4.5);
    expect(d.shellPath).toBeNull();
    expect(d.shellArgs).toEqual(["-l"]);
    expect(d.env).toEqual({});
    expect(d.scrollback).toBe(5000);
    expect(d.copyOnSelect).toBe(false);
    expect(d.rightClickPastes).toBe(false);
    expect(d.warnMultilinePaste).toBe(true);
    expect(d.confirmCloseRunning).toBe(true);
    expect(d.bell).toBe("visual");
  });
});

describe("mergeTerminalSettings", () => {
  it("fills every gap", () => {
    expect(mergeTerminalSettings(undefined)).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(mergeTerminalSettings({})).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(mergeTerminalSettings({ fontSize: 15 })).toEqual({
      ...DEFAULT_TERMINAL_SETTINGS,
      fontSize: 15,
    });
  });

  it("keeps false and 0, which a naive `??` chain would discard", () => {
    const m = mergeTerminalSettings({ cursorBlink: false, letterSpacing: 0, scrollback: 0 });
    expect(m.cursorBlink).toBe(false);
    expect(m.letterSpacing).toBe(0);
    expect(m.scrollback).toBe(0);
  });

  it("clamps and rejects junk rather than handing it to xterm", () => {
    // config.json is hand-editable; a fontSize of 0 reaches the constructor.
    const bad = mergeTerminalSettings({
      style: "neon" as never,
      fontSize: 0,
      lineHeight: 99,
      scrollback: -1,
      minimumContrastRatio: 500,
      cursorStyle: "spinner" as never,
      bell: "explode" as never,
      shellArgs: [1, 2] as never,
      env: { GOOD: "1", BAD: 5 as never, "": "x" },
    });
    expect(bad.style).toBe("workshop");
    expect(bad.fontSize).toBe(6);
    expect(bad.lineHeight).toBe(3);
    expect(bad.scrollback).toBe(0);
    expect(bad.minimumContrastRatio).toBe(21);
    expect(bad.cursorStyle).toBe("bar");
    expect(bad.bell).toBe("visual");
    expect(bad.shellArgs).toEqual(["-l"]);
    expect(bad.env).toEqual({ GOOD: "1" });
  });

  it("treats a blank shell path as 'use the login shell'", () => {
    expect(mergeTerminalSettings({ shellPath: "   " }).shellPath).toBeNull();
    expect(mergeTerminalSettings({ shellPath: " /bin/sh " }).shellPath).toBe("/bin/sh");
  });
});

describe("resolveSpawn", () => {
  const d = DEFAULT_TERMINAL_SETTINGS;

  it("prefers the configured shell, then $SHELL, then /bin/zsh", () => {
    expect(resolveSpawn(d, { SHELL: "/bin/bash" }).file).toBe("/bin/bash");
    expect(resolveSpawn(d, {}).file).toBe("/bin/zsh");
    expect(resolveSpawn({ ...d, shellPath: "/bin/sh" }, { SHELL: "/bin/bash" }).file).toBe("/bin/sh");
  });

  it("passes the shell arguments through", () => {
    expect(resolveSpawn(d, {}).args).toEqual(["-l"]);
    expect(resolveSpawn({ ...d, shellArgs: [] }, {}).args).toEqual([]);
  });

  it("merges extra env OVER the inherited env", () => {
    const r = resolveSpawn({ ...d, env: { FOO: "2" } }, { FOO: "1", BAR: "3" });
    expect(r.env.FOO).toBe("2");
    expect(r.env.BAR).toBe("3");
  });

  it("forces TERM last, so a stale inherited value cannot win", () => {
    // xterm.js IS xterm-256color. Inheriting "dumb" from a launchd env would
    // give a shell that renders none of the colours it is being sent.
    expect(resolveSpawn(d, { TERM: "dumb" }).env.TERM).toBe("xterm-256color");
    expect(resolveSpawn({ ...d, env: { TERM: "dumb" } }, {}).env.TERM).toBe("xterm-256color");
  });

  it("drops undefined inherited values instead of stringifying them", () => {
    const r = resolveSpawn(d, { GOOD: "1", GONE: undefined });
    expect(r.env.GOOD).toBe("1");
    expect("GONE" in r.env).toBe(false);
  });
});
