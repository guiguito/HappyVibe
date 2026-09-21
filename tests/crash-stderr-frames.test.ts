import { describe, expect, it } from "vitest";
import { piErrorType, piFrames } from "../src/main/crash/stderrFrames";

describe("§37 piFrames — only what is ours, and never an absolute path", () => {
  it("reports a bundle frame relative to the app root", () => {
    const f = piFrames(["    at runTool (/Users/alice/dev/hv/out/main/index.js:120:9)"]);
    expect(f).toEqual([{ function: "runTool", file: "out/main/index.js", line: 120, col: 9, inApp: true }]);
  });

  it("the SAME file reports the same path in dev and packaged", () => {
    // This is what lets one fingerprint cover both builds and what makes a
    // source map apply. `app.asar` is admitted but is never the root when a
    // more specific marker follows it.
    const dev = piFrames(["    at f (/Users/alice/repo/out/main/index.js:1:2)"])[0];
    const packaged = piFrames(["    at f (/Applications/HappyVibe.app/Contents/Resources/app.asar/out/main/index.js:1:2)"])[0];
    expect(dev.file).toBe("out/main/index.js");
    expect(packaged.file).toBe(dev.file);
  });

  it("prefers pi-runtime over a nested out/, so the context is not lost", () => {
    const f = piFrames(["    at g (/A/Resources/pi-runtime/node_modules/foo/out/bar.js:3:4)"]);
    expect(f[0].file).toBe("pi-runtime/node_modules/foo/out/bar.js");
  });

  it("drops a frame outside the bundle — a user's own extension is a user's file", () => {
    expect(piFrames(["    at evil (/Users/alice/.pi/extensions/mine.ts:1:1)"])).toEqual([]);
    expect(piFrames(["    at x (/Users/alice/project/src/app.ts:1:1)"])).toEqual([]);
  });

  it("`out` must be a whole path segment — /Users/checkout/ is a home directory", () => {
    expect(piFrames(["    at x (/Users/checkout/thing.js:1:1)"])).toEqual([]);
    expect(piFrames(["    at x (/Users/me/layout/x.js:1:1)"])).toEqual([]);
  });

  it("a message line yields no frame at all", () => {
    // The whole privacy line: the sentence after the colon is where a path, a
    // prompt or a key would be, and it must not become a `file`.
    expect(piFrames(["Error: cannot open /Users/alice/out/secret.txt with token sk-123"])).toEqual([]);
  });

  it("handles an anonymous frame and caps the list", () => {
    expect(piFrames(["    at /repo/out/main/index.js:5:6"])).toEqual([
      { file: "out/main/index.js", line: 5, col: 6, inApp: true },
    ]);
    const many = Array.from({ length: 80 }, (_, i) => `    at f${i} (/repo/out/a.js:${i + 1}:1)`);
    expect(piFrames(many)).toHaveLength(30);
  });

  it("serialised output never contains a home directory", () => {
    const out = JSON.stringify(
      piFrames([
        "Error: nope",
        "    at a (/Users/alice/dev/hv/out/main/index.js:1:1)",
        "    at b (/Users/alice/.pi/extensions/x.ts:2:2)",
        "    at c (/Users/alice/dev/hv/pi-runtime/node_modules/pi/dist/y.js:3:3)",
      ]),
    );
    expect(out).not.toContain("/Users/");
    expect(out).not.toContain("alice");
  });
});

describe("§37 piErrorType — a CLASS, never a message", () => {
  it("finds the first error class", () => {
    expect(piErrorType(["some noise", "TypeError: x is not a function", "ReferenceError: y"])).toBe("TypeError");
  });

  it("returns nothing but the class — the message never leaves", () => {
    const t = piErrorType(["RangeError: /Users/alice/secret.txt is out of range"]);
    expect(t).toBe("RangeError");
    expect(t).not.toContain("/Users/");
  });

  it("answers PiExit when the child left no error shape", () => {
    // Which is ALSO the signal that this exit is probably not ours — a bad key,
    // an empty account and a killed terminal all land here. The call site
    // requires a frame before it reports anything, for exactly that reason.
    expect(piErrorType(["402 Insufficient Balance"])).toBe("PiExit");
    expect(piErrorType([])).toBe("PiExit");
  });
});
