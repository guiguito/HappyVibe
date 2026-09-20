import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §4 (Linux round): electron-builder matches an icon-set directory by
 * FILENAME — "the icon filename must contain the size (e.g. 32x32.png)"
 * (app-builder-lib/out/options/linuxOptions.d.ts:48). A renamed file is not a
 * lint error there, it is an icon silently dropped from the package.
 */
const ICONS = path.join(__dirname, "..", "build", "icons");
const SIZES = [16, 32, 48, 64, 128, 256, 512];

describe("the Linux icon set", () => {
  it("ships one PNG per size, named the way electron-builder matches", () => {
    for (const s of SIZES) {
      const f = path.join(ICONS, `${s}x${s}.png`);
      expect(fs.existsSync(f), `missing ${s}x${s}.png`).toBe(true);
    }
  });

  it("carries an alpha channel — a black square is the failure mode here", () => {
    // PNG IHDR: bytes 0-7 signature, 8-15 length+type, 16-23 w/h, 24 bit depth,
    // 25 COLOUR TYPE. 6 = truecolour with alpha. A capture that lost transparency
    // comes back as type 2 and looks perfectly correct in a file listing.
    for (const s of SIZES) {
      const head = fs.readFileSync(path.join(ICONS, `${s}x${s}.png`)).subarray(0, 26);
      expect(head.readUInt32BE(16), `${s}: width`).toBe(s);
      expect(head.readUInt32BE(20), `${s}: height`).toBe(s);
      expect(head[25], `${s}: colour type should be 6 (RGBA)`).toBe(6);
    }
  });

  it("is generated, not hand-made — the script that made it is committed", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "icons.mjs"), "utf8");
    expect(src).toContain("icon.svg");
    for (const s of SIZES) expect(src).toMatch(new RegExp(`\\b${s}\\b`));
  });
});
