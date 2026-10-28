import { describe, expect, it } from "vitest";
import { DEFAULT_SERVE_PORT, isLoopback, serveConfig } from "../src/main/web/serveConfig";

describe("HV_SERVE", () => {
  it("unset, empty or off means the desktop app exactly as before", () => {
    for (const v of [undefined, "", "0", "false", "off", "no"]) expect(serveConfig({ HV_SERVE: v })).toBeNull();
  });

  it("a port serves on loopback; a yes serves on the default port", () => {
    expect(serveConfig({ HV_SERVE: "9090" })).toEqual({ host: "127.0.0.1", port: 9090 });
    for (const v of ["1", "true", "on", "yes", " YES "]) {
      expect(serveConfig({ HV_SERVE: v })).toEqual({ host: "127.0.0.1", port: DEFAULT_SERVE_PORT });
    }
  });

  it("refuses a value that cannot be what was meant, rather than serving somewhere unasked", () => {
    for (const v of ["80", "70000", "abc", "8787x", "-1"]) expect(() => serveConfig({ HV_SERVE: v })).toThrow(/HV_SERVE/);
  });

  it("takes a host and a fixed token, and refuses a weak token", () => {
    expect(serveConfig({ HV_SERVE: "1", HV_SERVE_HOST: "0.0.0.0", HV_SERVE_TOKEN: "abcdefghijklmnopqrstuv" })).toEqual({
      host: "0.0.0.0",
      port: DEFAULT_SERVE_PORT,
      token: "abcdefghijklmnopqrstuv",
    });
    // 128 bits is the floor: a token opens a shell.
    expect(() => serveConfig({ HV_SERVE: "1", HV_SERVE_TOKEN: "abcdefghijklmnopqrstu" })).toThrow(/HV_SERVE_TOKEN/);
    expect(() => serveConfig({ HV_SERVE: "1", HV_SERVE_TOKEN: "has spaces in it, still not ok?" })).toThrow(/HV_SERVE_TOKEN/);
  });

  it("knows which hosts are this machine only", () => {
    for (const h of ["127.0.0.1", "localhost", "::1", "[::1]"]) expect(isLoopback(h)).toBe(true);
    for (const h of ["0.0.0.0", "192.168.1.2", "::"]) expect(isLoopback(h)).toBe(false);
  });
});
