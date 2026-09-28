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

describe("§39 renderer half", () => {
  it("preload exposes inletAnalytics with literal channels", () => {
    const p = strip("src/preload/index.ts");
    expect(p).toMatch(/exposeInMainWorld\("inletAnalytics"/);
    expect(p).toContain('ipcRenderer.send("inlet:analytics"');
    expect(p).toContain('"inlet:analytics:ids"');
  });
  it("the renderer imports only the electron-renderer analytics entry", () => {
    for (const f of walk("src/renderer/src").filter((x) => /\.tsx?$/.test(x))) {
      expect(strip(f), f).not.toMatch(/inlet-sdk\/analytics\/(electron|node|browser)["']/);
    }
    expect(strip("src/renderer/src/usage.ts")).toContain('"inlet-sdk/analytics/electron-renderer"');
  });
  it("Privacy puts Usage statistics above Crash reports, with the approved copy", () => {
    const v = fs.readFileSync("src/renderer/src/components/PrivacyView.tsx", "utf8");
    expect(v.indexOf('title="Usage statistics"')).toBeGreaterThan(-1);
    expect(v.indexOf('title="Usage statistics"')).toBeLessThan(v.indexOf('title="Crash reports"'));
    expect(v).toContain("Send anonymous usage statistics");
    expect(v).toContain("Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects.");
    expect(v.replace(/\s+/g, " ")).toContain("Turning statistics off doesn&apos;t stop it, but the ID is replaced with a new one that isn&apos;t linked to your statistics.");
    expect(v).toContain('copy="usageStats"');
  });
  it("main dedupes UI first-uses", () => {
    expect(strip("src/main/ipc.ts")).toMatch(/"hv:usage-feature"[\s\S]{0,200}trackFeature\(/);
  });
});

it("§39 screens: one effect on activeView, never inside navigate()", () => {
  const app = strip("src/renderer/src/App.tsx");
  expect(app.match(/screenView\(/g)?.length).toBe(1);
  expect(app).toMatch(/useEffect\(\(\) => \{\s*screenView\(screenNow\);?\s*\}, \[screenNow\]\)/);
  // A hook below App's early return changes the hook count between renders —
  // "This view broke." on screen, and no test can see it. It must sit above
  // `const activeView`, which is computed after that return.
  expect(app.indexOf("screenView(")).toBeLessThan(app.indexOf("const activeView"));
  const at = app.indexOf("const navigate = useCallback");
  expect(at).toBeGreaterThan(-1);
  expect(app.slice(at, at + 1500)).not.toContain("screenView");
});

it("§39 every catalog event has at least one call site with a literal name", async () => {
  const { USAGE_EVENTS } = await import("../src/main/usage/events");
  const all = walk("src").filter((f) => /\.tsx?$/.test(f) && !f.endsWith("/usage/events.ts")).map(strip).join("\n");
  for (const name of Object.keys(USAGE_EVENTS)) {
    const direct = new RegExp(`(track|trackUi)\\("${name}"`).test(all);
    const picked = all.includes(`name: "${name}"`);
    expect(direct || picked, name).toBe(true);
  }
});

it("§39 the Privacy intro names the Stats PAGE as local, not 'your stats'", () => {
  const v = fs.readFileSync("src/renderer/src/components/PrivacyView.tsx", "utf8").replace(/\s+/g, " ");
  expect(v).toContain("your audit log and your Stats page — stays here.");
});

it("§39 the Privacy page scrolls like every other settings page", () => {
  const v = strip("src/renderer/src/components/PrivacyView.tsx");
  expect(v).toMatch(/return \(\s*<div className="flex-1 overflow-y-auto">/);
});

it("§39 turning statistics back on re-tags the new installation existing_user BEFORE enabling", () => {
  const idx = strip("src/main/usage/index.ts");
  const handler = idx.slice(idx.indexOf('"hv:set-usage-stats"'));
  const tag = handler.indexOf('setAttribution?.("existing_user")');
  const enable = handler.indexOf("setEnabled?.(");
  expect(tag).toBeGreaterThan(-1);
  expect(tag).toBeLessThan(enable);
});

it("§39 inlet-sdk 0.5.0: no environment is sent — the server refuses the envelope (unknown_field)", () => {
  for (const f of ["src/main/crash/index.ts", "src/main/usage/index.ts", "src/main/feedback/config.ts"]) {
    expect(strip(f), f).not.toMatch(/\benvironment\s*:/);
  }
});
