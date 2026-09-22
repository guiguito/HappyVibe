import { describe, expect, it } from "vitest";
import fs from "node:fs";

const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");
const mainIndex = fs.readFileSync("src/main/index.ts", "utf8");
const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const rendererMain = fs.readFileSync("src/renderer/src/main.tsx", "utf8");
const viteConfig = fs.readFileSync("electron.vite.config.ts", "utf8");
const builder = fs.readFileSync("electron-builder.yml", "utf8");

/** Every file under a directory, so an assertion about "the renderer" cannot go
    stale by someone adding a second entry point. */
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );

describe("§37 the SDK entry points — a build error nobody sees until release", () => {
  it("main imports ONLY crash/electron, never the renderer entry", () => {
    const mainFiles = walk("src/main").filter((f) => /\.tsx?$/.test(f));
    const importing = mainFiles.filter((f) => fs.readFileSync(f, "utf8").includes("inlet-sdk/crash"));
    expect(importing.length, "non-vacuity: something in src/main must import the SDK").toBeGreaterThan(0);
    for (const f of mainFiles) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toContain("inlet-sdk/crash/electron-renderer");
      expect(src, f).not.toContain("inlet-sdk/crash/browser");
    }
    expect(crash).toContain('from "inlet-sdk/crash/electron"');
  });

  it("the renderer imports ONLY the node-free entry", () => {
    // `inlet-sdk/crash/electron` statically imports node:fs, node:os,
    // node:crypto and node:path. It TYPECHECKS in the renderer and fails at
    // `npm run build` — which is why this is pinned here as well as there.
    const rFiles = walk("src/renderer/src").filter((f) => /\.tsx?$/.test(f));
    const importing = rFiles.filter((f) => fs.readFileSync(f, "utf8").includes("inlet-sdk/crash"));
    expect(importing.length, "non-vacuity: the renderer must import the SDK").toBeGreaterThan(0);
    for (const f of rFiles) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from ['"]inlet-sdk\/crash\/electron['"]/);
      expect(src, f).not.toMatch(/from ['"]inlet-sdk\/crash\/node['"]/);
    }
    expect(rendererMain).toContain("inlet-sdk/crash/electron-renderer");
  });
});

describe("§37 the reporting seam is electron-free", () => {
  // `crash/index.ts` imports `electron`, which under vitest is a CommonJS stub
  // with no named exports. Importing it from a module a test loads takes that
  // whole FILE down with "Named export 'BrowserWindow' not found" — naming the
  // import, never the cause. That is exactly what happened when `captureCrash`
  // first lived in `index.ts`: six unrelated test files went red at once.
  // Same class as `schedules.ts` and `terminalSettings.ts`, two directories over.
  // Comments stripped: this file's own docstring NAMES the imports it forbids,
  // which is the tests/how-it-works.test.ts idiom and the same trap one file over.
  const seam = fs
    .readFileSync("src/main/crash/client.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("client.ts imports no electron, directly or through the module that does", () => {
    expect(seam).not.toMatch(/from ["']electron["']/);
    expect(seam).not.toMatch(/@electron-toolkit/);
    expect(seam).not.toMatch(/from ["']\.\/index["']/);
  });

  it("the vitest-imported modules reach the seam, never the Electron half", () => {
    // ipc.ts is the one CLAUDE.md names by hand; the two sidecars are the same
    // class and were red for the same reason the first time this was wired.
    for (const f of ["src/main/documents.ts", "src/main/mcpAdapterStore.ts", "src/main/ipc.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).toContain('from "./crash/client"');
      // A bare `./crash` here is the regression, and it typechecks and runs.
      expect(src, f).not.toMatch(/from ["']\.\/crash["']/);
    }
  });

  it("only the Electron half sets the capture, and it does", () => {
    expect(crash).toMatch(/setCrashCapture\(/);
    expect((seam.match(/export function setCrashCapture/g) ?? []).length).toBe(1);
  });
});

describe("§37 the init options — what is passed, and what must never be", () => {
  it("{ exitCode: false } is passed explicitly", () => {
    // It IS the default at 0.1.2. It stays spelled out because main exiting
    // takes every live Pi session with it, including an in-flight delegation,
    // and a silent upstream default flip must not be able to do that.
    expect(crash).toMatch(/\{ exitCode: false \}/);
  });

  it("no `fetch` override, and `redaction` is ours by name", () => {
    const at = crash.indexOf("installElectronMain(");
    const call = crash.slice(at, crash.indexOf("{ exitCode: false }", at));
    expect(call).not.toMatch(/^\s*fetch:/m);
    // §37 round 2: the default alone left the database a wall of `<redacted>`
    // (7 of 20 realistic messages survived, and all seven were the engine's).
    // `redactMessage` EXTENDS it with an exact-match set generated from our own
    // literal throws — it must be that function, never `keepMessages`, which
    // would ship everything.
    expect(call).toMatch(/^\s*redaction: redactMessage,$/m);
    expect(crash).not.toMatch(/keepMessages/);
  });

  it("no `appRoots` override in main — the default is what keeps frames root-relative", () => {
    // The default is `app.getAppPath()`. Overriding it is exactly how the
    // developer's own repo path would start travelling.
    expect(crash).not.toMatch(/appRoots:/);
  });

  it("no `context` is ever set, and the tags are the allowlist", () => {
    expect(crash).not.toMatch(/^\s*context:/m);
    expect(crash).toMatch(/tagAllowlist: \[\.\.\.TAG_ALLOW\]/);
    expect(crash).toMatch(/beforeSendSync: scrubEnvelope/);
    // `beforeSendSync`, not `beforeSend` — the latter never runs on the fatal path.
    expect(crash).not.toMatch(/\bbeforeSend:/);
  });

  it("minidumps are captured locally and never uploaded", () => {
    expect(crash).toMatch(/crashReporter\.start\(\{ uploadToServer: false/);
  });

  it("development is the FIRST gate, ahead of the user setting", () => {
    const body = crash.slice(crash.indexOf("export async function installCrash"));
    const devGate = body.indexOf("HV_CRASH_DEV");
    const init = body.indexOf("installElectronMain(");
    expect(devGate).toBeGreaterThan(-1);
    expect(devGate).toBeLessThan(init);
  });
});

describe("§37 where it is installed", () => {
  it("installCrash runs after the userData migration, before anything else", () => {
    const migration = mainIndex.indexOf("fall back to a fresh userData dir");
    const install = mainIndex.indexOf("installCrash(");
    const openWindow = mainIndex.indexOf("function openWindow");
    expect(migration).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(migration);
    expect(install).toBeLessThan(openWindow);
  });

  it("openWindow only RELOADS — the report itself is the SDK's", () => {
    const at = mainIndex.indexOf("win.webContents.on('render-process-gone'");
    expect(at).toBeGreaterThan(-1);
    const handler = mainIndex.slice(at, at + 500);
    expect(handler).toMatch(/clean-exit/); // a normal close is not a crash
    expect(handler).toMatch(/reloadedAfterCrash/); // once per window, or a view that dies on load loops
    expect(handler).not.toMatch(/captureReport|captureCrash/);
  });
});

describe("§37 the preload bridge", () => {
  it("the channel is a LITERAL, never forwarded from the renderer", () => {
    const at = preload.indexOf('exposeInMainWorld("inletCrash"');
    expect(at).toBeGreaterThan(-1);
    const bridge = preload.slice(at, at + 300);
    expect(bridge).toContain('ipcRenderer.send("inlet:crash"');
    // The SDK passes the channel as the first argument; it is ignored.
    expect(bridge).toMatch(/_channel/);
  });
});

describe("§37 a Pi exit is reported only when it is OURS", () => {
  it("session-exit passes the RING to piFrames, and never the tail to a report", () => {
    const at = ipc.indexOf('manager.on("session-exit"');
    const handler = ipc.slice(at, ipc.indexOf('send("hv:pi-exit"', at));
    expect(handler).toMatch(/piFrames\(stderrLines/);
    // `stderr` is the 8-line human-readable tail. It goes to the LOCAL
    // session.crash row and must never reach captureCrash.
    expect(handler).toMatch(/type: "session\.crash"/);
    const callAt = handler.indexOf("captureCrash(");
    const report = handler.slice(callAt, handler.indexOf("});", callAt));
    expect(report).not.toMatch(/\bstderr\b(?!Lines)/);
    expect(report).toMatch(/message: ""/);
  });

  it("the report is gated on a non-empty frame list", () => {
    // Without this, a bad provider key and a `402 Insufficient Balance` file a
    // report every day under ONE fingerprint and bury the Pi crash that is ours.
    const at = ipc.indexOf("const frames = piFrames(");
    expect(at).toBeGreaterThan(-1);
    const after = ipc.slice(at, at + 400);
    expect(after).toMatch(/if \(frames\.length > 0\)/);
    expect(after.indexOf("frames.length > 0")).toBeLessThan(after.indexOf("captureCrash("));
  });
});

describe("§37 build knobs", () => {
  it("the renderer emits source maps but does not reference them", () => {
    expect(viteConfig).toMatch(/sourcemap: 'hidden'/);
  });

  it("maps are excluded from the artifact — a map is the unminified source", () => {
    expect(builder).toMatch(/!out\/\*\*\/\*\.map/);
  });

  it("main gets the runtime pins it tags every report with", () => {
    const mainBlock = viteConfig.slice(viteConfig.indexOf("main: {"), viteConfig.indexOf("preload:"));
    expect(mainBlock).toMatch(/__RUNTIME_PINS__/);
  });
});
