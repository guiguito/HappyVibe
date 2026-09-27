import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { forgetSessionFeatures, setUsageSink, track, trackFeature } from "../src/main/usage/client";

const strip = (f: string): string => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

describe("§39 the usage facade", () => {
  it("is a no-op before install, validates, and forwards category + params", () => {
    const got: unknown[] = [];
    track("bypass_changed", { on: true, scope: "global" }); // no sink yet: nothing, no throw
    setUsageSink((n, c, p) => got.push([n, c, p]));
    track("bypass_changed", { on: true, scope: "global" });
    track("bypass_changed", { on: true, scope: "moon" });
    expect(got).toEqual([["bypass_changed", "trust", { on: true, scope: "global" }]]);
    setUsageSink(null);
  });
  it("a throwing sink never reaches the caller", () => {
    setUsageSink(() => { throw new Error("sdk broke"); });
    expect(() => track("bypass_changed", { on: false, scope: "session" })).not.toThrow();
    setUsageSink(null);
  });
  it("feature_used is deduped per session and feature, whichever window asks", () => {
    const got: unknown[] = [];
    setUsageSink((n, _c, p) => got.push([n, p]));
    trackFeature("s1", "terminal", "user");
    trackFeature("s1", "terminal", "user");
    trackFeature("s1", "terminal", "agent");
    trackFeature("s2", "terminal", "user");
    forgetSessionFeatures("s1");
    trackFeature("s1", "terminal", "user");
    trackFeature("s1", "not_a_feature", "user");
    expect(got).toHaveLength(3);
    setUsageSink(null);
  });
});

describe("§39 wiring rules", () => {
  const src = walk("src").filter((f) => /\.tsx?$/.test(f));
  it("no user ID, no installation-ID switch-off, anywhere (D7, D11)", () => {
    for (const f of src) expect(strip(f), f).not.toMatch(/\bsetUserId\(|\bsetUser\(|setInstallationIdEnabled\(false/);
  });
  it("ipc.ts never imports usage/index", () => {
    expect(strip("src/main/ipc.ts")).not.toMatch(/usage\/index|["']\.\/usage["']/);
  });
  it("main installs analytics from the electron entry, refusing renderer identity", () => {
    const idx = strip("src/main/usage/index.ts");
    expect(idx).toContain('from "inlet-sdk/analytics/electron"');
    expect(idx).toMatch(/acceptRendererIdentity:\s*false/);
    expect(idx).toContain("usageBeforeSend");
    expect(idx).toMatch(/enabled:\s*getUsageStats\(\)/);
    expect(idx).toMatch(/forget:\s*true/);
    expect(strip("src/main/index.ts")).toMatch(/void installUsage\(\)/);
  });
  it("the Stats aggregator stays local", () => {
    expect(strip("src/main/analytics.ts")).not.toMatch(/inlet-sdk|usage\//);
  });
});
