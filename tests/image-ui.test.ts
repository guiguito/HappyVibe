import fs from "node:fs";
import { expect, test } from "vitest";
import { IMAGES_ROW_COPY, imagePromptLines } from "../src/renderer/src/imagePrompt";

test("the prompt names the model, says it costs money, and shows the file — never the intent", () => {
  const lines = imagePromptLines({ model: "google/gemini-3.1-flash-lite-image", path: "assets/sun.png" }, [{ id: "google/gemini-3.1-flash-lite-image", name: "Google: Gemini 3.1 Flash Lite Image" }]);
  expect(lines).toEqual([
    "This makes an image with Google: Gemini 3.1 Flash Lite Image on your OpenRouter account. It costs money.",
    "It saves a new file: assets/sun.png",
  ]);
});

test("the row's copy", () => {
  expect(IMAGES_ROW_COPY.needsOpenRouter).toBe("Needs an OpenRouter key or sign-in. Add one on");
  expect(IMAGES_ROW_COPY.on).toContain("costs money");
});

test("the picker lists only the priced models main sends, by name — no hand-written id, no per-token rates", () => {
  const src = fs.readFileSync("src/renderer/src/components/BuiltinToolsBlock.tsx", "utf8");
  for (const absent of ["flux", "recraft", "seedream", "mai-image", "openrouter/auto", "per million tokens"]) expect(src.toLowerCase()).not.toContain(absent);
  expect(src).toContain("settings.models.map(");
  expect(src).toContain("Images — 1 tool");
});
