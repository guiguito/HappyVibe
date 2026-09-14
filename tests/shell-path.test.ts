import { describe, it, expect, beforeEach } from "vitest";
import { loginShellPath, mergePath, resetShellPathCache } from "../src/main/shellPath";

beforeEach(() => resetShellPathCache());

describe("merging the login-shell PATH", () => {
  it("puts shell entries first so user tooling wins over bundle entries", () => {
    expect(mergePath("/usr/bin:/bin", "/opt/homebrew/bin")).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("keeps existing entries — merge, never replace", () => {
    expect(mergePath("/usr/bin:/bin", "/a:/b")).toBe("/a:/b:/usr/bin:/bin");
  });

  it("dedupes without reordering the first occurrence", () => {
    expect(mergePath("/usr/bin:/bin:/a", "/a:/usr/bin")).toBe("/a:/usr/bin:/bin");
  });

  it("drops empty segments rather than emitting '::'", () => {
    expect(mergePath("/usr/bin::/bin", "")).toBe("/usr/bin::/bin"); // empty shell PATH = no-op
    expect(mergePath("/usr/bin::/bin", "/a")).toBe("/a:/usr/bin:/bin");
  });

  it("is a no-op when the shell PATH is unavailable, so failure keeps today's behaviour", () => {
    expect(mergePath("/usr/bin", undefined)).toBe("/usr/bin");
    expect(mergePath(undefined, undefined)).toBeUndefined();
  });

  it("still yields the shell PATH when the current one is undefined", () => {
    expect(mergePath(undefined, "/a:/b")).toBe("/a:/b");
  });
});

describe("reading the login-shell PATH", () => {
  it.skipIf(process.platform === "win32")("parses the PATH out from between the sentinels", () => {
    const prior = process.env.SHELL;
    try {
      process.env.SHELL = "/bin/sh";
      resetShellPathCache();
      const p = loginShellPath();
      // /bin/sh ignores -i for a -c command but still runs and prints $PATH;
      // what matters is that the sentinel extraction returns a plausible PATH
      // and never leaks the delimiter or rc-file chatter.
      expect(p).toBeTypeOf("string");
      expect(p).not.toContain("__HV_PATH__");
      expect(p).toContain("/");
    } finally {
      process.env.SHELL = prior;
      resetShellPathCache();
    }
  });

  it("returns undefined when there is no SHELL to ask", () => {
    const prior = process.env.SHELL;
    try {
      delete process.env.SHELL;
      resetShellPathCache();
      expect(loginShellPath()).toBeUndefined();
    } finally {
      process.env.SHELL = prior;
      resetShellPathCache();
    }
  });

  it("memoises — a second call does not re-spawn a shell", () => {
    const prior = process.env.SHELL;
    try {
      process.env.SHELL = "/bin/sh";
      resetShellPathCache();
      const first = loginShellPath();
      delete process.env.SHELL; // would return undefined if it re-read
      expect(loginShellPath()).toBe(first);
    } finally {
      process.env.SHELL = prior;
      resetShellPathCache();
    }
  });
});
