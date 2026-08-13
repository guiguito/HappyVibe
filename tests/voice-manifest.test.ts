import { describe, it, expect } from "vitest";
import { VOICE_MODEL, VOICE_FIXTURE_WAV, VOICE_MODEL_SIZE_LABEL, fileUrl } from "../src/main/voice/manifest";

/**
 * §27/§7.2. The supply-chain gate: this is what tells you upstream moved
 * before a user finds out. Digests come from the Hugging Face LFS `oid`
 * (which is the sha256); tokens.txt is not LFS so its digest was computed.
 */
describe("voice model manifest", () => {
  it("pins an exact revision, never a mutable branch", () => {
    expect(VOICE_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(VOICE_MODEL.revision).toBe("2bda32ec70b097a55adaa07d9a7173915b43cc78");
    for (const f of VOICE_MODEL.files) {
      expect(fileUrl(f)).not.toContain("resolve/main");
      expect(fileUrl(f)).toContain(`/resolve/${VOICE_MODEL.revision}/`);
    }
  });

  it("pins the four files with their exact bytes and digests", () => {
    expect(VOICE_MODEL.files.map((f) => f.name).sort()).toEqual([
      "decoder.int8.onnx",
      "encoder.int8.onnx",
      "joiner.int8.onnx",
      "tokens.txt",
    ]);
    const by = Object.fromEntries(VOICE_MODEL.files.map((f) => [f.name, f]));
    expect(by["encoder.int8.onnx"]).toMatchObject({
      bytes: 652_184_281,
      sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
    });
    expect(by["decoder.int8.onnx"]).toMatchObject({
      bytes: 11_845_275,
      sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
    });
    expect(by["joiner.int8.onnx"]).toMatchObject({
      bytes: 6_355_277,
      sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
    });
    expect(by["tokens.txt"]).toMatchObject({
      bytes: 93_939,
      sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    });
  });

  it("every digest is a lowercase sha256 and totalBytes is the real sum", () => {
    for (const f of VOICE_MODEL.files) {
      expect(f.sha256, f.name).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes, f.name).toBeGreaterThan(0);
    }
    const sum = VOICE_MODEL.files.reduce((n, f) => n + f.bytes, 0);
    expect(sum).toBe(670_478_772);
    expect(VOICE_MODEL.totalBytes).toBe(sum);
  });

  it("the size we SAY matches the size we download", () => {
    // Guards against the label and the manifest drifting apart in front of the
    // user: §3.2's activation modal, PRD §27 and the Notion spec all say
    // "671 MB". CEILING, not round — 670,478,772 B rounds to 670, and a
    // download size quoted BELOW what it actually costs is the wrong direction
    // to be wrong in.
    const mb = Math.ceil(VOICE_MODEL.totalBytes / 1_000_000);
    expect(mb).toBe(671);
    expect(VOICE_MODEL_SIZE_LABEL).toBe(`${mb} MB`);
  });

  it("credits the upstream weights, which are CC-BY-4.0", () => {
    expect(VOICE_MODEL.attribution.license).toBe("CC-BY-4.0");
    expect(VOICE_MODEL.attribution.model).toBe("nvidia/parakeet-tdt-0.6b-v3");
    expect(VOICE_MODEL.attribution.licenseUrl).toContain("creativecommons.org");
  });

  it("carries a fixture wav from the same pinned revision", () => {
    expect(VOICE_FIXTURE_WAV.name).toBe("test_wavs/en.wav");
    expect(VOICE_FIXTURE_WAV.bytes).toBe(184_608);
    expect(VOICE_FIXTURE_WAV.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fileUrl(VOICE_FIXTURE_WAV)).toContain(VOICE_MODEL.revision);
  });
});
