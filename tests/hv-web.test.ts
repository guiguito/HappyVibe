import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  WEB_TOOLS,
  WEB_URL_TOOLS,
  WEB_TOOL_DESCRIPTIONS,
  WEB_STEER_LINE,
  WEB_CAPS,
  isPrivateHost,
  webRefusal,
  webRuleName,
} from "../pi-runtime/extensions/hv-web";
import { browserRuleName } from "../pi-runtime/extensions/hv-browser";
import { SAFE_TOOLS, evaluate, type RulesFile } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";

const NO_RULES: RulesFile = { global: [], workspaces: {} };

describe("hv-web pure module (§32)", () => {
  it("names exactly the four PRD §32 tools, three of them host-gated", () => {
    expect([...WEB_TOOLS].sort()).toEqual(["web_crawl", "web_fetch", "web_map", "web_search"]);
    // web_search is deliberately absent: its argument is a query, not a target
    // host, so there is nothing a user could meaningfully approve.
    expect([...WEB_URL_TOOLS].sort()).toEqual(["web_crawl", "web_fetch", "web_map"]);
  });

  it("describes every tool it names — the Agent tools page renders these read-only", () => {
    for (const t of WEB_TOOLS) expect(WEB_TOOL_DESCRIPTIONS[t], t).toBeTruthy();
    // §32's vocabulary rule reaches the model's view too, not just the UI.
    for (const t of WEB_TOOLS) expect(WEB_TOOL_DESCRIPTIONS[t].toLowerCase(), t).not.toContain("firecrawl");
  });

  it("the steer line names the tools it steers to, and does not ban curl", () => {
    expect(WEB_STEER_LINE).toContain("web_fetch");
    expect(WEB_STEER_LINE).toContain("web_search");
    expect(WEB_STEER_LINE).toContain("browser");
    // §26 blocks `npm run dev &` because terminal_run is strictly better. That
    // does not carry here: `curl -X POST` has uses web_fetch cannot serve.
    expect(WEB_STEER_LINE).toContain("curl");
    expect(WEB_STEER_LINE.toLowerCase()).not.toContain("never use curl");
  });

  it("flags every private destination, and leaves lookalike public hosts alone", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "127.1.2.3",
      "[::1]",
      "::1",
      "10.0.0.5",
      "192.168.1.2",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.1.1",
      "0.0.0.0",
      "myhost.local",
      "api.internal",
      "foo.localhost",
      "[fe80::1]",
      "[fd00::1]",
    ]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    // The whole point of exact-hostname semantics: a hostile or merely
    // unlucky public name must not inherit the refusal.
    for (const h of ["localhost.evil.com", "172.32.0.1", "8.8.8.8", "docs.foo.com", "10.example.com", "internal.com"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it("refuses a private or non-http URL with a sentence naming the alternative", () => {
    expect(webRefusal("http://localhost:5173/")).toMatch(/browser_open/);
    expect(webRefusal("https://192.168.1.10/admin")).toMatch(/browser_open/);
    expect(webRefusal("file:///etc/passwd")).toMatch(/browser_open/);
    expect(webRefusal("file:///etc/passwd")).toMatch(/read/);
    expect(webRefusal("not a url")).toBeTruthy();
    expect(webRefusal(undefined)).toBeTruthy();
    expect(webRefusal("")).toBeTruthy();
    // …and lets a public page through.
    expect(webRefusal("https://docs.foo.com/guide")).toBeNull();
    expect(webRefusal("http://example.com")).toBeNull();
  });

  it("gates under the SAME rule name as the browser — one host, one fact", () => {
    expect(webRuleName("https://docs.foo.com/x")).toBe("browser:docs.foo.com");
    expect(webRuleName("https://docs.foo.com/x")).toBe(browserRuleName("https://docs.foo.com/x"));
    expect(webRuleName("not a url")).toBeNull();
  });

  it("web_search is allow-by-default; the URL tools are not — they gate by host", () => {
    expect(SAFE_TOOLS.has("web_search")).toBe(true);
    for (const t of WEB_URL_TOOLS) expect(SAFE_TOOLS.has(t), t).toBe(false);
    expect(evaluate(NO_RULES, { tool: "web_search", input: { query: "x" }, workspace: "/w" })).toMatchObject({
      action: "allow",
      source: "safe-default",
    });
    expect(
      evaluate(NO_RULES, { tool: "browser:docs.foo.com", input: { url: "https://docs.foo.com" }, workspace: "/w" }).action,
    ).toBe("ask");
    // Recorded honestly: the query still leaves the machine, to the web service.
    // A deny rule must therefore still bite the safe default.
    const deny: RulesFile = { global: [{ layer: "tool", pattern: "web_search", action: "deny" }], workspaces: {} };
    expect(evaluate(deny, { tool: "web_search", input: {}, workspace: "/w" }).action).toBe("deny");
  });

  it("all four pass the plan clamp, unlike browser_navigate's floor-ask", () => {
    // Headless reads: no cookies, no side effects. "pass" leaves the verdict
    // alone — the host gate still runs inside plan mode.
    for (const t of WEB_TOOLS) expect(gatePlanCall(t, { url: "https://x.y" }).kind, t).toBe("pass");
    // §28's pane is a persistent, possibly logged-in Chromium where a
    // navigation can act, so it keeps its per-call prompt. Different on purpose.
    expect(gatePlanCall("browser_navigate", { url: "https://x.y" }).kind).toBe("floor-ask");
  });

  it("caps are the spec's numbers", () => {
    expect(WEB_CAPS.fetch).toEqual({ defaultChars: 16_000, maxChars: 40_000 });
    expect(WEB_CAPS.search).toEqual({ defaultLimit: 5, maxLimit: 10, contentChars: 3_000 });
    expect(WEB_CAPS.map).toEqual({ defaultLimit: 100, maxLimit: 500 });
    expect(WEB_CAPS.crawl.maxLimit).toBe(30);
    expect(WEB_CAPS.crawl.maxDepth).toBe(3);
    expect(WEB_CAPS.crawl.totalChars).toBe(60_000);
    expect(WEB_CAPS.deadlineMs).toBe(70_000);
    expect(WEB_CAPS.crawlDeadlineMs).toBe(120_000);
    expect(WEB_CAPS.bodyBytes).toBe(8 * 1024 * 1024);
  });
});

/**
 * The bridge's own wiring, pinned by SOURCE SCAN — `summarize`, `permTool` and
 * the steer hook are closures inside the extension factory, so there is nothing
 * to import. This is the tests/modal-layer.test.ts pattern, and it is the right
 * shape here: what must be true is partly an ABSENCE (intent is never the
 * prompt's headline), and an absence is exactly what a behavioural test on a
 * live model does not reliably fail on.
 */
describe("bridge wiring for §32", () => {
  const bridge = fs.readFileSync(path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");

  it("summarises the URL tools by url and web_search by query — never by intent", () => {
    expect(bridge).toMatch(/WEB_URL_TOOLS\.has\(toolName\)[\s\S]{0,80}input\.url\.slice/);
    expect(bridge).toMatch(/toolName === "web_search"[\s\S]{0,80}input\.query\.slice/);
  });

  it("gates the URL tools under browserRuleName, in permTool", () => {
    expect(bridge).toMatch(/WEB_URL_TOOLS\.has\(tool\)[\s\S]{0,80}browserRuleName\(input\.url\)/);
    expect(bridge).toMatch(/webHost/);
  });

  it("appends the steer line only while the group is on", () => {
    expect(bridge).toMatch(/builtins\.web \? "\\n\\n" \+ WEB_STEER_LINE/);
  });

  it("refuses a private host BEFORE the gate, and audits it as source:web", () => {
    expect(bridge).toMatch(/webRefusal\(input\.url\)/);
    expect(bridge).toMatch(/source: "web"/);
    // The AuditSource union must know the value, or the renderer's filter and
    // the bridge disagree about a row that exists.
    expect(bridge).toMatch(/type AuditSource =[^\n]*"web"/);
  });
});

/**
 * §32's vocabulary rule, enforced where it is easiest to break: the page a user
 * actually reads. The backend is named ONCE, in the helper under the custom URL
 * field, and only after "Your own" is chosen — because a self-hoster has to
 * know what to run. Everywhere else the words are the app's.
 */
describe("the Built-in tools page never names the backend (§32)", () => {
  const raw = fs.readFileSync(path.resolve(__dirname, "../src/renderer/src/components/BuiltinToolsBlock.tsx"), "utf8");
  // Comments are the author talking; only the strings are the PRODUCT talking,
  // and the product is what the rule is about. (Written the other way first,
  // where the test failed on its own explanation of the rule.)
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("says Firecrawl exactly once, in the custom-service helper", () => {
    expect(src.match(/Firecrawl/g)?.length).toBe(1);
    expect(src).toContain("Firecrawl-compatible API, v2");
  });

  it("never says scrape or crawl in the row's own copy", () => {
    expect(src.toLowerCase()).not.toContain("scrape");
    expect(src.toLowerCase()).not.toMatch(/\bcrawl\b/);
  });

  it("discloses that the service setting needs no respawn, unlike its neighbours", () => {
    expect(src).toMatch(/Applies to the next call/);
  });
});
