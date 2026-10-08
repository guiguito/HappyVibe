import fs from "node:fs";
import { expect, test } from "vitest";
import { parseImageDataUrl } from "../src/main/imageData";
import { ZOOM_ACTIONS } from "../src/renderer/src/components/ZoomableImage";

// Any picture the app shows can be copied or saved from its zoom view (the one lightbox).
test("a picture's data URL becomes its bytes, type and file extension", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  expect(parseImageDataUrl(`data:image/png;base64,${png.toString("base64")}`)).toEqual({ mime: "image/png", ext: "png", bytes: png });
  expect(parseImageDataUrl("data:image/jpeg;base64,QUJD")?.ext).toBe("jpg");
  expect(parseImageDataUrl("data:image/webp;base64,QUJD")?.ext).toBe("webp");
});

test("anything that is not an image data URL is refused (it crosses from the renderer)", () => {
  for (const bad of ["https://x/a.png", "file:///etc/passwd", "data:text/html;base64,QUJD", "data:image/svg+xml;base64,QUJD", "data:image/png;base64,", 42 as never]) {
    expect(parseImageDataUrl(bad)).toBeNull();
  }
});

test("the zoom view offers Copy and Save…, and its buttons don't close it", () => {
  expect(ZOOM_ACTIONS).toEqual({ copy: "Copy", copied: "Copied", save: "Save…" });
  const src = fs.readFileSync("src/renderer/src/components/ZoomableImage.tsx", "utf8");
  expect(src).toMatch(/stopPropagation/);
  expect(src).toContain("window.hv.imageCopy(src)");
  expect(src).toContain("window.hv.imageSaveAs(src");
});
