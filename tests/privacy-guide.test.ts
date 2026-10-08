import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { MASTER_ENV, PRIVACY_SWITCHES } from "../src/main/privacySwitches";
import { PRIVACY_COPY } from "../src/renderer/src/components/PrivacyView";
import { LOCK_COPY } from "../src/renderer/src/components/LockLine";
import { UPDATE_COPY } from "../src/renderer/src/components/updateCopy";

const guide = fs.readFileSync("docs/guide/src/content/docs/privacy.md", "utf8");

describe("the guide's Privacy page is derived from the table (D2)", () => {
  it("names every variable in the code table, and the master", () => {
    for (const v of [MASTER_ENV, ...new Set(Object.values(PRIVACY_SWITCHES).map((s) => s.env))]) expect(guide, v).toContain(`\`${v}\``);
  });
  it("has the section the lock line links to", () => {
    expect(guide).toMatch(/^## On a managed computer$/m);
  });
  it("quotes the switches and the lock line exactly", () => {
    for (const s of [PRIVACY_COPY.feedbackButton, PRIVACY_COPY.pulse, PRIVACY_COPY.remoteSwitch, PRIVACY_COPY.modelSwitch, LOCK_COPY.line]) expect(guide, s).toContain(s);
  });
  it("gives the routes that work on a Mac (D2)", () => {
    expect(guide).toContain("launchctl setenv");
    expect(guide).toContain("open -a HappyVibe --env HV_NO_PHONE_HOME=1");
  });
  it("the Changelog page documents the check switch", () => {
    expect(fs.readFileSync("docs/guide/src/content/docs/changelog.md", "utf8")).toContain(UPDATE_COPY.check);
  });
});
