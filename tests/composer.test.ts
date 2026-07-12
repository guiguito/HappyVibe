import { describe, expect, it } from "vitest";
import { attachmentUrl, buildImages, resolveModel, supportsVision } from "../src/renderer/src/composer";
import { promptCommand } from "../src/main/pi/commands";

const S = { provider: "anthropic", modelId: "claude-sonnet-4" };
const W = { provider: "openai", modelId: "gpt-5" };
const G = { provider: "deepseek", modelId: "deepseek-v4-flash" };

describe("resolveModel (session → workspace → global)", () => {
  it("session override wins over everything", () => {
    expect(resolveModel(S, W, G)).toEqual(S);
  });
  it("workspace override wins over global", () => {
    expect(resolveModel(null, W, G)).toEqual(W);
    expect(resolveModel(undefined, W, G)).toEqual(W);
  });
  it("falls back to global, then null", () => {
    expect(resolveModel(null, null, G)).toEqual(G);
    expect(resolveModel(null, null, null)).toBeNull();
  });
});

describe("supportsVision", () => {
  const models = [
    { provider: "anthropic", id: "claude-sonnet-4", input: ["text", "image"] },
    { provider: "deepseek", id: "deepseek-v4-flash", input: ["text"] },
    { provider: "ollama", id: "llama3" }, // no input field at all
  ];
  it("true when the resolved model lists image input", () => {
    expect(supportsVision(models, { provider: "anthropic", modelId: "claude-sonnet-4" })).toBe(true);
  });
  it("false for text-only and input-less models", () => {
    expect(supportsVision(models, { provider: "deepseek", modelId: "deepseek-v4-flash" })).toBe(false);
    expect(supportsVision(models, { provider: "ollama", modelId: "llama3" })).toBe(false);
  });
  it("false (honest default) when model unknown, list missing, or no model resolved", () => {
    expect(supportsVision(models, { provider: "x", modelId: "y" })).toBe(false);
    expect(supportsVision(null, S)).toBe(false);
    expect(supportsVision(models, null)).toBe(false);
  });
});

describe("image payload (RPC ImageContent wire shape, docs/rpc.md)", () => {
  const att = { data: "aGk=", mimeType: "image/png", name: "hi.png" };
  it("buildImages emits {type:'image', data, mimeType} without the name", () => {
    expect(buildImages([att])).toEqual([{ type: "image", data: "aGk=", mimeType: "image/png" }]);
  });
  it("attachmentUrl renders a data: URL for thumbnails", () => {
    expect(attachmentUrl(att)).toBe("data:image/png;base64,aGk=");
  });
  it("promptCommand carries images alongside message and streamingBehavior", () => {
    const images = buildImages([att]);
    expect(promptCommand("look", undefined, images)).toEqual({
      type: "prompt",
      message: "look",
      images: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
    });
    expect(promptCommand("look", "steer", images)).toEqual({
      type: "prompt",
      message: "look",
      streamingBehavior: "steer",
      images,
    });
    // no/empty images → field omitted (unchanged pre-W2.1 shape)
    expect(promptCommand("hi")).toEqual({ type: "prompt", message: "hi" });
    expect(promptCommand("hi", "followUp", [])).toEqual({ type: "prompt", message: "hi", streamingBehavior: "followUp" });
  });
});
