import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — plain ESM, no type declarations
import { winBuildConfig } from "../build/win-build.mjs";

/**
 * PRD §4 (Windows round), key-free.
 *
 * The signing decision is deferred to before the first public Windows download, so
 * the pipeline has to be ready for both answers without carrying an identity in the
 * repo. That is the whole contract here: unsigned by default and SAYING so, signed
 * from env when asked, and LOUD when asked-but-misconfigured — because "I set the
 * secrets and it shipped unsigned anyway" is the failure that would go unnoticed.
 */
const SIGN_ENV = {
  HV_WIN_SIGN: "azure",
  AZURE_SIGN_ENDPOINT: "https://weu.codesigning.azure.net",
  AZURE_SIGN_ACCOUNT: "hv-account",
  AZURE_SIGN_PROFILE: "hv-profile",
  AZURE_SIGN_PUBLISHER: "CN=HappyVibe",
};

describe("winBuildConfig", () => {
  it("is unsigned with no env, and the note says so in the user's terms", () => {
    const r = winBuildConfig({});
    expect(r.config.win?.azureSignOptions).toBeUndefined();
    expect(r.note).toMatch(/unsigned/i);
    // The note is what a person reads before handing someone the installer.
    expect(r.note).toMatch(/SmartScreen/);
  });

  it("adds azureSignOptions from the four secrets when asked", () => {
    expect(winBuildConfig(SIGN_ENV).config.win?.azureSignOptions).toEqual({
      endpoint: "https://weu.codesigning.azure.net",
      codeSigningAccountName: "hv-account",
      certificateProfileName: "hv-profile",
      publisherName: "CN=HappyVibe",
    });
  });

  it("keeps the rest of the win block — signing ADDS, it does not replace", () => {
    const w = winBuildConfig(SIGN_ENV).config.win;
    expect(w.icon).toBe("build/icon.ico");
    expect(w.target[0].arch).toEqual(["x64"]);
  });

  it("THROWS on a half-configured signing request, naming what is missing", () => {
    expect(() => winBuildConfig({ HV_WIN_SIGN: "azure" })).toThrow(/AZURE_SIGN_ENDPOINT/);
    const partial = { ...SIGN_ENV, AZURE_SIGN_PROFILE: "" };
    expect(() => winBuildConfig(partial)).toThrow(/AZURE_SIGN_PROFILE/);
  });

  it("ignores the secrets unless HV_WIN_SIGN asks for signing", () => {
    const { AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT } = SIGN_ENV;
    const r = winBuildConfig({ AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT });
    expect(r.config.win?.azureSignOptions).toBeUndefined();
  });
});

describe("the yml carries no identity", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8");

  it("names no certificate, thumbprint or Azure account", () => {
    expect(yml).not.toMatch(/azureSignOptions|certificateFile|certificateSubjectName|thumbprint/i);
  });

  it("targets x64 only, because the native deps have no win-arm64 build", () => {
    expect(yml).toMatch(/arch:\s*\[x64\]/);
    // The comment above it explains WHY by naming win-arm64, so assert on the
    // configured arch list rather than on the absence of a word.
    const win = yml.slice(yml.indexOf("\nwin:"), yml.indexOf("\nnsis:"));
    expect(win).not.toMatch(/arch:.*arm64/);
  });

  it("installs per-user and keeps the user's data on uninstall", () => {
    expect(yml).toMatch(/perMachine:\s*false/);
    expect(yml).toMatch(/deleteAppDataOnUninstall:\s*false/);
  });
});
