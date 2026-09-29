import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeProviderError } from "../src/main/providerError";
import { docUrl, docsIndexUrl, ERROR_GUIDE_LABEL, externalDocUrl, GUIDE_COPY } from "../src/renderer/src/docsLinks";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { frameNavAction } from "../src/main/navGuard";
import { ONBOARDING_COPY } from "../src/renderer/src/onboarding";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const headings = (slug: string): string[] =>
  [...read("docs", "guide", "src", "content", "docs", `${slug}.md`).matchAll(/^#{2,4} (.+)$/gm)].map((m) => kebab(m[1]));

describe("guide URLs (Docs in the app, 2026-09-29)", () => {
  it("a slug alone keeps the per-screen shape", () => {
    expect(docUrl("mcp")).toBe("https://happyvibe.dev/docs/mcp/?embed=1");
  });
  it("an anchor goes AFTER the query, or the browser reads it as part of the path", () => {
    expect(docUrl("models", "add-a-custom-endpoint")).toBe("https://happyvibe.dev/docs/models/?embed=1#add-a-custom-endpoint");
  });
  it("the front page has no slug and no double slash", () => {
    expect(docsIndexUrl).toBe("https://happyvibe.dev/docs/?embed=1");
    expect(docsIndexUrl.replace("https://", "")).not.toContain("//");
  });
  it("the error-card label is one string", () => {
    expect(ERROR_GUIDE_LABEL).toBe("Read the guide ↗");
  });
});

const ENDPOINT = { slug: "models", anchor: "add-a-custom-endpoint" };
const DOCS: Array<[string, string, { slug: string; anchor: string } | undefined]> = [
  ["401 Unauthorized", "auth", { slug: "connect-a-model", anchor: "if-the-provider-rejects-the-key" }],
  ["404 model not found", "model_not_found", ENDPOINT],
  ["maximum context length exceeded", "context_overflow", ENDPOINT],
  ["insufficient_quota", "balance", undefined],
  ["429 Too Many Requests", "rate_limit", undefined],
  ["529 status code (no body)", "overloaded", undefined],
  ["503 Service Unavailable", "server", undefined],
  ["fetch failed", "network", undefined],
  ["something odd happened", "other", undefined],
  ["", "other", undefined],
];

describe("provider errors link to the guide only where a page fixes them", () => {
  test.each(DOCS)("%j is %s", (raw, kind, doc) => {
    const d = describeProviderError(raw);
    expect(d.kind).toBe(kind);
    expect(d.doc).toEqual(doc);
  });
  it("every linked page and anchor exists in the guide", () => {
    for (const [, , doc] of DOCS) if (doc) expect(headings(doc.slug), `${doc.slug}#${doc.anchor}`).toContain(doc.anchor);
  });
  it("providerError.ts stays import-free — the renderer imports it", () => {
    expect(read("src", "main", "providerError.ts")).not.toMatch(/^import /m);
  });
  it("§39: usage statistics read the kind and never the doc", () => {
    expect(read("src", "main", "usage", "turns.ts")).not.toMatch(/\.doc\b/);
  });
  it("the card links only when the item carries a doc, through the shared label", () => {
    const t = read("src", "renderer", "src", "components", "Transcript.tsx");
    expect(t).toMatch(/it\.doc && onOpenDoc/);
    expect(t).toContain("ERROR_GUIDE_LABEL");
  });
  it("App hands the error's doc to the card and the card's opener is openDocs", () => {
    const app = read("src", "renderer", "src", "App.tsx");
    expect(app).toMatch(/doc: info\.doc/);
    expect(app).toMatch(/onOpenDoc=\{openDocs\}/);
  });
});

describe("the setup dialog links to the setup guide", () => {
  const dialog = read("src", "renderer", "src", "components", "OnboardingDialog.tsx");
  const app = read("src", "renderer", "src", "App.tsx");
  it("the copy is one string", () => expect(ONBOARDING_COPY.guideLink).toBe("Read the setup guide ↗"));
  it("the dialog renders it in the brand column, and not on the celebration screen", () => {
    expect(dialog).toMatch(/!complete && !welcome && \(\s*<button[^>]*onClick=\{onOpenGuide\}/);
    expect(dialog).toContain("C.guideLink");
  });
  it("it always opens the SYSTEM browser — a pane opened behind a modal is invisible", () => {
    const at = app.indexOf("onOpenGuide=");
    expect(at).toBeGreaterThan(-1);
    const call = app.slice(at, at + 200);
    expect(call).toContain('window.hv.openExternal(docUrl("first-launch"))');
    expect(call).not.toContain("openDocs");
  });
});

describe("Help ▸ HappyVibe Guide (Docs in the app, 2026-09-29)", () => {
  const index = read("src", "main", "index.ts");
  it("the menu is set on EVERY platform, not only inside the macOS branch", () => {
    expect(index).not.toMatch(/if \(process\.platform === 'darwin'\) \{\s*Menu\.setApplicationMenu/);
    expect(index).toMatch(/Menu\.setApplicationMenu\(/);
  });
  it("Help holds the guide item", () => {
    expect(index).toMatch(/role: 'help'/);
    expect(index).toMatch(/label: 'HappyVibe Guide'/);
  });
  it("F1 is Windows/Linux only — on macOS it is a hardware key", () => {
    expect(index).toMatch(/isMac \? \{\} : \{ accelerator: 'F1' \}/);
  });
  it("the click goes to the focused window, and with none open opens the system browser", () => {
    expect(index).toMatch(/getFocusedWindow\(\)/);
    expect(index).toContain("send('hv:open-docs')");
    expect(index).toMatch(/shell\.openExternal\(DOCS_BASE\)/);
  });
  it("Windows and Linux get File ▸ Quit where macOS has the app menu", () => {
    expect(index).toMatch(/role: 'fileMenu'/);
  });
  it("preload, the typings and App all carry the event", () => {
    expect(read("src", "preload", "index.ts")).toContain('"hv:open-docs"');
    expect(read("src", "renderer", "src", "hv.d.ts")).toContain("onOpenDocs(");
    expect(read("src", "renderer", "src", "App.tsx")).toMatch(/onOpenDocs\(\(\) => openDocsRef\.current\(docsIndexUrl\)\)/);
  });
  it("the shortcuts note records F1 beside Mod-Shift-n, because findConflict cannot see menu accelerators", () => {
    expect(read("src", "renderer", "src", "shortcuts.ts")).toMatch(/F1/);
  });
});


describe("the guide is a page inside the app (Docs in the app, 2026-09-29)", () => {
  const app = read("src", "renderer", "src", "App.tsx");
  const sidebar = read("src", "renderer", "src", "components", "Sidebar.tsx");

  it("Open in browser drops ?embed=1 but keeps the anchor", () => {
    expect(externalDocUrl("https://happyvibe.dev/docs/models/?embed=1#add-a-custom-endpoint")).toBe(
      "https://happyvibe.dev/docs/models/#add-a-custom-endpoint",
    );
    expect(externalDocUrl(docsIndexUrl)).toBe("https://happyvibe.dev/docs/");
  });

  it("the copy is one record", () => {
    expect(GUIDE_COPY).toEqual({ title: "User guide", back: "← Back", external: "Open in browser ↗" });
  });

  it("the view is a sandboxed iframe with a Back button and an Open-in-browser escape", () => {
    const v = read("src", "renderer", "src", "components", "GuideView.tsx");
    expect(v).toContain("<iframe");
    expect(v).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(v).toContain("onClick={onBack}");
    expect(v).toContain("externalDocUrl(url)");
    // Absence: the frame may not navigate the app or open windows.
    expect(v).not.toMatch(/allow-top-navigation|allow-popups|allow-modals/);
  });

  it("the row sits BELOW the last settings group, and is outside NAV like Schedules", () => {
    expect(NAV.some((n) => (n.view as string) === "guide")).toBe(false);
    expect(sidebar).toMatch(/\| "guide"/);
    const groups = sidebar.indexOf("GROUPS.map(");
    const row = sidebar.indexOf("data-hv-guide-row");
    expect(groups).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(groups);
  });

  it("openDocs shows the guide page — no browser pane — except before a model exists", () => {
    const at = app.indexOf("const openDocs");
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, at + 900);
    expect(body).toContain('navigate({ view: "guide" })');
    expect(body).not.toContain("newBrowser");
    // The one fallback: the app is locked to Models until a model is connected.
    expect(body).toMatch(/keyState === "missing"[\s\S]{0,120}openExternal\(url\)/);
  });

  it("App renders the view with Back going to the main chat screen", () => {
    expect(app).toMatch(/activeView === "guide" && \(\s*<GuideView/);
    expect(app).toMatch(/onBack=\{\(\) => navigate\(\{ view: "chat" \}\)\}/);
  });
});

describe("the frame showing the guide cannot wander off it", () => {
  const G = "https://happyvibe.dev/docs/models/?embed=1";
  test.each([
    [G, "https://happyvibe.dev/docs/mcp/?embed=1", "allow"],
    [G, "https://happyvibe.dev/docs/?embed=1#x", "allow"],
    [G, "https://github.com/x/y", "external"],
    [G, "mailto:a@b.c", "external"],
    [G, "https://happyvibe.dev/", "external"], // the site's home is not the guide
    [G, "https://happyvibe.dev.evil.com/docs/", "external"],
    [G, "file:///etc/passwd", "block"],
    ["about:srcdoc", "https://example.com/", "allow"], // the editor's HTML preview is not our frame
    ["about:blank", "https://happyvibe.dev/docs/?embed=1", "allow"], // the initial load
  ])("frame at %s going to %s is %s", (frameUrl, url, want) => {
    expect(frameNavAction(frameUrl, url)).toBe(want);
  });

  it("main wires it to will-frame-navigate, for subframes only", () => {
    const index = read("src", "main", "index.ts");
    expect(index).toContain("will-frame-navigate");
    expect(index).toMatch(/isMainFrame/);
    expect(index).toContain("frameNavAction(");
  });

  it("the CSP allows exactly one frame origin, and script-src is untouched", () => {
    const html = read("src", "renderer", "index.html");
    const csp = /content="([^"]+)"/.exec(html.split("Content-Security-Policy")[1] ?? "")?.[1] ?? "";
    expect(/frame-src ([^;]*)/.exec(csp)?.[1]?.trim()).toBe("https://happyvibe.dev");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("default-src 'self'");
  });
});
