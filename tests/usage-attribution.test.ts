import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { existingUserAttribution, hasPriorUse } from "../src/main/usage/attribution";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "hv-usage-"));

describe("§39 D16 existing_user", () => {
  it("prior use + no analytics-state.json → existing_user, even when config wrote installation-id.json first", () => {
    const inlet = tmp();
    fs.writeFileSync(path.join(inlet, "installation-id.json"), JSON.stringify("abc"));
    expect(existingUserAttribution(inlet, true)).toBe("existing_user");
  });
  it("a fresh profile → none", () => expect(existingUserAttribution(tmp(), false)).toBeUndefined());
  it("a missing inlet dir with prior use → existing_user", () => {
    expect(existingUserAttribution(path.join(tmp(), "inlet"), true)).toBe("existing_user");
  });
  it("analytics already ran here → none", () => {
    const inlet = tmp();
    fs.writeFileSync(path.join(inlet, "analytics-state.json"), "{}");
    expect(existingUserAttribution(inlet, true)).toBeUndefined();
  });
  it("prior use = a workspace, a key, a custom endpoint, a legacy key or a Pi login", () => {
    const a = tmp();
    expect(hasPriorUse(tmp(), a)).toBe(false);
    const u = tmp();
    fs.writeFileSync(path.join(u, "workspaces.json"), JSON.stringify([{ path: "/x" }]));
    expect(hasPriorUse(u, a)).toBe(true);
    const u2 = tmp();
    fs.writeFileSync(path.join(u2, "config.json"), JSON.stringify({ keys: { openrouter: "enc" } }));
    expect(hasPriorUse(u2, a)).toBe(true);
    const u5 = tmp();
    fs.writeFileSync(path.join(u5, "config.json"), JSON.stringify({ customEndpoints: [{ id: "e" }] }));
    expect(hasPriorUse(u5, a)).toBe(true);
    const u6 = tmp();
    fs.writeFileSync(path.join(u6, "config.json"), JSON.stringify({ apiKey: "enc" }));
    expect(hasPriorUse(u6, a)).toBe(true);
    const u3 = tmp(); const a3 = tmp();
    fs.writeFileSync(path.join(a3, "auth.json"), JSON.stringify({ anthropic: { type: "oauth" } }));
    expect(hasPriorUse(u3, a3)).toBe(true);
    const u4 = tmp();
    fs.writeFileSync(path.join(u4, "workspaces.json"), "not json");
    fs.writeFileSync(path.join(u4, "config.json"), JSON.stringify({ keys: {}, onboardingSeen: true }));
    expect(hasPriorUse(u4, tmp())).toBe(false);
  });
});
