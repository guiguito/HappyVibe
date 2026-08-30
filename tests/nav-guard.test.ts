import { describe, expect, it } from "vitest";
import { navAction } from "../src/main/navGuard";

/**
 * The renderer's own URL, as it looks in a packaged build. A relative markdown
 * link resolves against THIS, which is the whole hazard.
 */
const APP = "file:///Applications/HappyVibe.app/Contents/Resources/app.asar/out/renderer/index.html";

describe("navAction", () => {
  it("lets the renderer's own URL through", () => {
    expect(navAction(APP, APP)).toBe("allow");
  });

  it("sends http(s) and mailto to the OS browser", () => {
    expect(navAction("https://keepachangelog.com/en/1.1.0/", APP)).toBe("external");
    expect(navAction("http://localhost:5173/x", APP)).toBe("external");
    expect(navAction("mailto:hi@example.com", APP)).toBe("external");
  });

  // The whole point. A RELATIVE markdown link resolves against the renderer's
  // own URL and is neither http nor the current page, so the old guard's
  // `if (notCurrent && isHttp)` let it fall through un-prevented and navigate
  // the SPA away, with no way back but restarting the app.
  it("BLOCKS a resolved relative link rather than navigating the app away", () => {
    const resolved = new URL("docs/prd.md", APP).href;
    expect(resolved).not.toBe(APP); // it really is a different page
    expect(navAction(resolved, APP)).toBe("block");
  });

  it("blocks other schemes it does not understand", () => {
    expect(navAction("file:///etc/passwd", APP)).toBe("block");
    expect(navAction("javascript:alert(1)", APP)).toBe("block");
    expect(navAction("data:text/html,<h1>x", APP)).toBe("block");
  });

  // Dev serves the renderer over http, so the current URL is itself http —
  // "allow" has to win over "external" or a reload would bounce to Chrome.
  it("allows the current URL even when it is http (the dev server)", () => {
    const dev = "http://localhost:5173/";
    expect(navAction(dev, dev)).toBe("allow");
  });
});
