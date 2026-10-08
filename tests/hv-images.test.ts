import { expect, test } from "vitest";
import { byPrice, isPricedImageModel, resolveImageModel, type ImageModelInfo } from "../pi-runtime/extensions/hv-images";

test("priced means BOTH rates above zero — an input-only or $0 model would read as free", () => {
  expect(isPricedImageModel({ cost: { input: 0.3, output: 2.5 } })).toBe(true);
  expect(isPricedImageModel({ cost: { input: 5, output: 0 } })).toBe(false);      // microsoft/mai-image-*
  expect(isPricedImageModel({ cost: { input: 0, output: 0 } })).toBe(false);      // FLUX, Recraft, …
  expect(isPricedImageModel({ cost: { input: -1e6, output: -1e6 } })).toBe(false); // openrouter/auto
  expect(isPricedImageModel({})).toBe(false);
});

const m = (id: string, input: number, output: number): ImageModelInfo => ({ id, name: id, input, output });

test("cheapest first: output rate, then input, then id", () => {
  expect([m("b", 2, 3), m("a", 0.25, 1.5), m("c", 0.5, 3)].sort(byPrice).map((x) => x.id)).toEqual(["a", "c", "b"]);
});

test("the stored model wins only while it is still priced; otherwise the cheapest; never invented", () => {
  const list = [m("cheap", 0.25, 1.5), m("pro", 2, 12)];
  expect(resolveImageModel(list, "pro")).toBe("pro");
  expect(resolveImageModel(list, "gone/after-a-bump")).toBe("cheap");
  expect(resolveImageModel(list, undefined)).toBe("cheap");
  expect(resolveImageModel([], "pro")).toBeNull();
});

import { parseImageSave, runImageTool, withCharge } from "../pi-runtime/extensions/hv-images";

const usage = { input: 12, output: 1120, cacheRead: 0, cacheWrite: 0, totalTokens: 1132, cost: { input: 0.000003, output: 0.00168, cacheRead: 0, cacheWrite: 0, total: 0.001683 } };
const okImages = { stopReason: "stop", output: [{ type: "image", data: "QUJD", mimeType: "image/png" }], usage };

test("withCharge: OpenRouter's total wins, split in Pi's proportions (im1: Pi under-prices 12–20x)", () => {
  const u = withCharge(usage, 0.03326697)!;
  expect(u.cost.total).toBeCloseTo(0.03326697, 10);
  expect(u.cost.input + u.cost.output).toBeCloseTo(0.03326697, 10);
  expect(u.cost.input).toBeGreaterThan(0);
  expect(u.output).toBe(1120); // tokens untouched
});

test("withCharge: no reported charge → cost zeroed, so the ledger reads $? instead of Pi's understated figure", () => {
  const u = withCharge(usage, undefined)!;
  expect(u.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  expect(withCharge(undefined, 0.03)).toBeUndefined();
});

test("a saved image comes back to the agent with its path, and carries OpenRouter's charge for the ledger", async () => {
  const saved: unknown[] = [];
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "assets/sun.png",
    generate: async () => ({ ...okImages, charged: 0.033 }),
    save: async (p) => { saved.push(p); return JSON.stringify({ ok: true, path: "assets/sun.png" }); },
  });
  expect(saved).toEqual([{ path: "assets/sun.png", mimeType: "image/png", data: "QUJD", model: "google/x" }]);
  expect(r.content).toEqual([{ type: "text", text: "Saved the image to assets/sun.png." }, { type: "image", data: "QUJD", mimeType: "image/png" }]);
  expect(r.details).toEqual({ provider: "openrouter", model: "google/x", path: "assets/sun.png" });
  expect(r.usage?.cost.total).toBeCloseTo(0.033, 10);
});

test("a refused save (the file exists) keeps the usage — the image was still paid for", async () => {
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "assets/sun.png",
    generate: async () => ({ ...okImages, charged: 0.033 }),
    save: async () => JSON.stringify({ ok: false, error: "A file already exists at assets/sun.png. Pick a new name." }),
  });
  expect(r.content).toEqual([{ type: "text", text: "A file already exists at assets/sun.png. Pick a new name." }]);
  expect(r.usage?.cost.total).toBeCloseTo(0.033, 10);
});

test("a failed generation says why and never calls save", async () => {
  let called = false;
  const r = await runImageTool({
    modelId: "google/x", prompt: "a sun", path: "a.png",
    generate: async () => ({ stopReason: "error", errorMessage: "402 Insufficient credits", output: [] }),
    save: async () => { called = true; return ""; },
  });
  expect(called).toBe(false);
  expect(r.content[0]).toEqual({ type: "text", text: "The image model failed: 402 Insufficient credits" });
});

test("a reply with no image block is said plainly", async () => {
  const r = await runImageTool({ modelId: "m", prompt: "p", path: "a.png", generate: async () => ({ stopReason: "stop", output: [{ type: "text", text: "I can't draw that." }] }), save: async () => "" });
  expect(r.content[0]).toEqual({ type: "text", text: "The image model returned no image: I can't draw that." });
});

test("a broken envelope round trip is an error the agent sees, never a fake success", async () => {
  const r = await runImageTool({ modelId: "m", prompt: "p", path: "a.png", generate: async () => okImages, save: async () => undefined });
  expect(r.content[0]).toEqual({ type: "text", text: "HappyVibe could not save the image." });
});

test("parseImageSave accepts only our envelope", () => {
  expect(parseImageSave({ method: "input", title: JSON.stringify({ kind: "hv.image-save", path: "a.png", mimeType: "image/png", data: "QUJD", model: "m" }) }))
    .toEqual({ path: "a.png", mimeType: "image/png", data: "QUJD", model: "m" });
  expect(parseImageSave({ method: "select", title: "{}" })).toBeNull();
  expect(parseImageSave({ method: "input", title: JSON.stringify({ kind: "hv.document-read", path: "a" }) })).toBeNull();
});

test("a taken name is refused BEFORE the image is generated — nothing is paid for", async () => {
  let generated = false;
  const r = await runImageTool({
    modelId: "m", prompt: "p", path: "assets/sun.png",
    exists: (p) => p === "assets/sun.png",
    generate: async () => { generated = true; return okImages; },
    save: async () => "",
  });
  expect(generated).toBe(false);
  expect(r.content[0]).toEqual({ type: "text", text: "A file already exists at assets/sun.png. Pick a new name." });
  expect(r.usage).toBeUndefined();
});
