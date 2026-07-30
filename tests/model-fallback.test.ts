import { describe, expect, test } from "vitest";
import { dropUnknownProvider, resolveModel } from "../src/renderer/src/composer";

describe("dropUnknownProvider — a deleted custom endpoint must not strand a session", () => {
  test("a ref whose provider is gone is dropped", () => {
    expect(dropUnknownProvider({ provider: "my-vllm", modelId: "q" }, ["deepseek"])).toBeNull();
  });
  test("a known provider survives", () => {
    const ref = { provider: "deepseek", modelId: "deepseek-chat" };
    expect(dropUnknownProvider(ref, ["deepseek"])).toEqual(ref);
  });
  test("an empty known-list (models not loaded yet) is not treated as 'all gone'", () => {
    const ref = { provider: "my-vllm", modelId: "q" };
    expect(dropUnknownProvider(ref, [])).toEqual(ref);
  });
  test("resolution falls through to the next tier once the session ref is dropped", () => {
    const session = dropUnknownProvider({ provider: "my-vllm", modelId: "q" }, ["deepseek"]);
    const workspace = null;
    const global = { provider: "deepseek", modelId: "deepseek-chat" };
    expect(resolveModel(session, workspace, global)).toEqual(global);
  });
});
