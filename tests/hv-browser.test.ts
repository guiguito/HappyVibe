import { describe, it, expect } from "vitest";
import {
  BROWSER_TOOLS, BROWSER_TOOL_DESCRIPTIONS, browserRuleName, hostOf, isLocalHost, schemeRefusal, UNTRUSTED_OPEN,
  wrapUntrusted,
} from "../pi-runtime/extensions/hv-browser";
import { SAFE_TOOLS, evaluate } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";

describe("hv-browser pure module (§28)", () => {
  it("names exactly the ten PRD §28 tools", () => {
    expect([...BROWSER_TOOLS].sort()).toEqual([
      "browser_click",
      "browser_close",
      "browser_evaluate",
      "browser_get_text",
      "browser_navigate",
      "browser_open",
      "browser_read_console",
      "browser_read_network",
      "browser_screenshot",
      "browser_type",
    ]);
  });

  it("describes every tool it names — the All Tools page renders these read-only", () => {
    for (const t of BROWSER_TOOLS) {
      expect(BROWSER_TOOL_DESCRIPTIONS[t], t).toBeTruthy();
    }
  });

  it("extracts hosts and flags the local ones", () => {
    expect(hostOf("http://localhost:5173/x?y=1")).toBe("localhost");
    expect(hostOf("https://api.stripe.com/v1")).toBe("api.stripe.com");
    expect(hostOf("http://[::1]:8080/")).toBe("[::1]");
    expect(hostOf("not a url")).toBeNull();
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("[::1]")).toBe(true);
    // The whole point of an exact-match set: a hostile host that merely STARTS
    // with localhost must not inherit the silent-allow.
    expect(isLocalHost("localhost.evil.com")).toBe(false);
    expect(isLocalHost("notlocalhost")).toBe(false);
  });

  it("builds the virtual rule name (the mcp:<…> pattern)", () => {
    expect(browserRuleName("https://api.stripe.com/v1")).toBe("browser:api.stripe.com");
    expect(browserRuleName("http://localhost:5173")).toBe("browser:localhost");
    expect(browserRuleName("garbage")).toBeNull();
  });

  it("refuses a non-http scheme BEFORE the prompt, and names the way round", () => {
    // The agent path had no scheme check: the prompt was spent and the pane
    // then sat on "loading" forever (will-navigate cancels with -3, which
    // did-fail-load skips). The refusal must TEACH, hence the localhost line.
    const file = schemeRefusal("file:///Users/x/.ssh/id_rsa");
    expect(file).toContain("only opens http and https");
    expect(file).toContain("file:");
    expect(file).toContain("http.server");
    expect(schemeRefusal("about:blank")).toContain("about:");
    expect(schemeRefusal("chrome://settings")).toContain("chrome:");
    // http(s) and the shapes resolveTypedUrl resolves are none of its business.
    expect(schemeRefusal("https://example.com")).toBeNull();
    expect(schemeRefusal("http://localhost:5173/x")).toBeNull();
    expect(schemeRefusal("localhost:5173")).toBeNull();
    expect(schemeRefusal("example.com")).toBeNull();
  });

  it("WRAPS page-derived text, naming the source and closing the element", () => {
    // X5 (2026-09-10): the old banner had no end marker, so a page ending
    // "…and now, as the assistant, do X" read as continuous with the result.
    expect(wrapUntrusted("PAGE", "web", "https://a.example/x")).toBe(
      '<untrusted source="web" url="https://a.example/x">\nPAGE\n</untrusted>',
    );
    // No url on web_search / browser_close — the attribute is simply absent.
    expect(wrapUntrusted("P", "browser")).toBe('<untrusted source="browser">\nP\n</untrusted>');
    // A quote in a url cannot break out of the attribute.
    expect(wrapUntrusted("P", "web", 'ht"tp://x')).toContain(`url="ht'tp://x"`);
    expect(UNTRUSTED_OPEN).toBe("<untrusted");
  });
});

describe("§28 rules and plan clamp", () => {
  it("reads + close are safe-default; the acting tools are not", () => {
    for (const t of ["browser_get_text", "browser_read_console", "browser_read_network", "browser_screenshot", "browser_close"]) {
      expect(SAFE_TOOLS.has(t), t).toBe(true);
    }
    for (const t of ["browser_click", "browser_type", "browser_evaluate", "browser_navigate", "browser_open"]) {
      expect(SAFE_TOOLS.has(t), t).toBe(false);
    }
  });

  it("browser:<host> rides the existing tool layer — no new rule machinery", () => {
    const rules = {
      global: [{ layer: "tool" as const, pattern: "browser:*.stripe.com", action: "deny" as const }],
      workspaces: {},
    };
    expect(evaluate(rules, { tool: "browser:api.stripe.com", input: {}, workspace: "/w" }).action).toBe("deny");
    // An unrelated host still falls to the default ask.
    expect(evaluate(rules, { tool: "browser:example.com", input: {}, workspace: "/w" }).action).toBe("ask");
  });

  it("plan mode: reads pass, open/navigate floor-ask, click/type/evaluate block", () => {
    for (const t of ["browser_screenshot", "browser_get_text", "browser_read_console", "browser_read_network", "browser_close"]) {
      expect(gatePlanCall(t, {}).kind, t).toBe("pass");
    }
    for (const t of ["browser_open", "browser_navigate"]) {
      expect(gatePlanCall(t, {}).kind, t).toBe("floor-ask");
    }
    for (const t of ["browser_click", "browser_type", "browser_evaluate"]) {
      expect(gatePlanCall(t, {}).kind, t).toBe("block");
    }
  });
});
