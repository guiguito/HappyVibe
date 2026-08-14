import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §27. "Open System Settings" must land on the MICROPHONE list.
 *
 * The legacy pane id fails softly — Settings opens, the ?Privacy_Microphone
 * anchor is dropped, and the user lands on a page with no app list, which reads
 * as "HappyVibe is not in the list". Nothing throws, so only this pins it.
 */
const ipc = fs.readFileSync(path.join(__dirname, "..", "src", "main", "ipc.ts"), "utf8");

describe("microphone settings deep link", () => {
  it("uses the ExtensionKit pane id that macOS 13+ actually honours", () => {
    expect(ipc).toContain(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
    );
  });

  it("keeps the legacy id ONLY behind the version check", () => {
    const legacy = "com.apple.preference.security?Privacy_Microphone";
    expect(ipc).toContain(legacy);
    expect(ipc).toContain('process.getSystemVersion().split(".")[0]');
  });
});
