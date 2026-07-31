import { describe, it, expect } from "vitest";
import { mcpSecretEnvVar, mcpSecretPlaceholder } from "../src/main/mcpSecretName";

describe("mcp secret env naming", () => {
  it("builds an upper-snake env var from server key and input id", () => {
    expect(mcpSecretEnvVar("firecrawl", "apiKey")).toBe("HV_MCP_FIRECRAWL_APIKEY");
    expect(mcpSecretEnvVar("chrome_devtools", "token")).toBe("HV_MCP_CHROME_DEVTOOLS_TOKEN");
  });

  it("strips characters that are not legal in an env var name", () => {
    expect(mcpSecretEnvVar("my-server", "api.key")).toBe("HV_MCP_MY_SERVER_API_KEY");
  });

  it("wraps the placeholder in ${} — the ONLY syntax the adapter interpolates", () => {
    // Bare $VAR is Pi's models.json syntax and is NOT interpolated by the
    // adapter — see tests/mcp-adapter-interpolation.test.ts.
    expect(mcpSecretPlaceholder("firecrawl", "apiKey")).toBe("${HV_MCP_FIRECRAWL_APIKEY}");
    expect(mcpSecretPlaceholder("firecrawl", "apiKey").startsWith("${")).toBe(true);
  });

  it("distinct servers never collide", () => {
    expect(mcpSecretEnvVar("a", "key")).not.toBe(mcpSecretEnvVar("b", "key"));
  });
});
