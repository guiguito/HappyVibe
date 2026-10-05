import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeProviderError } from "../src/main/providerError";
import { docUrl, docsIndexUrl, ERROR_GUIDE_LABEL, GUIDE_COPY } from "../src/renderer/src/docsLinks";
import { NAV } from "../src/renderer/src/components/Sidebar";
import vm from "node:vm";
import { guideLinkScript } from "../src/main/navGuard";
import { FIXED_SHORTCUTS } from "../src/renderer/src/shortcuts";
import { ONBOARDING_COPY } from "../src/renderer/src/onboarding";

const ROOT = path.join(import.meta.dirname, "..");
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const headings = (slug: string): string[] =>
  [...read("docs", "guide", "src", "content", "docs", `${slug}.md`).matchAll(/^#{2,4} (.+)$/gm)].map((m) => kebab(m[1]));

describe("guide URLs (Docs in the app, 2026-09-29)", () => {
  it("a slug alone keeps the per-screen shape", () => {
    expect(docUrl("mcp")).toBe("https://happyvibe.dev/docs/mcp/");
  });
  it("an anchor goes on the page's own address", () => {
    expect(docUrl("models", "add-a-custom-endpoint")).toBe("https://happyvibe.dev/docs/models/#add-a-custom-endpoint");
  });
  it("no link asks the site to hide its HappyVibe header — the in-app guide keeps the brand", () => {
    for (const u of [docUrl("mcp"), docUrl("models", "x"), docsIndexUrl]) expect(u).not.toContain("embed");
  });
  it("the front page has no slug and no double slash", () => {
    expect(docsIndexUrl).toBe("https://happyvibe.dev/docs/");
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
  // Picking another model is the whole fix — no page to send them to.
  ["The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", "model_not_found", undefined],
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

  it("the copy is one record", () => {
    expect(GUIDE_COPY).toEqual({ title: "User guide", close: "Close the guide" });
  });

  it("the view is a sandboxed iframe and ONE big circled close button — no top bar", () => {
    const v = read("src", "renderer", "src", "components", "GuideView.tsx");
    expect(v).toContain("<iframe");
    expect(v).toContain('sandbox="allow-scripts allow-same-origin allow-popups"');
    expect(v).toContain("onClick={onClose}");
    expect(v).toContain("size-11 rounded-full");
    expect(v).toMatch(/absolute[^"]*\btop-\d+[^"]*\bright-\d+/);
    // Absence: no bar of our own (the guide's header carries the HappyVibe brand), no escape button.
    expect(v).not.toContain("border-b-2");
    expect(v).not.toContain("externalDocUrl");
    expect(v).not.toMatch(/allow-top-navigation|allow-popups-to-escape-sandbox|allow-modals/);
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

  it("the guide takes the whole window: the app's sidebar is hidden, not unmounted", () => {
    // Two left columns (the app's and the guide's own) read as one too many. Hidden with CSS so its
    // open groups, scroll and any dialog survive "← Back"; unmounting would reset all of it.
    const at = app.indexOf("<Sidebar\n");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(Math.max(0, at - 200), at)).toMatch(/activeView === "guide" \? "hidden" : "contents"/);
    expect(app).not.toMatch(/activeView !== "guide" && \(\s*<Sidebar/);
  });

  it("App renders the view with Close going to the main chat screen", () => {
    expect(app).toMatch(/activeView === "guide" && \(\s*<GuideView/);
    expect(app).toMatch(/onClose=\{\(\) => navigate\(\{ view: "chat" \}\)\}/);
  });
});

describe("a click on a link that leaves the guide goes to the system browser", () => {
  // The CSP blocks a cross-origin FRAME navigation before the browser process sees it, so no
  // will-frame-navigate ever fires (seen in the running app) and the frame is left on an error page.
  // The click is caught INSIDE the frame instead: main injects this script when the frame loads.
  // It only ever runs in another origin's frame, so it is executed here against a stub DOM.
  const BASE = "https://happyvibe.dev/docs/";
  const ctx = { opened: [] as Array<[string, string]>, handlers: 0 };
  function click(href: string, opts: { defaultPrevented?: boolean; onLink?: boolean } = {}): { prevented: boolean; opened: Array<[string, string]> } {
    const opened: Array<[string, string]> = [];
    let handler: ((e: unknown) => void) | undefined;
    class FakeElement {
      closest(): unknown { return opts.onLink === false ? null : { href }; }
    }
    const box = {
      window: { open: (u: string, t: string) => { opened.push([u, t]); } },
      document: { addEventListener: (_t: string, h: (e: unknown) => void, capture: boolean) => { handler = h; expect(capture).toBe(true); } },
      location: { href: BASE + "models/" },
      URL,
      Element: FakeElement,
    };
    vm.runInNewContext(guideLinkScript(BASE), box);
    const ev = { target: new FakeElement(), defaultPrevented: !!opts.defaultPrevented, prevented: false, preventDefault() { this.prevented = true; } };
    handler!(ev);
    return { prevented: ev.prevented, opened };
  }
  test.each([
    ["https://github.com/guiguito/HappyVibe/edit/main/x.md", true],
    ["http://example.com/", true],
    ["mailto:a@b.c", true],
    ["https://happyvibe.dev/docs/mcp/", false],
    ["https://happyvibe.dev/docs/models/#add-a-custom-endpoint", false],
    ["https://happyvibe.dev/", true], // the site's home is not the guide
    ["https://happyvibe.dev.evil.com/docs/", true],
    ["javascript:alert(1)", false], // not ours to reroute — the frame's own sandbox handles it
    ["file:///etc/passwd", false],
  ])("%s is sent out: %s", (href, out) => {
    const r = click(href);
    expect(r.prevented).toBe(out);
    expect(r.opened).toEqual(out ? [[href, "_blank"]] : []);
  });

  it("leaves alone a click that is not on a link, or that something else already handled", () => {
    expect(click("https://github.com/x", { onLink: false })).toEqual({ prevented: false, opened: [] });
    expect(click("https://github.com/x", { defaultPrevented: true })).toEqual({ prevented: false, opened: [] });
  });

  it("installs its listener once per page, however many times main injects it", () => {
    let added = 0;
    const box = { window: {} as Record<string, unknown>, document: { addEventListener: () => { added++; } }, location: { href: BASE }, URL, Element: class {} };
    vm.createContext(box);
    vm.runInContext(guideLinkScript(BASE), box);
    vm.runInContext(guideLinkScript(BASE), box);
    expect(added).toBe(1);
    void ctx;
  });

  it("main injects it when the guide's frame loads — and only into a frame showing the guide", () => {
    const index = read("src", "main", "index.ts");
    expect(index).toContain("did-frame-finish-load");
    expect(index).toMatch(/webFrameMain\.fromId\(/);
    expect(index).toMatch(/frame\?\.url\.startsWith\(DOCS_BASE\)/);
    expect(index).toContain("guideLinkScript(DOCS_BASE)");
    // Absence: the handler that could never fire (the comment may still say why).
    expect(index).not.toMatch(/\.on\(['"]will-frame-navigate/);
    expect(index).not.toContain("frameNavAction");
  });

  it("the popup handler opens only web and mail links now that the guide can reach it", () => {
    const index = read("src", "main", "index.ts");
    const at = index.indexOf("setWindowOpenHandler((details)");
    expect(index.slice(at, at + 400)).toMatch(/navAction\(details\.url, [^\n]*\) === 'external'/);
  });

  it("the CSP allows exactly one frame origin, and script-src is untouched", () => {
    const html = read("src", "renderer", "index.html");
    const csp = /content="([^"]+)"/.exec(html.split("Content-Security-Policy")[1] ?? "")?.[1] ?? "";
    expect(/frame-src ([^;]*)/.exec(csp)?.[1]?.trim()).toBe("https://happyvibe.dev");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("default-src 'self'");
  });
});

describe("Esc closes the User guide (Docs in the app, 2026-09-29)", () => {
  const view = read("src", "renderer", "src", "components", "GuideView.tsx");
  const index = read("src", "main", "index.ts");

  it("with focus in the app, an Escape keydown on the window closes it — unless a dialog already used it", () => {
    expect(view).toMatch(/addEventListener\("keydown"/);
    expect(view).toMatch(/e\.key === "Escape" && !e\.defaultPrevented/);
  });

  it("with focus INSIDE the frame the app never sees the key: main forwards it, and the view acts only when the frame holds focus", () => {
    expect(index).toContain("before-input-event");
    expect(index).toMatch(/input\.key === 'Escape'/);
    expect(index).toContain("send('hv:esc-key')");
    expect(read("src", "preload", "index.ts")).toContain('"hv:esc-key"');
    expect(read("src", "renderer", "src", "hv.d.ts")).toContain("onEscapeKey(");
    // Not a second close when focus is in the app: that keydown already handled it.
    expect(view).toMatch(/document\.activeElement === frame\.current/);
  });

  it("main forwards the key without swallowing it — the guide's own search closes on Esc too", () => {
    const at = index.indexOf("before-input-event");
    expect(index.slice(at, at + 300)).not.toContain("preventDefault");
  });

  it("the shortcuts list and the guide page say so", () => {
    const esc = FIXED_SHORTCUTS.find((s) => s.keys === "Esc");
    expect(esc?.label).toBe("Close a dialog, a search or the User guide");
    expect(read("docs", "guide", "src", "content", "docs", "keyboard-shortcuts.md")).toContain(`| ${esc?.label} | Esc |`);
  });
});
