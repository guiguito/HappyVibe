import { describe, expect, it } from "vitest";
import fs from "node:fs";

const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");
// Comments stripped, the tests/how-it-works.test.ts idiom: this file scans
// what RENDERS, and a comment explaining why the caveat is absent would
// otherwise fail the assertion that it is absent.
const privacy = fs
  .readFileSync("src/renderer/src/components/PrivacyView.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * §37 — the opt-out, which had a real hole in the first design and does not now.
 *
 * `beforeSend` never ran on the fatal path in inlet-sdk 0.1.0, so an uncaught
 * exception captured while crash reports were OFF was still written to
 * `queue.json` — and turning the setting back on months later would have sent
 * it. `setEnabled(false, { dropQueue: true })` plus `beforeSendSync` close that
 * from both ends, and this file is what stops either half quietly regressing.
 */
describe("§37 turning it off means off", () => {
  it("the handler drops the queue when switching off", () => {
    const at = crash.indexOf('"hv:set-crash-reports"');
    const handler = crash.slice(at, crash.indexOf('"hv:crash-info"', at));
    expect(handler).toMatch(/setCrashReports\(!!on\)/); // the persisted setting
    expect(handler).toMatch(/setCrashEnabled\(!!on\)/); // and the live client
    const impl = crash.slice(crash.indexOf("export async function setCrashEnabled"));
    expect(impl).toMatch(/setEnabled\(on, \{ dropQueue: !on \}\)/);
  });

  it("installCrash passes `enabled` rather than branching around init", () => {
    // `init({ enabled: false })` is what makes the toggle live in BOTH
    // directions. Branching around init would mean the client does not exist
    // when the user turns it back on, and the page would need a "takes effect
    // on next launch" caveat it does not have.
    expect(crash).toMatch(/enabled: getCrashReports\(\)/);
    const body = crash.slice(crash.indexOf("export async function installCrash"));
    const setting = body.indexOf("getCrashReports()");
    const init = body.indexOf("installElectronMain(");
    expect(setting).toBeGreaterThan(init); // read INSIDE the options, not as a guard before them
  });

  it("the Privacy page makes no 'next launch' promise it cannot keep", () => {
    // An absence assertion: this claim is only true because of the two above.
    expect(privacy.toLowerCase()).not.toContain("next launch");
    expect(privacy.toLowerCase()).not.toContain("restart");
  });

  it("the default is ON, and an older config file reads as ON rather than unset", () => {
    const config = fs.readFileSync("src/main/config.ts", "utf8");
    const at = config.indexOf("export function getCrashReports");
    expect(config.slice(at, at + 120)).toMatch(/return !load\(\)\.crashReportsOff/);
    const setter = config.slice(config.indexOf("export function setCrashReports"));
    expect(setter).toMatch(/if \(on\) delete cfg\.crashReportsOff/); // stored only when off
  });
});

describe("§37 the dev gate", () => {
  it("development initialises NOTHING without the flag", () => {
    const body = crash.slice(crash.indexOf("export async function installCrash"));
    const gate = body.slice(0, body.indexOf("const cfg"));
    expect(gate).toMatch(/is\.dev && process\.env\.HV_CRASH_DEV !== "1"/);
    expect(gate).toMatch(/return;/);
  });

  it("the flag is an env var, never `is.dev` alone", () => {
    // Same reasoning as HV_FEEDBACK_FAST_PULSE: under a bare dev check, every
    // development session would file its own half-written code into the same
    // database a real dev-channel user reports to.
    expect(crash).toContain("HV_CRASH_DEV");
  });
});
