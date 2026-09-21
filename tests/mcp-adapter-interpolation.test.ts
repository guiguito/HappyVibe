/**
 * CONTRACT test (adapter-pin-bump gate).
 * The curated catalog (§13 round 8) stores API keys safeStorage-encrypted and
 * writes only a `${HV_MCP_<NAME>_KEY}` placeholder into mcp.json. That is only
 * safe while the adapter interpolates `${VAR}` in stdio env and remote headers.
 * If a pi-mcp-adapter pin bump changes the syntax, the scope, or the
 * missing-variable behaviour, this test breaks — that is the gate.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ADAPTER_UTILS = "../pi-runtime/node_modules/pi-mcp-adapter/utils.ts";

let prior: string | undefined;
beforeEach(() => {
  prior = process.env.HV_MCP_TEST_KEY;
  process.env.HV_MCP_TEST_KEY = "secret-value";
});
afterEach(() => {
  if (prior !== undefined) process.env.HV_MCP_TEST_KEY = prior;
  else delete process.env.HV_MCP_TEST_KEY;
});

describe("pi-mcp-adapter interpolation contract", () => {
  it("interpolates ${VAR} and $env:VAR, but NOT bare $VAR", async () => {
    const { interpolateEnvVars } = await import(ADAPTER_UTILS);

    expect(interpolateEnvVars("${HV_MCP_TEST_KEY}")).toBe("secret-value");
    expect(interpolateEnvVars("$env:HV_MCP_TEST_KEY")).toBe("secret-value");
    expect(interpolateEnvVars("Bearer ${HV_MCP_TEST_KEY}")).toBe("Bearer secret-value");

    // The trap: bare $VAR is Pi's models.json syntax, NOT the adapter's.
    // If this ever starts interpolating, our placeholder choice needs revisiting.
    expect(interpolateEnvVars("$HV_MCP_TEST_KEY")).toBe("$HV_MCP_TEST_KEY");
  });

  it("resolves a MISSING variable to the empty string, silently", async () => {
    const { interpolateEnvVars } = await import(ADAPTER_UTILS);
    // No throw, no marker left behind — this is why the install path must
    // verify the secret reached the process rather than trusting interpolation.
    expect(interpolateEnvVars("${HV_MCP_DEFINITELY_UNSET}")).toBe("");
  });

  it("applies interpolation to every value of a record", async () => {
    const { interpolateEnvRecord } = await import(ADAPTER_UTILS);
    expect(
      interpolateEnvRecord({ Authorization: "Bearer ${HV_MCP_TEST_KEY}", Static: "plain" }),
    ).toEqual({ Authorization: "Bearer secret-value", Static: "plain" });
    expect(interpolateEnvRecord(undefined)).toBeUndefined();
  });

  it("server-manager applies it to env and headers but NOT to url", () => {
    // Source-level assertion: there is no exported seam that returns the
    // resolved URL, so we pin the call sites. Both env and headers route
    // through resolveCommandSecretsRecord -> resolveCommandSecret ->
    // interpolateEnvVars; definition.url is used raw.
    //
    // Adapter 2.11.0 -> 2.17.0 renamed this seam: it used to be
    // resolveEnv/resolveHeaders calling interpolateEnvRecord(...) directly.
    // The INVARIANT is unchanged (verified: the non-"!" branch of
    // resolveCommandSecret calls interpolateEnvVars), only the shape moved —
    // which is exactly what a source-shape pin is for.
    const src = readFileSync(
      new URL("../pi-runtime/node_modules/pi-mcp-adapter/server-manager.ts", import.meta.url),
      "utf8",
    );
    //
    // 2.32.1 -> 2.35.0 grew resolveEnv two more parameters and an inheritEnv block
    // (2.33's `inheritEnv: false`), pushing the call past the old 400-char window.
    // The invariant is unchanged; only the distance moved.
    expect(src).toMatch(/function resolveEnv[\s\S]{0,900}resolveCommandSecretsRecord\(\s*env/);
    expect(src).toMatch(/resolveCommandSecretsRecord\(\s*definition\.headers/);
    // 2.34 added a `literalEnv` early return that skips command resolution for
    // built-in Agent Plugin definitions. That NARROWS the execution surface, so it
    // is pinned: losing it would silently re-arm `!`-commands on that path.
    expect(src).toMatch(/if \(literalEnv\) return/);
    // If a pin bump adds URL interpolation this assertion fails and we may
    // relax the "no secret in a URL path" catalog rule.
    expect(src).not.toMatch(/interpolate\w*\(\s*definition\.url/);
    expect(src).not.toMatch(/resolveCommandSecret\w*\(\s*definition\.url/);
  });

  it.skipIf(process.platform === "win32")("a '!'-prefixed value is EXECUTED as a shell command — new in adapter 2.17.0", async () => {
    // Not our feature, but it is a code-execution path reachable from an
    // mcp.json this app reads (global <agentDir>/mcp.json AND workspace
    // .mcp.json, which can arrive inside a cloned repo). Pinned so a future
    // pin bump cannot widen or silently relocate it, and so the permission
    // model has something to point at. "!!" is the escape for a literal "!".
    const { resolveCommandSecret } = await import(ADAPTER_UTILS);

    expect(resolveCommandSecret("!printf hv-exec-probe", "test")).toBe("hv-exec-probe");
    // "!!" escapes: interpolated, NOT executed.
    expect(resolveCommandSecret("!!printf nope", "test")).toBe("!printf nope");
    // The ordinary path our catalog relies on stays pure interpolation.
    expect(resolveCommandSecret("${HV_MCP_TEST_KEY}", "test")).toBe("secret-value");
  });

  it("requestHeadersCommand is a SECOND execution surface, new in adapter 2.26.0", () => {
    // #353 added per-server `requestHeadersCommand`: it runs a command on every
    // outbound Streamable-HTTP/SSE request and uses the output as headers. Like
    // the `!` prefix above, per-server config is readable from a WORKSPACE
    // .mcp.json — which can arrive inside a cloned repo — so this is a code
    // execution path this app can be pointed at. Named here so a pin bump that
    // widens or relocates it fails loudly instead of being discovered later.
    const src = readFileSync(
      new URL("../pi-runtime/node_modules/pi-mcp-adapter/request-headers-command.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/from "node:child_process"/);
    expect(src).toMatch(/\bspawn\(/);
  });

  it("HappyVibe never writes requestHeadersCommand on a user's behalf", () => {
    // The curated catalog and the plugin importer are the only two places that
    // author mcp.json entries for the user. Neither may hand the adapter a
    // command to run: our own secrets go through `${VAR}` interpolation, pinned
    // by the cases above.
    for (const file of ["src/main/plugins/mcpImport.ts", "src/main/plugins/catalog.generated.ts", "src/main/mcpCatalog.ts"]) {
      const ours = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(ours, `${file} must not author a requestHeadersCommand`).not.toContain("requestHeadersCommand");
    }
  });
});
