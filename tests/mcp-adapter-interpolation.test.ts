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
    // resolved URL, so we pin the call sites. resolveEnv/resolveHeaders both
    // route through interpolateEnvRecord; definition.url is used raw.
    const src = readFileSync(
      new URL("../pi-runtime/node_modules/pi-mcp-adapter/server-manager.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/function resolveEnv[\s\S]{0,400}interpolateEnvRecord\(env\)/);
    expect(src).toMatch(/function resolveHeaders[\s\S]{0,200}interpolateEnvRecord\(headers\)/);
    // If a pin bump adds URL interpolation this assertion fails and we may
    // relax the "no secret in a URL path" catalog rule.
    expect(src).not.toMatch(/interpolate\w*\(\s*definition\.url/);
  });
});
