/**
 * docs-round #11 (Linux half) — Electron has no microphone status on Linux, and the row
 * read "Granted" for a check that never ran. Main now answers "not-needed", decided through
 * the platform seam, and dictation treats it exactly like "granted". No DOM in the suite, so
 * the badge is pinned as a pure function plus source scans.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { micStatusLabel } from "../src/renderer/src/components/VoiceView";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const capture = fs.readFileSync("src/renderer/src/voice/capture.ts", "utf8");
const view = fs.readFileSync("src/renderer/src/components/VoiceView.tsx", "utf8");
const block = ipc.slice(ipc.indexOf("const HAS_MIC_API"), ipc.indexOf('ipcMain.handle("hv:voice-transcribe"'));

describe("the Microphone access badge", () => {
  it("names each status main can return", () => {
    expect(micStatusLabel("granted")).toBe("Granted");
    expect(micStatusLabel("denied")).toBe("Denied");
    expect(micStatusLabel("not-needed")).toBe("No permission needed");
    expect(micStatusLabel("not-determined")).toBe("Not requested");
  });

  it("is rendered through micStatusLabel", () => {
    expect(view).toMatch(/\{micStatusLabel\(mic\)\}/);
    expect(view).not.toMatch(/mic === "granted" \? "Granted" : mic === "denied" \? "Denied" : "Not requested"/);
  });
});

describe("main answers not-needed where Electron has no status", () => {
  it("decided through the platform seam", () => {
    expect(block).toMatch(/const HAS_MIC_API = platform\.name === "darwin" \|\| platform\.name === "win32";/);
    expect(block).toMatch(/HAS_MIC_API \? systemPreferences\.getMediaAccessStatus\("microphone"\) : "not-needed",/);
  });

  it("the microphone block reads no raw process.platform", () => {
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/process\.platform/);
  });
});

describe("dictation treats not-needed exactly like granted", () => {
  it("capture does not refuse it", () => {
    expect(capture).toMatch(/\} else if \(status !== "granted" && status !== "not-needed"\) \{/);
  });

  it("the Voice page still lists input devices", () => {
    expect(view).toMatch(/if \(mic !== "granted" && mic !== "not-needed"\) return;/);
  });
});
