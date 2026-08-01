import { describe, it, expect } from "vitest";
import { MCP_CATALOG, catalogEntry, catalogCategories, buildCatalogInstall } from "../src/main/mcpCatalog";
import { isValidServerName } from "../src/main/mcp";

const CATEGORIES = ["Code", "Design", "Data", "Browser", "Productivity", "Automation"];
const ref = (id: string) => `\${HV_MCP_TEST_${id.toUpperCase()}}`;
const fill = (e: (typeof MCP_CATALOG)[number], v = "sample") =>
  Object.fromEntries(e.inputs.map((i) => [i.id, v]));

describe("MCP catalog data", () => {
  it("has entries and unique keys", () => {
    expect(MCP_CATALOG.length).toBeGreaterThanOrEqual(13);
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

  it("does not ship servers that reject dynamic client registration", () => {
    // mcpOAuth.ts implements DCR only. A server that allowlists pre-registered
    // clients gives a tile that cannot succeed, so it must not ship:
    //   slack  — documents confidential OAuth, DCR explicitly unsupported.
    //   figma  — advertises a registration_endpoint but returns a bare 403
    //            "Forbidden" to every well-formed DCR request (2026-08-01).
    // Revisit either only once HappyVibe registers a real client with them.
    expect(MCP_CATALOG.find((e) => e.key === "slack")).toBeUndefined();
    expect(MCP_CATALOG.find((e) => e.key === "figma")).toBeUndefined();
  });

  it("every oauth entry was audited and accepts dynamic client registration", () => {
    // Audited live 2026-08-01 by POSTing a well-formed DCR request to each
    // server's advertised registration_endpoint. These five returned 200/201
    // with a real client_id. Slack, Figma and GitHub did not and are either
    // dropped or shipped as key-based — see the header comment in mcpCatalog.ts.
    //
    // Adding an oauth entry that is not on this list means nobody checked that
    // our DCR-only flow can actually register with it. Audit it, then add it.
    const DCR_VERIFIED = new Set(["atlassian", "notion", "linear", "supabase", "neon"]);
    for (const e of MCP_CATALOG) {
      if (e.auth !== "oauth") continue;
      expect(DCR_VERIFIED.has(e.key), `${e.key}: oauth entry not in the DCR-audited set`).toBe(true);
    }
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

  it("allows an optional input to be blank and falls back to the default", () => {
    // Supabase's instance URL: blank means Supabase Cloud, so leaving it empty
    // must not block the install the way a missing API key does.
    const e = MCP_CATALOG.find((x) => x.inputs.some((i) => i.optional));
    if (!e) return;
    const required = Object.fromEntries(
      e.inputs.filter((i) => !i.optional).map((i) => [i.id, "v"]),
    );
    const { cfg } = buildCatalogInstall(e, required);
    expect(cfg.url).toMatch(/^https:\/\//);
    expect(JSON.stringify(cfg)).not.toContain("undefined");
  });

  it("still honours an optional input when it IS filled", () => {
    const e = MCP_CATALOG.find((x) => x.inputs.some((i) => i.optional));
    if (!e) return;
    const opt = e.inputs.find((i) => i.optional)!;
    const values = Object.fromEntries(
      e.inputs.map((i) => [i.id, i.id === opt.id ? "http://localhost:54321/mcp" : "v"]),
    );
    expect(buildCatalogInstall(e, values).cfg.url).toBe("http://localhost:54321/mcp");
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

describe("catalogCategories", () => {
  it("lists each present category once, in first-appearance order", () => {
    const cats = catalogCategories();
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toEqual(MCP_CATALOG.map((e) => e.category).filter((c, i, a) => a.indexOf(c) === i));
  });

  it("never offers a category with no entries behind it", () => {
    for (const c of catalogCategories()) {
      expect(MCP_CATALOG.some((e) => e.category === c), c).toBe(true);
    }
  });

  it("is empty for an empty catalog", () => {
    expect(catalogCategories([])).toEqual([]);
  });
});
