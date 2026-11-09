import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Web mode compiles the preload a second time against src/renderer/web/electron.ts
 * (no DOM in this suite, so the contract is pinned on the sources). The day the
 * preload calls an `ipcRenderer` method the shim lacks, the desktop app works
 * and every browser tab dies at boot — so the list is derived from the preload,
 * never written down.
 */
const ROOT = path.join(__dirname, "..");
const read = (p: string): string => readFileSync(path.join(ROOT, p), "utf8");
const preload = read("src/preload/index.ts");
const shim = read("src/renderer/web/electron.ts");

const used = (obj: string): string[] => [...new Set([...preload.matchAll(new RegExp(`\\b${obj}\\.(\\w+)\\(`, "g"))].map((m) => m[1]))];

describe("web shim", () => {
  it("implements every ipcRenderer method the preload calls", () => {
    const methods = used("ipcRenderer");
    expect(methods.length).toBeGreaterThan(3);
    const shimBody = shim.slice(shim.indexOf("export const ipcRenderer"));
    for (const m of methods) expect(shimBody, `ipcRenderer.${m}`).toMatch(new RegExp(`\\n  ${m}\\(`));
  });

  it("exports everything the preload imports from electron", () => {
    const imported = /import\s*\{([^}]+)\}\s*from\s*"electron"/.exec(preload)![1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of imported) expect(shim, name).toContain(`export const ${name} =`);
    for (const m of used("contextBridge")) expect(shim).toContain(`${m}(`);
    for (const m of used("webUtils")) expect(shim).toContain(`${m}:`);
  });

  it("the preload's one Node global is the one the build rewrites", () => {
    // `process.platform` is rewritten to the server's platform; any OTHER
    // `process.` use would be undefined in a page.
    expect([...preload.matchAll(/\bprocess\.(\w+)/g)].map((m) => m[1]).filter((p) => p !== "platform")).toEqual([]);
    expect(read("electron.vite.config.ts")).toContain("globalThis.__hvPlatform");
    expect(shim).toContain("__hvPlatform");
  });

  it("web.html has index.html's CSP, unchanged — a tab is not given a looser page", () => {
    const csp = (html: string): string => /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
    expect(csp(read("src/renderer/web.html"))).toBe(csp(read("src/renderer/index.html")));
  });

  it("the preload runs before the app in web.html, and the app only starts once it succeeded", () => {
    const html = read("src/renderer/web.html");
    expect(html.indexOf("../preload/index.ts")).toBeGreaterThan(0);
    expect(html.indexOf("../preload/index.ts")).toBeLessThan(html.indexOf("./web/start.ts"));
    expect(html).not.toContain("/src/main.tsx");
    // A static import would make the app a dependency of the entry — evaluated BEFORE the preload.
    expect(read("src/renderer/web/start.ts")).toMatch(/^void import\("\.\.\/src\/main"\);$/m);
  });

  /**
   * Cut off from the server, the tab says what is wrong and keeps trying: a
   * stop is waited out (never a reload into a server that is gone), the count
   * survives the reloads that reconnecting is made of, and a server that came
   * back with a new token is named as such.
   */
  describe("when the server is out of reach", () => {
    const onclose = shim.slice(shim.indexOf("s.onclose ="), shim.indexOf("\nconnect();"));

    it("a stopped server is waited for; only an unknown window reloads at once", () => {
      expect(onclose).toMatch(/ev\.code === 4004\) return reload\(\)/);
      expect(onclose).toMatch(/ev\.code === 4010\) \{[^}]*cutOff\(/);
      expect(read("src/main/web/webWindow.ts")).toMatch(/socket\?\.close\(4010,/);
    });

    it("the reason, the time and a way to try now are on the card", () => {
      const show = shim.slice(shim.indexOf("function showLost"), shim.indexOf("function probe"));
      expect(show).toContain('action: "Retry now", onAction: probe, detail: lost.problem');
      expect(show).toContain("since(elapsed)");
      expect(show).toContain("still running in its terminal");
      expect(shim).toMatch(/ticker \?\?= setInterval\(showLost, 1000\)/);
    });

    it("the count goes on across reloads and ends when a socket opens", () => {
      expect(shim).toMatch(/store\("session", LOST, lost && JSON\.stringify\(lost\)\)/);
      const open = shim.slice(shim.indexOf("s.onopen ="), shim.indexOf("s.onmessage ="));
      expect(open).toMatch(/lost = null;\s+lostBefore = null;\s+keepLost\(\);/);
    });

    it("a reload that finds no server shows the card instead of crashing", () => {
      const at = shim.indexOf('post("/hv/hello"');
      const block = shim.slice(shim.lastIndexOf("try {", at), shim.indexOf("const key = hello.key", at));
      expect(block).toContain("err instanceof DOMException");
      expect(block).toContain("cutOff(");
    });

    it("a kept token the server refuses means it started again with a new link", () => {
      expect(shim).toMatch(/stop\(\.\.\.\(fromLink \? NEED_LINK : RESTARTED\)\)/);
    });
  });
});
