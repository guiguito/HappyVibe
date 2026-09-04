import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildRecognizerConfig, VOICE_SAMPLE_RATE } from "../src/main/voice/recognizer";
import { VOICE_MODEL } from "../src/main/voice/manifest";

/**
 * §27/§4. The pin-bump gate for the inference runtime. Key-free, and it never
 * loads the native module — the config is a pure object precisely so this test
 * can assert its shape without a 1.83 GB working set.
 */
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sherpaPkg = JSON.parse(
  readFileSync(new URL("../node_modules/sherpa-onnx-node/package.json", import.meta.url), "utf8"),
);

describe("sherpa-onnx runtime contract", () => {
  it("is pinned EXACTLY — a caret here would move the engine under a shipped app", () => {
    expect(pkg.dependencies["sherpa-onnx-node"]).toBe("1.13.7");
    expect(sherpaPkg.version).toBe("1.13.7");
  });

  it("ships a platform package for every target §27 commits to", () => {
    // PRD §27 takes macOS arm64+x64, Windows x64 and Linux x64 as a real
    // commitment, and that commitment is one of the three legs holding up the
    // "no ANE" decision. If a bump drops one of these, that decision changes.
    const optional = Object.keys(sherpaPkg.optionalDependencies ?? {});
    for (const p of [
      "sherpa-onnx-darwin-arm64",
      "sherpa-onnx-darwin-x64",
      "sherpa-onnx-linux-x64",
      "sherpa-onnx-win-x64",
    ]) {
      expect(optional, `missing platform package ${p}`).toContain(p);
    }
  });

  it("uses the CPU provider — the CoreML EP is 3-4x SLOWER for this model", () => {
    const c = buildRecognizerConfig("/models/voice");
    expect(c.modelConfig.provider).toBe("cpu");
    expect(c.modelConfig.provider).not.toBe("coreml");
  });

  it("describes a nemo transducer with the encoder/decoder/joiner triple", () => {
    const c = buildRecognizerConfig("/models/voice");
    expect(c.modelConfig.modelType).toBe("nemo_transducer");
    expect(c.featConfig).toEqual({ sampleRate: 16000, featureDim: 128 });
    expect(c.modelConfig.transducer).toEqual({
      encoder: path.join("/models/voice", "encoder.int8.onnx"),
      decoder: path.join("/models/voice", "decoder.int8.onnx"),
      joiner: path.join("/models/voice", "joiner.int8.onnx"),
    });
    expect(c.modelConfig.tokens).toBe(path.join("/models/voice", "tokens.txt"));
  });

  it("sets numThreads deliberately — ORT's default fights Chromium's pools", () => {
    expect(buildRecognizerConfig("/m").modelConfig.numThreads).toBe(4);
    expect(buildRecognizerConfig("/m", 2).modelConfig.numThreads).toBe(2);
  });

  it("names exactly the files the manifest pins, and no others", () => {
    // Catches the two halves drifting: a renamed export upstream would
    // otherwise fail at model-load time, in front of a user, with ENOENT.
    const c = buildRecognizerConfig("/m");
    const used = [
      c.modelConfig.transducer.encoder,
      c.modelConfig.transducer.decoder,
      c.modelConfig.transducer.joiner,
      c.modelConfig.tokens,
    ].map((p) => path.basename(p));
    expect(used.sort()).toEqual(VOICE_MODEL.files.map((f) => f.name).sort());
  });

  it("exports the one sample rate the capture pipeline is built around", () => {
    expect(VOICE_SAMPLE_RATE).toBe(16000);
    expect(buildRecognizerConfig("/m").featConfig.sampleRate).toBe(VOICE_SAMPLE_RATE);
  });

  it("still exposes OfflineRecognizer and readWave from the package entry", () => {
    // A shape check on the module's own JS (no native load): these are the two
    // symbols the worker and the e2e test call.
    const entry = readFileSync(
      new URL("../node_modules/sherpa-onnx-node/sherpa-onnx.js", import.meta.url),
      "utf8",
    );
    expect(entry).toContain("OfflineRecognizer");
    expect(entry).toContain("readWave");
  });
});
