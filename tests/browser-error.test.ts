import { describe, it, expect } from "vitest";
import {
  ERR_CONNECTION_REFUSED, ERR_NAME_NOT_RESOLVED, ERR_SSL_PROTOCOL_ERROR, ERR_EMPTY_RESPONSE,
  describeBrowserError, resolveTypedUrl, toHttp,
} from "../src/renderer/src/browserError";

describe("resolveTypedUrl (§28 round 1)", () => {
  it("sends local addresses to http — a dev server is the whole use case", () => {
    expect(resolveTypedUrl("localhost:5173")).toEqual({ url: "http://localhost:5173" });
    expect(resolveTypedUrl("127.0.0.1:3000/app")).toEqual({ url: "http://127.0.0.1:3000/app" });
    expect(resolveTypedUrl("mymachine.local")).toEqual({ url: "http://mymachine.local" });
  });

  it("sends everything else to https", () => {
    expect(resolveTypedUrl("example.com")).toEqual({ url: "https://example.com" });
    expect(resolveTypedUrl("news.ycombinator.com/news")).toEqual({ url: "https://news.ycombinator.com/news" });
  });

  it("respects a scheme the user typed", () => {
    expect(resolveTypedUrl("http://example.com")).toEqual({ url: "http://example.com" });
    expect(resolveTypedUrl("https://example.com")).toEqual({ url: "https://example.com" });
  });

  it("NAMES an unsupported scheme instead of prefixing it into nonsense", () => {
    // The old behaviour produced "https://file:///etc/passwd" and a silent block.
    expect(resolveTypedUrl("file:///etc/passwd")).toEqual({ unsupported: "file" });
    expect(resolveTypedUrl("about:blank")).toEqual({ unsupported: "about" });
    expect(resolveTypedUrl("chrome://settings")).toEqual({ unsupported: "chrome" });
  });

  it("does not mistake host:port for a scheme", () => {
    expect(resolveTypedUrl("myhost:8080")).toEqual({ url: "https://myhost:8080" });
  });

  it("ignores empty input", () => {
    expect(resolveTypedUrl("   ")).toBeNull();
  });
});

describe("describeBrowserError", () => {
  it("offers http:// when TLS met something that is not TLS", () => {
    for (const code of [ERR_SSL_PROTOCOL_ERROR, ERR_EMPTY_RESPONSE]) {
      const copy = describeBrowserError("https://localhost:3000/", code, "ERR_SSL_PROTOCOL_ERROR");
      expect(copy.retryAs, `code ${code}`).toBe("http://localhost:3000/");
      expect(copy.retryLabel).toMatch(/http:\/\//);
      // The headline is a sentence, not a Chromium constant.
      expect(copy.title).not.toMatch(/ERR_/);
    }
  });

  it("explains a refused connection, and still offers the scheme swap", () => {
    const copy = describeBrowserError("https://localhost:9999/", ERR_CONNECTION_REFUSED, "ERR_CONNECTION_REFUSED");
    expect(copy.title).toMatch(/listening/i);
    expect(copy.retryAs).toBe("http://localhost:9999/");
  });

  it("explains an unresolvable host and offers NO retry — retrying cannot help", () => {
    const copy = describeBrowserError("https://nope.invalid/", ERR_NAME_NOT_RESOLVED, "ERR_NAME_NOT_RESOLVED");
    expect(copy.title).toMatch(/doesn't exist/i);
    expect(copy.retryAs).toBeUndefined();
  });

  it("falls back to the raw string for a code it has nothing to add about", () => {
    const copy = describeBrowserError("https://example.com/", -999, "ERR_SOMETHING_NEW (-999)");
    expect(copy.body).toBe("ERR_SOMETHING_NEW (-999)");
    expect(copy.retryAs).toBeUndefined();
  });

  it("never offers an http retry for a page already on http", () => {
    expect(describeBrowserError("http://localhost:3000/", ERR_SSL_PROTOCOL_ERROR, "x").retryAs).toBeUndefined();
    expect(toHttp("http://x/")).toBeNull();
  });
});
