import { describe, expect, it } from "vitest";
import {
  containsPath,
  foldCase,
  isAbsolutePath,
  stripTrailingSep,
  toPosix,
} from "../pi-runtime/extensions/hv-paths";

/**
 * PRD §4 (Windows round), key-free and pure.
 *
 * On Windows a workspace is `C:\ws`, git answers `C:/ws`, the model writes either,
 * and the filesystem is case-insensitive — four spellings of the same yes. Every
 * layer that asks "is this inside the workspace" has to agree, or a permission rule
 * silently stops applying while still reading correctly on the Permissions page.
 */
describe("toPosix", () => {
  it("normalises backslashes and keeps the drive letter", () => {
    expect(toPosix("C:\\Users\\G\\ws\\src\\a.ts")).toBe("C:/Users/G/ws/src/a.ts");
    expect(toPosix("/Users/g/ws")).toBe("/Users/g/ws");
  });

  it("collapses repeated separators but preserves a UNC prefix", () => {
    expect(toPosix("C:\\ws\\\\src")).toBe("C:/ws/src");
    expect(toPosix("\\\\server\\share\\x")).toBe("//server/share/x");
  });
});

describe("isAbsolutePath", () => {
  it("accepts posix, drive-letter and UNC roots", () => {
    expect(isAbsolutePath("/x")).toBe(true);
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("c:/x")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
  });

  it("rejects relative — including DRIVE-relative, which is a different thing", () => {
    expect(isAbsolutePath("x/y")).toBe(false);
    expect(isAbsolutePath("./x")).toBe(false);
    // `C:x` means "the cwd on drive C", not the root of C.
    expect(isAbsolutePath("C:x")).toBe(false);
  });
});

describe("stripTrailingSep", () => {
  it("drops trailing separators without eating a root", () => {
    expect(stripTrailingSep("C:\\ws\\")).toBe("C:\\ws");
    expect(stripTrailingSep("/tmp/ws//")).toBe("/tmp/ws");
    expect(stripTrailingSep("/")).toBe("/");
  });
});

describe("foldCase", () => {
  it("is identity unless the caller asks", () => {
    expect(foldCase("AbC", false)).toBe("AbC");
    expect(foldCase("AbC", true)).toBe("abc");
  });
});

describe("containsPath", () => {
  it("is exact-root-or-child", () => {
    expect(containsPath("/tmp/ws", "/tmp/ws", false)).toBe(true);
    expect(containsPath("/tmp/ws", "/tmp/ws/a/b.ts", false)).toBe(true);
  });

  it("is never a bare startsWith", () => {
    // The whole reason this is a function: /tmp/ws-evil must not read as inside /tmp/ws.
    expect(containsPath("/tmp/ws", "/tmp/ws-evil/a", false)).toBe(false);
    expect(containsPath("C:\\Users\\G\\ws", "C:\\Users\\G\\ws2\\a.ts", true)).toBe(false);
  });

  it("folds separators and case when the caller says win32", () => {
    expect(containsPath("C:\\Users\\G\\ws", "c:/users/g/WS/src/a.ts", true)).toBe(true);
    expect(containsPath("C:/Users/G/ws", "C:\\Users\\G\\ws\\src\\a.ts", true)).toBe(true);
  });

  it("does NOT fold case when the caller says posix", () => {
    expect(containsPath("/tmp/ws", "/tmp/WS/a", false)).toBe(false);
  });

  it("ignores trailing separators on either side", () => {
    expect(containsPath("/tmp/ws/", "/tmp/ws", false)).toBe(true);
    expect(containsPath("C:\\ws\\", "C:\\ws\\a\\", true)).toBe(true);
  });

  it("treats the filesystem root as containing everything", () => {
    expect(containsPath("/", "/anything/at/all", false)).toBe(true);
  });
});

describe("the module stays import-free", () => {
  it("imports nothing, because the renderer loads it too", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "pi-runtime", "extensions", "hv-paths.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
  });
});
