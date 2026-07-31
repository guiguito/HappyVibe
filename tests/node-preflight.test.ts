import { describe, it, expect, beforeEach } from "vitest";
import { hasNodeRuntime, resetNodeRuntimeCache } from "../src/main/nodePreflight";

beforeEach(() => resetNodeRuntimeCache());

describe("node preflight", () => {
  it("returns a boolean", () => {
    expect(typeof hasNodeRuntime()).toBe("boolean");
  });

  it("finds node when PATH contains it (this test runs under node)", () => {
    expect(hasNodeRuntime()).toBe(true);
  });

  it("reports false when PATH is empty", () => {
    const prior = process.env.PATH;
    try {
      process.env.PATH = "";
      resetNodeRuntimeCache();
      expect(hasNodeRuntime()).toBe(false);
    } finally {
      process.env.PATH = prior;
      resetNodeRuntimeCache();
    }
  });

  it("memoises — a second call does not re-probe", () => {
    const first = hasNodeRuntime();
    const prior = process.env.PATH;
    try {
      process.env.PATH = ""; // would flip the answer if it re-probed
      expect(hasNodeRuntime()).toBe(first);
    } finally {
      process.env.PATH = prior;
    }
  });
});
