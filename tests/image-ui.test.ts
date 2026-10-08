import fs from "node:fs";
import { expect, test } from "vitest";
import { IMAGES_ROW_COPY, fmtPerImage, imagePromptLines } from "../src/renderer/src/imagePrompt";

test("the prompt names the model, says it costs money, and shows the file — never the intent", () => {
  const lines = imagePromptLines({ model: "recraft/recraft-v4.1-flash", path: "assets/sun.png" }, [{ id: "recraft/recraft-v4.1-flash", name: "Recraft: Recraft V4.1 Flash", perImage: 0.00693 }]);
  expect(lines).toEqual([
    "This makes an image with Recraft: Recraft V4.1 Flash on your OpenRouter account. It costs money — about $0.007 an image.",
    "It saves a new file: assets/sun.png",
  ]);
});

test("a measured price reads as an approximation, never a quote", () => {
  expect(fmtPerImage(0.00693)).toBe("about $0.007 an image");
  expect(fmtPerImage(0.2475)).toBe("about $0.25 an image");
});

test("the row's copy", () => {
  expect(IMAGES_ROW_COPY.needsOpenRouter).toBe("Needs an OpenRouter key or sign-in. Add one on");
  expect(IMAGES_ROW_COPY.on).toContain("costs money");
});

test("the picker lists only the models main sends, with their measured price — no hand-written id, no per-token rates", () => {
  const src = fs.readFileSync("src/renderer/src/components/BuiltinToolsBlock.tsx", "utf8");
  for (const absent of ["flux", "recraft", "seedream", "gpt-image", "openrouter/auto", "per million tokens"]) expect(src.toLowerCase()).not.toContain(absent);
  expect(src).toContain("settings.models.map(");
  expect(src).toContain("fmtPerImage(m.perImage)");
  expect(src).toContain("Images — 1 tool");
});
