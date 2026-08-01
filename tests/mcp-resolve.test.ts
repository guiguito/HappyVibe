import { describe, expect, test } from "vitest";
import { resolveMcpConfig } from "../src/main/mcpResolve";

/**
 * Catalog servers store their key encrypted and write only a `${HV_MCP_…}`
 * placeholder into mcp.json. The Pi runtime resolves it (pi-mcp-adapter
 * interpolates env + headers), but MAIN's own probe does not run with those
 * vars in process.env — so without this, a key-based server always probed as
 * needs-auth/failed and its status badge lied.
 *
 * Mirrors the adapter's contract exactly: `${VAR}` and `$env:VAR`, in `env` and
 * `headers` only, never in url/command/args.
 * See tests/mcp-adapter-interpolation.test.ts.
 */
const ENV = { HV_MCP_FIRECRAWL_APIKEY: "sk-real-key", OTHER: "x" };

describe("resolveMcpConfig", () => {
  test("substitutes ${VAR} in headers", () => {
    const out = resolveMcpConfig(
      { url: "https://x/mcp", headers: { Authorization: "Bearer ${HV_MCP_FIRECRAWL_APIKEY}" } },
      ENV,
    );
    expect(out.headers).toEqual({ Authorization: "Bearer sk-real-key" });
  });

  test("substitutes $env:VAR too", () => {
    const out = resolveMcpConfig({ url: "https://x/mcp", headers: { A: "$env:OTHER" } }, ENV);
    expect(out.headers).toEqual({ A: "x" });
  });

  test("substitutes in stdio env values", () => {
    const out = resolveMcpConfig(
      { command: "npx", args: ["-y", "p"], env: { KEY: "${HV_MCP_FIRECRAWL_APIKEY}" } },
      ENV,
    );
    expect(out.env).toEqual({ KEY: "sk-real-key" });
  });

  test("never touches url, command or args", () => {
    const cfg = { url: "https://x/${HV_MCP_FIRECRAWL_APIKEY}/mcp", command: "${OTHER}", args: ["${OTHER}"] };
    const out = resolveMcpConfig(cfg, ENV);
    expect(out.url).toBe("https://x/${HV_MCP_FIRECRAWL_APIKEY}/mcp");
    expect(out.command).toBe("${OTHER}");
    expect(out.args).toEqual(["${OTHER}"]);
  });

  test("an unknown variable resolves to empty string, like the adapter", () => {
    const out = resolveMcpConfig({ url: "https://x/mcp", headers: { A: "Bearer ${NOPE}" } }, ENV);
    expect(out.headers).toEqual({ A: "Bearer " });
  });

  test("leaves a config with no placeholders untouched", () => {
    const cfg = { url: "https://x/mcp", headers: { A: "plain" } };
    expect(resolveMcpConfig(cfg, ENV)).toEqual(cfg);
  });

  test("does not mutate the input", () => {
    const cfg = { url: "https://x/mcp", headers: { A: "${OTHER}" } };
    resolveMcpConfig(cfg, ENV);
    expect(cfg.headers.A).toBe("${OTHER}");
  });
});
