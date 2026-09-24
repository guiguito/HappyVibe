import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain ESM, no type declarations
import { isMachO, machOFiles, macSignIdentity } from "../build/afterPackLayout.mjs";

/**
 * PRD §4 (open-source round, 2026-09-24): with a Developer ID, afterPack signs
 * every Mach-O under Resources/pi-runtime — neither `codesign --deep` nor
 * electron-builder's own signing descends there. The set is FOUND BY SCANNING:
 * it moved 13 → 15 across two pin bumps, so a hand list would rot.
 */
describe("afterPack signing", () => {
  it("recognises thin and fat Mach-O magics, and nothing else", () => {
    for (const m of [
      [0xcf, 0xfa, 0xed, 0xfe], // MH_MAGIC_64, little-endian on disk
      [0xce, 0xfa, 0xed, 0xfe], // MH_MAGIC
      [0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2], // FAT_MAGIC, 2 archs
      [0xca, 0xfe, 0xba, 0xbf, 0, 0, 0, 2], // FAT_MAGIC_64
    ])
      expect(isMachO(Uint8Array.from(m))).toBe(true);
    expect(isMachO(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(false); // ELF
    expect(isMachO(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(false); // PE
    expect(isMachO(Uint8Array.from([0x23, 0x21]))).toBe(false); // short "#!"
    // A Java .class shares CAFEBABE; its next 4 bytes are a version (52+), not an arch count.
    expect(isMachO(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]))).toBe(false);
  });

  it("walks a tree, skips symlinks and non-binaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-macho-"));
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "x.node"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2]));
    fs.writeFileSync(path.join(root, "a", "readme.md"), "# hi");
    fs.writeFileSync(path.join(root, "empty"), "");
    fs.symlinkSync(path.join(root, "a", "b", "x.node"), path.join(root, "link.node"));
    expect(machOFiles(root)).toEqual([path.join(root, "a", "b", "x.node")]);
  });

  // Derived from the real tree, so a pin bump that adds a native binary is covered.
  it.skipIf(process.platform !== "darwin" || !fs.existsSync(path.join(__dirname, "..", "pi-runtime", "node_modules")))(
    "finds the real pi-runtime binaries, anydoc included",
    () => {
      const files: string[] = machOFiles(path.join(__dirname, "..", "pi-runtime", "node_modules"));
      expect(files.length).toBeGreaterThanOrEqual(10);
      expect(files.some((f) => f.endsWith("anydoc.darwin-arm64.node"))).toBe(true);
    },
  );

  it("the identity comes from HV_MAC_IDENTITY only; absent means the ad-hoc path", () => {
    expect(macSignIdentity({})).toBeNull();
    expect(macSignIdentity({ HV_MAC_IDENTITY: "  " })).toBeNull();
    expect(macSignIdentity({ HV_MAC_IDENTITY: "Developer ID Application: X (T)" })).toBe("Developer ID Application: X (T)");
  });

  it("afterPack keeps the ad-hoc --deep path and adds the Developer ID loop beside it", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "build", "afterPack.mjs"), "utf8");
    expect(src).toMatch(/macSignIdentity\(process\.env\)/);
    expect(src).toMatch(/machOFiles\(dest\)/);
    expect(src).toMatch(/"--deep", "--sign", "-"/);
    // §27: entitlements travel on BOTH paths or the microphone yields zeros.
    expect(src.match(/--entitlements/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
