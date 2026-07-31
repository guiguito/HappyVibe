import { describe, it, expect } from "vitest";
import { MCP_CATALOG, catalogEntry, buildCatalogInstall } from "../src/main/mcpCatalog";
import { isValidServerName } from "../src/main/mcp";

const CATEGORIES = ["Code", "Design", "Data", "Browser", "Productivity", "Automation"];
const ref = (id: string) => `\${HV_MCP_TEST_${id.toUpperCase()}}`;
const fill = (e: (typeof MCP_CATALOG)[number], v = "sample") =>
  Object.fromEntries(e.inputs.map((i) => [i.id, v]));

describe("MCP catalog data", () => {
  it("has entries and unique keys", () => {
    expect(MCP_CATALOG.length).toBeGreaterThanOrEqual(14);
    const keys = MCP_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key is a writable mcpServers name", () => {
    // writeMcpServer throws on anything else — a bad key would make a card
    // that always fails at the last step.
    for (const e of MCP_CATALOG) expect(isValidServerName(e.key), e.key).toBe(true);
  });

  it("every entry carries the copy the confirm dialog needs", () => {
    for (const e of MCP_CATALOG) {
      expect(e.name.length, e.key).toBeGreaterThan(0);
      expect(e.tagline.length, e.key).toBeGreaterThan(0);
      expect(e.blurb.length, e.key).toBeGreaterThanOrEqual(40); // a real sentence, not a stub
      expect(CATEGORIES, e.key).toContain(e.category);
      expect(e.docsUrl, e.key).toMatch(/^https:\/\//);
    }
  });

  it("builds a config of the declared transport", () => {
    for (const e of MCP_CATALOG) {
      const cfg = e.build(fill(e), ref);
      if (e.transport === "remote") {
        expect(typeof cfg.url, e.key).toBe("string");
        expect(cfg.command, e.key).toBeUndefined();
      } else {
        expect(typeof cfg.command, e.key).toBe("string");
        expect(cfg.url, e.key).toBeUndefined();
      }
    }
  });

  it("never writes a secret value into the config — only a placeholder", () => {
    for (const e of MCP_CATALOG) {
      if (!e.inputs.some((i) => i.secret)) continue;
      // Only SECRET inputs get the sentinel; a non-secret value (n8n's instance
      // URL) is supposed to be inlined literally, so it must not trip this.
      const values = Object.fromEntries(
        e.inputs.map((i) => [i.id, i.secret ? "SUPER-SECRET" : "https://plain.example"]),
      );
      expect(JSON.stringify(e.build(values, ref)), e.key).not.toContain("SUPER-SECRET");
    }
  });

  it("never puts a placeholder in url/command/args — the adapter only interpolates env and headers", () => {
    for (const e of MCP_CATALOG) {
      const cfg = e.build(fill(e), ref) as Record<string, unknown>;
      const uninterpolated = JSON.stringify([cfg.url, cfg.command, cfg.args]);
      expect(uninterpolated, e.key).not.toContain("${");
      expect(uninterpolated, e.key).not.toContain("$env:");
    }
  });

  it("declares a secret input exactly when auth is by key", () => {
    for (const e of MCP_CATALOG) {
      if (e.auth === "key") expect(e.inputs.some((i) => i.secret), e.key).toBe(true);
      // OAuth runs through the existing host-driven flow; no key field.
      else expect(e.inputs.every((i) => !i.secret), e.key).toBe(true);
    }
  });

  it("every remote entry points at https", () => {
    for (const e of MCP_CATALOG) {
      if (e.transport !== "remote") continue;
      const url = e.build(fill(e, "https://my.instance"), ref).url as string;
      expect(url, e.key).toMatch(/^https:\/\//);
    }
  });

  it("does not ship Slack — confidential OAuth, no dynamic client registration", () => {
    // Slack's MCP server requires a pre-registered client_id/client_secret and
    // explicitly rejects DCR, which is the only flow mcpOAuth.ts implements.
    // A Slack tile would be a button that cannot succeed.
    expect(MCP_CATALOG.find((e) => e.key === "slack")).toBeUndefined();
  });

  it("catalogEntry looks up by key", () => {
    expect(catalogEntry(MCP_CATALOG[0].key)).toBe(MCP_CATALOG[0]);
    expect(catalogEntry("nope")).toBeUndefined();
  });
});

describe("buildCatalogInstall", () => {
  const withSecret = () => MCP_CATALOG.find((e) => e.inputs.some((i) => i.secret))!;

  it("returns the secrets separately from the config", () => {
    const e = withSecret();
    const secretInput = e.inputs.find((i) => i.secret)!;
    const values = Object.fromEntries(e.inputs.map((i) => [i.id, "VALUE-" + i.id]));

    const { cfg, secrets } = buildCatalogInstall(e, values);

    // The secret goes to the caller for encryption, NOT into the config.
    expect(secrets).toContainEqual({ inputId: secretInput.id, value: "VALUE-" + secretInput.id });
    expect(JSON.stringify(cfg)).not.toContain("VALUE-" + secretInput.id);
    // …and the config references it by placeholder instead.
    expect(JSON.stringify(cfg)).toContain("${HV_MCP_");
  });

  it("rejects a missing required value rather than writing an empty placeholder", () => {
    // A missing var interpolates to "" silently, so the server would fail auth
    // with nothing to explain it. Catch it at the boundary instead.
    expect(() => buildCatalogInstall(withSecret(), {})).toThrow(/required/i);
  });

  it("passes non-secret values through literally", () => {
    const e = MCP_CATALOG.find((x) => x.inputs.some((i) => !i.secret));
    if (!e) return; // no such entry in the shipped catalog
    const plain = e.inputs.find((i) => !i.secret)!;
    const values = Object.fromEntries(
      e.inputs.map((i) => [i.id, i.id === plain.id ? "https://my.instance" : "s"]),
    );
    expect(JSON.stringify(buildCatalogInstall(e, values).cfg)).toContain("https://my.instance");
  });
});
