import { describe, expect, it } from "vitest";
import { rendererAppRoot } from "../src/renderer/src/crashRoot";

describe("§37 rendererAppRoot", () => {
  it("under file: it is the directory the page loaded from, not `file://`", () => {
    // The SDK's browser default is `location.origin`, which under file: is the
    // useless string "file://" — every packaged frame would be `<external>`.
    expect(
      rendererAppRoot({
        protocol: "file:",
        origin: "file://",
        pathname: "/Applications/HappyVibe.app/Contents/Resources/app.asar/out/renderer/index.html",
      }),
    ).toBe("/Applications/HappyVibe.app/Contents/Resources/app.asar/out/renderer");
  });

  it("over http it is the origin, which is already right", () => {
    expect(rendererAppRoot({ protocol: "http:", origin: "http://localhost:5173", pathname: "/index.html" }))
      .toBe("http://localhost:5173");
  });

  it("never yields a home directory in either mode", () => {
    // In dev the page is SERVED, so the repo path is not in `location` at all;
    // packaged, the root is under /Applications. Both are asserted because a
    // future change that read `__dirname` here would leak the build machine.
    for (const loc of [
      { protocol: "http:", origin: "http://localhost:5173", pathname: "/index.html" },
      { protocol: "file:", origin: "file://", pathname: "/Applications/HappyVibe.app/Contents/Resources/app.asar/out/renderer/index.html" },
    ]) {
      expect(rendererAppRoot(loc)).not.toContain("/Users/");
    }
  });

  it("a pathname with no directory degrades to itself rather than to empty", () => {
    expect(rendererAppRoot({ protocol: "file:", origin: "file://", pathname: "/index.html" })).toBe("/index.html");
  });
});
