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
