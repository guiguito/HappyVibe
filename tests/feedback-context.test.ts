import { describe, expect, it } from "vitest";
import { CONTEXT_MAX_BYTES, clampView, generalContext, pulseContext, type HostFacts } from "../src/main/feedback/context";

const host: HostFacts = {
  appVersion: "0.1.0",
  channel: "dev",
  os: { platform: "darwin", version: "15.5", release: "24.5.0", arch: "arm64" },
  electron: "44.2.0",
};
const bytes = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");

describe("generalContext", () => {
  it("emits exactly the allowlisted keys", () => {
    const c = generalContext(host, { view: "settings/mcp", model: { provider: "openrouter", id: "deepseek/deepseek-v4-flash" } });
    expect(Object.keys(c).sort()).toEqual(["appVersion", "channel", "electron", "model", "os", "view"]);
    expect(Object.keys(c.os as object).sort()).toEqual(["arch", "platform", "release", "version"]);
  });

  it("omits model and view when absent — never invents either", () => {
    const c = generalContext(host, {});
    expect(c).not.toHaveProperty("model");
    expect(c).not.toHaveProperty("view");
  });

  /**
   * The allowlist is the point: a caller may hand these builders anything and
   * only the named keys come out. This is the test that makes §34's copy true.
   */
  it("drops anything that is not on the allowlist, even when handed it", () => {
    const dirty = {
      ...host,
      workspacePath: "/Users/x/secret",
      sessionTitle: "fix the auth bug",
      prompt: "…",
    } as unknown as HostFacts;
    const c = generalContext(dirty, { view: "chat", model: null, ...({ sessionId: "abc" } as object) });
    expect(JSON.stringify(c)).not.toMatch(/secret|auth bug|abc|sessionId|workspacePath/);
  });

  it("stays under Inlet's 16 KiB ceiling even with hostile-length inputs", () => {
    const big = { ...host, appVersion: "9".repeat(50_000) };
    expect(bytes(generalContext(big, { view: "x".repeat(50_000) }))).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
  });
});

describe("pulseContext", () => {
  it("emits the session block with the gauge's null right after compaction", () => {
    const c = pulseContext(
      host,
      { sittingMs: 1_260_000, turns: 7, messages: 15, contextTokens: null, contextWindow: 128_000, compactions: 1 },
      { provider: "deepseek", id: "deepseek-v4-flash" },
    );
    expect(Object.keys(c).sort()).toEqual(["appVersion", "channel", "electron", "model", "os", "session"]);
    expect(c.session).toEqual({
      sittingMs: 1_260_000,
      turns: 7,
      messages: 15,
      contextTokens: null,
      contextWindow: 128_000,
      compactions: 1,
    });
  });

  it("has NO string field outside the fixed enums and ids", () => {
    const c = pulseContext(host, { sittingMs: 1, turns: 1, messages: 1, contextTokens: 1, contextWindow: 1, compactions: 0 }, null);
    const strings: string[] = [];
    const walk = (o: unknown, p: string): void => {
      if (typeof o === "string") strings.push(p);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
    };
    walk(c, "");
    expect(strings.sort()).toEqual([".appVersion", ".channel", ".electron", ".os.arch", ".os.platform", ".os.release", ".os.version"]);
  });

  it("coerces non-finite numbers to null rather than sending NaN", () => {
    const c = pulseContext(
      host,
      { sittingMs: NaN, turns: 3, messages: 4, contextTokens: Infinity, contextWindow: 5, compactions: 0 },
      null,
    ) as { session: Record<string, unknown> };
    expect(c.session.sittingMs).toBeNull();
    expect(c.session.contextTokens).toBeNull();
  });
});

describe("clampView", () => {
  it("accepts the app's view ids and refuses anything else", () => {
    expect(clampView("chat")).toBe("chat");
    expect(clampView("settings/mcp")).toBe("settings/mcp");
    expect(clampView("/Users/x")).toBeUndefined();
    expect(clampView("a".repeat(60))).toBeUndefined();
    expect(clampView(42)).toBeUndefined();
  });
});
