/**
 * §7 round 12 — paste and drop attach an image.
 *
 * Attaching used to be the "+" file picker only, which is the one path that has
 * to go through main. A File already in the renderer just needs its bytes, so
 * paste and drop share one helper with the picker's output shape.
 */
import { describe, expect, test } from "vitest";
import {
  attachmentUrl,
  buildImages,
  fileToAttachment,
  filesToAttachments,
  isAttachableImage,
} from "../src/renderer/src/composer";

const file = (bytes: number[], type: string, name = "shot.png"): File =>
  new File([new Uint8Array(bytes)], name, { type });

describe("isAttachableImage", () => {
  test("images yes, everything else no", () => {
    expect(isAttachableImage({ type: "image/png" })).toBe(true);
    expect(isAttachableImage({ type: "image/jpeg" })).toBe(true);
    expect(isAttachableImage({ type: "text/plain" })).toBe(false);
    expect(isAttachableImage({ type: "application/pdf" })).toBe(false);
    expect(isAttachableImage({})).toBe(false);
  });
});

describe("fileToAttachment", () => {
  test("an image becomes the same shape the picker returns", async () => {
    const a = await fileToAttachment(file([1, 2, 3], "image/png"));
    expect(a).toMatchObject({ name: "shot.png", mimeType: "image/png" });
    expect(a!.data).toBe(btoa("\x01\x02\x03"));
  });

  test("the bytes survive the round trip into the RPC images param", async () => {
    const a = (await fileToAttachment(file([0, 255, 128], "image/png")))!;
    expect(buildImages([a])).toEqual([{ type: "image", data: a.data, mimeType: "image/png" }]);
    expect(attachmentUrl(a)).toBe(`data:image/png;base64,${a.data}`);
  });

  test("a non-image is null, not a broken attachment", async () => {
    expect(await fileToAttachment(file([1], "text/plain", "notes.txt"))).toBeNull();
  });

  test("a large image does not blow btoa's argument limit", async () => {
    // Chunking exists for this: String.fromCharCode(...200k bytes) throws.
    const big = new Array(200_000).fill(65);
    const a = await fileToAttachment(file(big, "image/png"));
    expect(a!.data.length).toBeGreaterThan(100_000);
  });
});

describe("filesToAttachments", () => {
  test("keeps the images, in order, and skips the rest", async () => {
    const out = await filesToAttachments([
      file([1], "image/png", "a.png"),
      file([2], "text/plain", "b.txt"),
      file([3], "image/jpeg", "c.jpg"),
    ]);
    expect(out.map((a) => a.name)).toEqual(["a.png", "c.jpg"]);
  });

  test("a drop of no images attaches nothing rather than an empty chip", async () => {
    expect(await filesToAttachments([file([1], "text/plain", "b.txt")])).toEqual([]);
  });
});
