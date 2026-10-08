import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRIVACY_COPY } from "../src/renderer/src/components/PrivacyView";
import { LOCK_COPY } from "../src/renderer/src/components/LockLine";

const read = (f: string): string => fs.readFileSync(f, "utf8");
const page = read("src/renderer/src/components/PrivacyView.tsx");
function walk(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

describe("Privacy page", () => {
  it("blocks run in the spec's order, Clear all data last", () => {
    const marks = ['title="Usage statistics"', 'title="Crash reports"', "title={C.feedbackTitle}", "title={C.remoteTitle}", "title={C.modelTitle}", "title={C.otherTitle}", 'title="Clear all data"'];
    const at = marks.map((m) => page.indexOf(m));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("every PRIVACY_COPY key is used (no dead copy)", () => {
    for (const k of Object.keys(PRIVACY_COPY)) expect(page, k).toMatch(new RegExp(`C\\.${k}\\b`));
  });
  it("the settings-check paragraph lives under Remote settings, not Usage statistics", () => {
    const usage = page.slice(page.indexOf('title="Usage statistics"'), page.indexOf('title="Crash reports"'));
    expect(usage).not.toMatch(/checks HappyVibe|device ID|remoteBody/);
    expect(PRIVACY_COPY.remoteBody).toContain("Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics.");
  });
  it("the model-list interval is derived, never typed", () => {
    expect(page).toContain("${MODEL_LIST_REFRESH_HOURS}");
    expect(page).not.toMatch(/every 4 hours/);
  });
  it("the app never names a variable (D2)", () => {
    for (const f of walk("src/renderer/src")) {
      const s = read(f);
      expect(s.includes("HV_NO_") || s.includes("PI_OFFLINE"), f).toBe(false);
    }
  });
  it("the lock line is the spec's words and opens the managed-computer section", () => {
    expect(LOCK_COPY.line).toBe("Turned off on this computer by an environment setting.");
    expect(read("src/renderer/src/components/LockLine.tsx")).toContain('docUrl("privacy", "on-a-managed-computer")');
  });
  it("the megaphone and the pulse are gated on their switches as well as the channel", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toMatch(/feedbackAvailable=\{feedbackInfo\.available && !!privacy\?\.on\.feedback\}/);
    expect(app.match(/feedbackInfo\.available && !!privacy\?\.on\.sessionPulse/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).toContain("<OpenDocsContext.Provider value={openDocs}>");
  });
});
