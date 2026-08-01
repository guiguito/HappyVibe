# Curated one-click MCP catalog — Implementation Plan

> **SUPERSEDED IN PART — read this first (2026-08-01).** This is the plan as written
> before implementation. Reality diverged on three points, and the code is the source of
> truth now:
> - **13 entries, not 15.** Figma and Slack were dropped — both allowlist pre-registered
>   OAuth clients and reject the Dynamic Client Registration our flow depends on (Figma
>   verified with a live 403). GitHub hit the same wall and was kept by switching to a
>   personal access token.
> - **Two behaviours were added that this plan does not mention**: `mcpResolve.ts`
>   (main resolves `${HV_MCP_…}` before probing, or key-based servers report a false
>   "needs auth") and `hv:mcp-connect-flow` (install chains into connect → auth-if-needed
>   → tools).
> - **Scope is no longer chosen per install.** The MCP page is global-only; workspace-tier
>   MCP moved to `WorkspaceSettingsModal`.
>
> See `docs/prd.md` §13 and the Notion "Curated MCP List" build spec for the current state.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bundled, browsable catalog of ~15 recognised MCP servers to the MCP page, each installable in one click through a confirm dialog that presents the server before anything is written.

**Architecture:** The install mechanism already exists end to end (`mcpSetServer` → `writeMcpServer` → `scheduleMcpReload`, with `McpConnectResult` reporting discovered tools). This plan adds four things around it: a static catalog data module shared by main and renderer, safeStorage-backed secrets so an API key never lands in a config file, a no-overwrite guard on the install path, and the browse/confirm UI. No bridge changes, no `spawn.ts` changes, no Pi pin bump.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), Tailwind v4, vitest, `simple-icons-font`, vendored `pi-mcp-adapter@2.11.0`.

## Global Constraints

- **Prerequisite:** this worktree has **no `node_modules` in either tree**. Run `npm install && (cd pi-runtime && npm ci)` before anything. Skipping the second install produces unrelated-looking failures (see `.claude/commands/devdoctor.md`).
- **Placeholder syntax is `${VAR}` or `$env:VAR` — never bare `$VAR`.** Verified in `pi-runtime/node_modules/pi-mcp-adapter/utils.ts:interpolateEnvVars`. `$HV_CUSTOM_<id>_KEY` in `modelsJson.ts` is Pi's *models.json* interpolator, a different one; copying that spelling here fails silently.
- **Interpolation applies to stdio `env` and remote `headers` only** — never to `url`, `command`, or `args` (`server-manager.ts:150,286` vs `:283,:305`). No catalog entry may put a secret in a URL path.
- **An unresolved variable becomes the empty string with no error.** Never assume interpolation succeeded.
- Every fs writer stays path-confined; `mcp.ts` is electron-free and vitest-importable — keep it that way.
- Pure modules shared between main and renderer are imported by relative path and added to the other project's tsconfig `include` (precedent: `toolLabel.ts:14` imports `pi-runtime/extensions/hv-mcp`).
- Do not edit a test to make it pass.
- Full gate = `npm run typecheck` (node + web) · non-live suite · `npm run build`. The non-live suite command is in `CLAUDE.md` §Tests — use it verbatim.
- **Live-Pi tests are NOT required by this plan** — nothing here touches `pi-runtime/extensions/` or `src/main/pi/`. If a task drifts into either, the 14 live files come back into the gate.

---

### Task 1: Adapter interpolation contract test

Decision 3 (encrypted secrets + placeholder in the config file) is only safe if the adapter interpolates the way we read it to. This test pins that behaviour and becomes part of the `pi-mcp-adapter` pin-bump gate, exactly as `tests/mcp-adapter-authformat.test.ts` pins the auth format. It ships first so the rest of the plan rests on a verified fact.

**Files:**
- Test: `tests/mcp-adapter-interpolation.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks — it is a guard. Later tasks rely on the *behaviour* it pins.

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * CONTRACT test (adapter-pin-bump gate).
 * The catalog stores API keys safeStorage-encrypted and writes only a
 * `${HV_MCP_<NAME>_KEY}` placeholder into mcp.json. That is only safe while the
 * adapter interpolates `${VAR}` in stdio env and remote headers. If a pin bump
 * changes the syntax, the scope, or the missing-variable behaviour, this breaks
 * — that is the gate.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ADAPTER_UTILS = "../pi-runtime/node_modules/pi-mcp-adapter/utils.ts";

let prior: string | undefined;
beforeEach(() => { prior = process.env.HV_MCP_TEST_KEY; process.env.HV_MCP_TEST_KEY = "secret-value"; });
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
    expect(interpolateEnvRecord({ Authorization: "Bearer ${HV_MCP_TEST_KEY}", Static: "plain" }))
      .toEqual({ Authorization: "Bearer secret-value", Static: "plain" });
    expect(interpolateEnvRecord(undefined)).toBeUndefined();
  });

  it("server-manager applies it to env and headers but NOT to url", async () => {
    // Source-level assertion: there is no exported seam that returns the
    // resolved URL, so we pin the call sites. resolveEnv/resolveHeaders both
    // route through interpolateEnvRecord; definition.url is used raw.
    const { readFileSync } = await import("node:fs");
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
```

- [ ] **Step 2: Run it and verify it passes against the current pin**

Run: `npx vitest run tests/mcp-adapter-interpolation.test.ts`
Expected: **4 passing.** This test documents existing behaviour, so it is green on first run — that is correct for a contract test. If any assertion fails, **stop**: the pinned adapter does not behave as this plan assumes and decision 3 needs revisiting before continuing.

- [ ] **Step 3: Record the gate in the docs**

Add to `docs/validation/m1.md`, at the end of the file:

```markdown
## Adapter interpolation contract (2026-07-31)

`pi-mcp-adapter@2.11.0` `utils.ts:interpolateEnvVars` supports `${VAR}` and
`$env:VAR`; bare `$VAR` is NOT interpolated. `server-manager.ts` applies it to
stdio `env` (`resolveEnv`, :150) and remote `headers` (`resolveHeaders`, :286),
and uses `definition.url` raw (:283, :305) — so a secret can never live in a URL
path. A missing variable resolves to `""` with no error.

The curated catalog (§13, round 8) depends on all four facts.
`tests/mcp-adapter-interpolation.test.ts` gates any pin bump.
```

- [ ] **Step 4: Commit**

```bash
git add tests/mcp-adapter-interpolation.test.ts docs/validation/m1.md
git commit -m "test(mcp): pin the adapter interpolation contract"
```

---

### Task 2: Catalog data module

The catalog is a static, electron-free module imported by **both** main (which owns the install) and the renderer (which renders the cards). It lives under `src/main/` next to the other electron-free MCP modules and is added to the web tsconfig, matching how `hv-mcp.ts` is shared today.

**Files:**
- Create: `src/main/mcpCatalog.ts`
- Modify: `tsconfig.web.json:3-9` (add the file to `include`)
- Test: `tests/mcp-catalog.test.ts` (create)

**Interfaces:**
- Consumes: `isValidServerName` from `src/main/mcp.ts:27`.
- Produces:
  - `type McpCatalogCategory = "Code" | "Design" | "Data" | "Browser" | "Productivity" | "Automation"`
  - `interface McpCatalogInput { id: string; label: string; hint: string; secret: boolean }`
  - `interface McpCatalogEntry { key: string; name: string; category: McpCatalogCategory; brand?: string; tagline: string; blurb: string; docsUrl: string; transport: "remote" | "stdio"; auth: "oauth" | "key" | "none"; inputs: McpCatalogInput[]; build(values: Record<string, string>, secretRef: (inputId: string) => string): McpServerConfig }`
  - `const MCP_CATALOG: McpCatalogEntry[]`
  - `function catalogEntry(key: string): McpCatalogEntry | undefined`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { MCP_CATALOG, catalogEntry, type McpCatalogEntry } from "../src/main/mcpCatalog";
import { isValidServerName } from "../src/main/mcp";

const CATEGORIES = ["Code", "Design", "Data", "Browser", "Productivity", "Automation"];

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
    const ref = (id: string) => `\${HV_MCP_TEST_${id.toUpperCase()}}`;
    for (const e of MCP_CATALOG) {
      const values = Object.fromEntries(e.inputs.map((i) => [i.id, "sample"]));
      const cfg = e.build(values, ref);
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
    const ref = (id: string) => `\${HV_MCP_TEST_${id.toUpperCase()}}`;
    for (const e of MCP_CATALOG) {
      const values = Object.fromEntries(e.inputs.map((i) => [i.id, "SUPER-SECRET"]));
      const json = JSON.stringify(e.build(values, ref));
      const hasSecretInput = e.inputs.some((i) => i.secret);
      if (hasSecretInput) expect(json, e.key).not.toContain("SUPER-SECRET");
    }
  });

  it("never puts a placeholder in url/command/args — the adapter only interpolates env and headers", () => {
    const ref = (id: string) => `\${HV_MCP_TEST_${id.toUpperCase()}}`;
    for (const e of MCP_CATALOG) {
      const values = Object.fromEntries(e.inputs.map((i) => [i.id, "sample"]));
      const cfg = e.build(values, ref) as Record<string, unknown>;
      const uninterpolated = JSON.stringify([cfg.url, cfg.command, cfg.args]);
      expect(uninterpolated, e.key).not.toContain("${");
      expect(uninterpolated, e.key).not.toContain("$env:");
    }
  });

  it("declares an input for every entry that needs one", () => {
    for (const e of MCP_CATALOG) {
      if (e.auth === "key") expect(e.inputs.some((i) => i.secret), e.key).toBe(true);
      if (e.auth === "oauth" || e.auth === "none") {
        // OAuth runs through the existing host-driven flow; no key field.
        expect(e.inputs.every((i) => !i.secret), e.key).toBe(true);
      }
    }
  });

  it("catalogEntry looks up by key", () => {
    expect(catalogEntry(MCP_CATALOG[0].key)).toBe(MCP_CATALOG[0]);
    expect(catalogEntry("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/mcp-catalog.test.ts`
Expected: FAIL — `Cannot find module '../src/main/mcpCatalog'`.

- [ ] **Step 3: Verify every entry against live vendor documentation**

**This step is an acceptance criterion, not a formality.** The source research's headline finding is that four archived servers still take 380,000 installs a week because everyone kept citing stale tutorials. Do not write an endpoint or package name from memory.

For each of the 15 rows below, open the `docsUrl` and record: the exact remote endpoint URL (or the exact `npx` invocation), whether auth is OAuth or an API key, the header name if it is a key, and whether the server is still maintained. If an entry turns out to be archived, unreachable, or to require a key inside the URL path (which the adapter cannot interpolate), **drop it and note why in the commit message** — shipping 13 verified entries beats shipping 15 with two dead ones.

| key | name | category | brand icon | expected transport | expected auth |
| --- | --- | --- | --- | --- | --- |
| `context7` | Context7 | Code | `si-context7`* | remote | none or key |
| `github` | GitHub | Code | `si-github` | remote | oauth |
| `atlassian` | Jira / Atlassian | Productivity | `si-atlassian` | remote | oauth |
| `slack` | Slack | Productivity | `si-slack` | remote | oauth |
| `notion` | Notion | Productivity | `si-notion` | remote | oauth |
| `linear` | Linear | Productivity | `si-linear` | remote | oauth |
| `figma` | Figma | Design | `si-figma` | verify — Dev Mode server may be desktop-local | key |
| `shadcn` | shadcn | Design | `si-shadcnui`* | stdio | none |
| `chrome_devtools` | Chrome DevTools | Browser | `si-googlechrome`* | stdio | none |
| `playwright` | Playwright | Browser | `si-playwright` | stdio | none |
| `n8n` | n8n | Automation | `si-n8n`* | remote (user instance) | key + URL |
| `firecrawl` | Firecrawl | Data | `si-firecrawl`* | remote | key (header only) |
| `composio` | Composio | Automation | `si-composio`* | remote | key or oauth |
| `supabase` | Supabase | Data | `si-supabase` | remote | key |
| `neon` | Neon | Data | `si-neon`* | remote | oauth or key |

`*` = not yet in `BRAND_ICONS`; Task 6 adds the ones that exist. Confirm each starred class exists in the installed `simple-icons-font` v16 with:

```bash
grep -o 'si-context7\|si-shadcnui\|si-googlechrome\|si-n8n\|si-firecrawl\|si-composio\|si-neon' \
  node_modules/simple-icons-font/font/simple-icons.css | sort -u
```

Any class that does not appear: leave `brand` undefined for that entry. The generic MCP glyph already handles it — a missing icon is never a blocker.

- [ ] **Step 4: Write the module**

Fill `MCP_CATALOG` with the verified data. The shape, and two worked entries showing the remote-with-key and stdio cases:

```typescript
/**
 * §13 round 8: the curated one-click catalog. Static and bundled — no network
 * fetch, matching the brand-icon font and §14's curated shortlist. Electron-free
 * so both main (which installs) and the renderer (which browses) can import it;
 * listed in tsconfig.web.json for the renderer side.
 *
 * Entries are verified against live vendor docs at authoring time. A stale entry
 * is a release-note fix, which is the accepted cost of not shipping a marketplace.
 */
import type { McpServerConfig } from "./mcp";

export type McpCatalogCategory =
  | "Code" | "Design" | "Data" | "Browser" | "Productivity" | "Automation";

export interface McpCatalogInput {
  id: string;
  label: string;
  /** Shown under the field — where to get the value. */
  hint: string;
  /** true → safeStorage-encrypted, referenced by placeholder. Never written to disk in the clear. */
  secret: boolean;
}

export interface McpCatalogEntry {
  /** The mcpServers key. Must satisfy isValidServerName. */
  key: string;
  name: string;
  category: McpCatalogCategory;
  /** simple-icons class; undefined falls back to the generic MCP glyph. */
  brand?: string;
  /** One line, on the card. */
  tagline: string;
  /** Two to three sentences, in the confirm dialog. Required — decision 4 is
      only meaningful if there is something worth reading. */
  blurb: string;
  docsUrl: string;
  transport: "remote" | "stdio";
  auth: "oauth" | "key" | "none";
  inputs: McpCatalogInput[];
  /**
   * Build the mcpServers config. `secretRef(inputId)` returns the `${VAR}`
   * placeholder for a secret input — the caller never passes the real value
   * into the file. Non-secret values (an instance URL) are inlined literally.
   *
   * A placeholder may only appear in `env` or `headers`: the adapter does not
   * interpolate url/command/args (tests/mcp-adapter-interpolation.test.ts).
   */
  build(values: Record<string, string>, secretRef: (inputId: string) => string): McpServerConfig;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    key: "firecrawl",
    name: "Firecrawl",
    category: "Data",
    brand: undefined, // set in Task 6 if si-firecrawl exists
    tagline: "Scrape JavaScript-heavy pages the agent otherwise can't read",
    blurb:
      "Firecrawl fetches and cleans modern web pages, including ones that only render through JavaScript, and hands the agent readable text instead of raw markup. Useful when you want the agent to research a site rather than guess at it. Needs a free API key from the Firecrawl dashboard.",
    docsUrl: "https://firecrawl.dev",
    transport: "remote",
    auth: "key",
    inputs: [
      { id: "apiKey", label: "API key", hint: "From your Firecrawl dashboard → API Keys", secret: true },
    ],
    // VERIFY the endpoint and header name against live docs before shipping.
    // The key MUST ride a header: a key in the URL path cannot be a placeholder.
    build: (_values, secretRef) => ({
      url: "https://<verified-endpoint>/mcp",
      headers: { Authorization: `Bearer ${secretRef("apiKey")}` },
    }),
  },
  {
    key: "playwright",
    name: "Playwright",
    category: "Browser",
    brand: "si-playwright",
    tagline: "Drive a real browser — run and repair end-to-end tests",
    blurb:
      "Playwright gives the agent a real browser it can navigate, click through and read, using the page's accessibility tree rather than screenshots. It is the usual choice for writing or repairing end-to-end tests. Runs on your machine, so it needs Node installed.",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    transport: "stdio",
    auth: "none",
    inputs: [],
    build: () => ({ command: "npx", args: ["-y", "@playwright/mcp@latest"] }),
  },
  // … the remaining verified entries, same shape.
];

export function catalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.key === key);
}
```

- [ ] **Step 5: Add the module to the web tsconfig**

In `tsconfig.web.json`, extend `include` (it already lists `pi-runtime/extensions/hv-mcp.ts` for the same reason):

```json
  "include": [
    "src/renderer/src/env.d.ts",
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/preload/*.d.ts",
    "pi-runtime/extensions/hv-mcp.ts",
    "src/main/mcpCatalog.ts"
  ],
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/mcp-catalog.test.ts && npm run typecheck`
Expected: all catalog tests PASS, both typechecks clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/mcpCatalog.ts tests/mcp-catalog.test.ts tsconfig.web.json
git commit -m "feat(mcp): curated catalog data module"
```

---

### Task 3: MCP secret storage

An entry needing an API key stores it safeStorage-encrypted in app config and writes only a placeholder into `mcp.json`. The env-var naming is a pure function in its own module so it is testable without Electron — the same split `mcpStatusKey.ts` already uses.

**Files:**
- Create: `src/main/mcpSecretName.ts`
- Modify: `src/main/config.ts:29-36` (config field), `:95-123` (accessors), `:132-137` (`providerEnv`)
- Test: `tests/mcp-secret-name.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mcpSecretEnvVar(serverKey: string, inputId: string): string` — e.g. `("firecrawl","apiKey")` → `"HV_MCP_FIRECRAWL_APIKEY"`
  - `mcpSecretPlaceholder(serverKey: string, inputId: string): string` — `"${HV_MCP_FIRECRAWL_APIKEY}"`
  - From `config.ts`: `setMcpSecret(serverKey, inputId, value)`, `removeMcpSecrets(serverKey)`, `mcpSecretStatus(): Record<string, boolean>`, and `providerEnv()` extended to include MCP secrets.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/mcp-secret-name.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure module**

```typescript
/**
 * Env-var naming for catalog MCP secrets. Electron-free (mirrors
 * mcpStatusKey.ts) so it is unit-testable without mocking safeStorage.
 *
 * The `${...}` wrapper is load-bearing: pi-mcp-adapter interpolates `${VAR}`
 * and `$env:VAR` but NOT bare `$VAR`, which is Pi's separate models.json
 * syntax. Pinned by tests/mcp-adapter-interpolation.test.ts.
 */
const sanitize = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function mcpSecretEnvVar(serverKey: string, inputId: string): string {
  return `HV_MCP_${sanitize(serverKey)}_${sanitize(inputId)}`;
}

export function mcpSecretPlaceholder(serverKey: string, inputId: string): string {
  return `\${${mcpSecretEnvVar(serverKey, inputId)}}`;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/mcp-secret-name.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Add storage to config.ts**

Add the field to `ConfigFile` (after `longCache?: boolean;`):

```typescript
  /** §13 round 8: safeStorage-encrypted secrets for catalog-installed MCP
      servers, base64, keyed "<serverKey>:<inputId>". mcp.json holds only a
      ${HV_MCP_…} placeholder — the workspace tier writes .mcp.json at the repo
      root, so a plaintext key there would land in git history. */
  mcpSecrets?: Record<string, string>;
```

Add the accessors next to the custom-endpoint ones:

```typescript
export function setMcpSecret(serverKey: string, inputId: string, value: string): void {
  const cfg = load();
  cfg.mcpSecrets = {
    ...cfg.mcpSecrets,
    [`${serverKey}:${inputId}`]: safeStorage.encryptString(value).toString("base64"),
  };
  save(cfg);
}

/** Drop every secret belonging to a server (called when it is removed). */
export function removeMcpSecrets(serverKey: string): void {
  const cfg = load();
  if (!cfg.mcpSecrets) return;
  for (const k of Object.keys(cfg.mcpSecrets)) {
    if (k.startsWith(`${serverKey}:`)) delete cfg.mcpSecrets[k];
  }
  save(cfg);
}

/** Env vars for the Pi spawn: decrypted MCP secrets under their HV_MCP_ names. */
function mcpSecretEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const secrets = load().mcpSecrets ?? {};
  for (const [composite, enc] of Object.entries(secrets)) {
    const [serverKey, inputId] = composite.split(":");
    const value = decrypt(enc);
    if (value) out[mcpSecretEnvVar(serverKey, inputId)] = value;
  }
  return out;
}

/** True per "<serverKey>:<inputId>" once stored — the UI shows "key saved". */
export function mcpSecretStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(load().mcpSecrets ?? {})) out[k] = true;
  return out;
}
```

Import the helper at the top of `config.ts`:

```typescript
import { mcpSecretEnvVar } from "./mcpSecretName";
```

And extend `providerEnv()` — this is the whole spawn integration, no `spawn.ts` change:

```typescript
/** Env vars injected on Pi spawn: curated BYOK keys + custom endpoint keys + MCP secrets. */
export function providerEnv(): Record<string, string> {
  return {
    ...buildProviderEnv(storedKeys()),
    ...customEndpointEnv(listCustomEndpoints(), storedCustomKeys()),
    ...mcpSecretEnv(),
  };
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/mcpSecretName.ts src/main/config.ts tests/mcp-secret-name.test.ts
git commit -m "feat(mcp): safeStorage-backed secrets for catalog servers"
```

---

### Task 4: No-overwrite guard on install

`writeMcpServer` is a blind upsert. The manual editor needs that (Edit legitimately overwrites), the catalog must never have it. Add an opt-in guard rather than changing the default, so the existing editor path is untouched.

**Files:**
- Modify: `src/main/mcp.ts:55-64`
- Test: `tests/mcp-config.test.ts` (existing — append)

**Interfaces:**
- Consumes: nothing.
- Produces: `writeMcpServer(file, name, cfg, opts?: { failIfExists?: boolean })` — throws `Error("A server named \"<name>\" already exists")` when `failIfExists` is set and the name is taken. Existing two-and-three-argument call sites are unaffected.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-config.test.ts`:

```typescript
describe("writeMcpServer failIfExists", () => {
  it("refuses to overwrite an existing server and leaves it untouched", () => {
    const f = join(tmp, "mcp.json");
    writeMcpServer(f, "github", { url: "https://mine.example/mcp" });

    expect(() =>
      writeMcpServer(f, "github", { url: "https://catalog.example/mcp" }, { failIfExists: true }),
    ).toThrow(/already exists/);

    // The user's hand-rolled config survives verbatim — that is the point.
    expect(readMcpFile(f).mcpServers.github).toEqual({ url: "https://mine.example/mcp" });
  });

  it("writes normally when the name is free", () => {
    const f = join(tmp, "mcp.json");
    writeMcpServer(f, "notion", { url: "https://notion.example/mcp" }, { failIfExists: true });
    expect(readMcpFile(f).mcpServers.notion).toEqual({ url: "https://notion.example/mcp" });
  });

  it("still overwrites by default — the editor's Edit flow depends on it", () => {
    const f = join(tmp, "mcp.json");
    writeMcpServer(f, "notion", { url: "https://one.example/mcp" });
    writeMcpServer(f, "notion", { url: "https://two.example/mcp" });
    expect(readMcpFile(f).mcpServers.notion).toEqual({ url: "https://two.example/mcp" });
  });
});
```

If `tmp`, `writeMcpServer` or `readMcpFile` are not already in scope in that file, match the imports and `beforeEach` the existing tests use rather than inventing new ones.

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/mcp-config.test.ts`
Expected: FAIL — the first test's `toThrow` fails because the write succeeds.

- [ ] **Step 3: Implement the guard**

Replace `writeMcpServer` in `src/main/mcp.ts`:

```typescript
/**
 * Upsert (or remove, when cfg is null) one server. Returns the new file content.
 *
 * `failIfExists` is for the curated catalog (§13 round 8): a one-click install
 * must never silently replace a server the user configured by hand. The manual
 * editor deliberately does NOT pass it — Edit overwrites by design.
 */
export function writeMcpServer(
  file: string,
  name: string,
  cfg: McpServerConfig | null,
  opts?: { failIfExists?: boolean },
): McpFile {
  if (!isValidServerName(name)) throw new Error(`invalid MCP server name: ${JSON.stringify(name)}`);
  const cur = readMcpFile(file);
  if (cfg && opts?.failIfExists && name in cur.mcpServers) {
    throw new Error(`A server named "${name}" already exists`);
  }
  if (cfg) cur.mcpServers[name] = cfg;
  else delete cur.mcpServers[name];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n");
  return cur;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/mcp-config.test.ts`
Expected: all PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp.ts tests/mcp-config.test.ts
git commit -m "feat(mcp): opt-in no-overwrite guard on server write"
```

---

### Task 5: Node/npx preflight

Three catalog entries are `npx` stdio and need a Node runtime the packaged app does not provide. Detect it once so those cards can say "needs Node" *before* the click.

**Files:**
- Create: `src/main/nodePreflight.ts`
- Modify: `src/main/ipc.ts` (add one handler near the other MCP handlers, after `hv:mcp-status` at `:1682`), `src/preload/index.ts:220` (expose it)
- Test: `tests/node-preflight.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `hasNodeRuntime(): boolean` (memoised) and `resetNodeRuntimeCache(): void` (tests only). IPC `hv:node-available` → `boolean`. Preload `window.hv.nodeAvailable(): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { hasNodeRuntime, resetNodeRuntimeCache } from "../src/main/nodePreflight";

beforeEach(() => resetNodeRuntimeCache());

describe("node preflight", () => {
  it("returns a boolean", () => {
    expect(typeof hasNodeRuntime()).toBe("boolean");
  });

  it("finds node when PATH contains it (this test runs under node)", () => {
    expect(hasNodeRuntime()).toBe(true);
  });

  it("reports false when PATH is empty", () => {
    const prior = process.env.PATH;
    try {
      process.env.PATH = "";
      resetNodeRuntimeCache();
      expect(hasNodeRuntime()).toBe(false);
    } finally {
      process.env.PATH = prior;
      resetNodeRuntimeCache();
    }
  });

  it("memoises — a second call does not re-probe", () => {
    const first = hasNodeRuntime();
    const prior = process.env.PATH;
    try {
      process.env.PATH = ""; // would flip the answer if it re-probed
      expect(hasNodeRuntime()).toBe(first);
    } finally {
      process.env.PATH = prior;
    }
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/node-preflight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
/**
 * §13 round 8: is there a Node runtime on PATH for `npx` stdio catalog entries?
 *
 * §3's standalone promise means the packaged app ships everything IT needs, but
 * a user-configured stdio server running `npx` needs the user's own Node. The
 * catalog discloses that before the click rather than letting the install fail
 * into an opaque red badge afterwards.
 *
 * Electron-free so it is unit-testable. ponytail: PATH scan, no spawn — a probe
 * process per app start is not worth it; switch to `spawnSync` if a user ever
 * reports a shimmed node that this misses.
 */
import fs from "node:fs";
import path from "node:path";

let cached: boolean | undefined;

function onPath(bin: string): boolean {
  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

export function hasNodeRuntime(): boolean {
  if (cached === undefined) cached = onPath("node") && onPath("npx");
  return cached;
}

/** Tests only — the real app probes once per launch. */
export function resetNodeRuntimeCache(): void {
  cached = undefined;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/node-preflight.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Expose over IPC**

In `src/main/ipc.ts`, import it with the other MCP imports (near `:49-54`) and add the handler immediately after the `hv:mcp-status` handler:

```typescript
  ipcMain.handle("hv:node-available", () => hasNodeRuntime());
```

In `src/preload/index.ts`, after `mcpStatus` at `:220`:

```typescript
  nodeAvailable: () => ipcRenderer.invoke("hv:node-available") as Promise<boolean>,
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/main/nodePreflight.ts src/main/ipc.ts src/preload/index.ts tests/node-preflight.test.ts
git commit -m "feat(mcp): node/npx preflight for stdio catalog entries"
```

---

### Task 6: Install IPC

Main owns the catalog and the secrets, mirroring the custom-endpoint handler's rule that "the renderer sends a DRAFT; main owns providerKey and auth so a renderer bug cannot produce a hijacking key". The renderer sends a catalog key plus input values — never a config object.

**Files:**
- Modify: `src/main/ipc.ts` (new handler after `hv:mcp-set-server`, which ends at `:1680`), `src/preload/index.ts` (expose)
- Test: `tests/mcp-catalog-install.test.ts` (create)

**Interfaces:**
- Consumes: `catalogEntry` (Task 2), `mcpSecretPlaceholder` (Task 3), `setMcpSecret`/`removeMcpSecrets` (Task 3), `writeMcpServer(…, { failIfExists: true })` (Task 4).
- Produces: `buildCatalogInstall(entry, values)` exported from `src/main/mcpCatalog.ts` returning `{ cfg, secrets }`; IPC `hv:mcp-install-catalog` → `{ ok: true } | { ok: false; error: string }`; preload `window.hv.mcpInstallCatalog(catalogKey, scope, workspaceId, values)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { MCP_CATALOG, buildCatalogInstall } from "../src/main/mcpCatalog";

const withSecret = () => MCP_CATALOG.find((e) => e.inputs.some((i) => i.secret))!;

describe("buildCatalogInstall", () => {
  it("returns the secrets separately from the config", () => {
    const e = withSecret();
    const secretInput = e.inputs.find((i) => i.secret)!;
    const values = Object.fromEntries(e.inputs.map((i) => [i.id, "VALUE-" + i.id]));

    const { cfg, secrets } = buildCatalogInstall(e, values);

    // The secret goes to the caller for encryption, NOT into the config.
    expect(secrets).toContainEqual({ inputId: secretInput.id, value: "VALUE-" + secretInput.id });
    expect(JSON.stringify(cfg)).not.toContain("VALUE-" + secretInput.id);
    // …and the config references it by placeholder instead.
    expect(JSON.stringify(cfg)).toContain(`\${HV_MCP_`);
  });

  it("rejects a missing required value rather than writing an empty placeholder", () => {
    // A missing var interpolates to "" silently, so the server would fail auth
    // with nothing to explain it. Catch it at the boundary instead.
    const e = withSecret();
    expect(() => buildCatalogInstall(e, {})).toThrow(/required/i);
  });

  it("passes non-secret values through literally", () => {
    const e = MCP_CATALOG.find((x) => x.inputs.some((i) => !i.secret));
    if (!e) return; // no such entry in the shipped catalog
    const plain = e.inputs.find((i) => !i.secret)!;
    const values = Object.fromEntries(e.inputs.map((i) => [i.id, i.id === plain.id ? "https://my.instance" : "s"]));
    const { cfg } = buildCatalogInstall(e, values);
    expect(JSON.stringify(cfg)).toContain("https://my.instance");
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run tests/mcp-catalog-install.test.ts`
Expected: FAIL — `buildCatalogInstall` is not exported.

- [ ] **Step 3: Add `buildCatalogInstall` to `src/main/mcpCatalog.ts`**

```typescript
import { mcpSecretPlaceholder } from "./mcpSecretName";

/**
 * Split a filled-in catalog form into (a) the config to write and (b) the
 * secrets to encrypt. Secrets are referenced from the config by `${…}`
 * placeholder and never appear in it.
 */
export function buildCatalogInstall(
  entry: McpCatalogEntry,
  values: Record<string, string>,
): { cfg: McpServerConfig; secrets: { inputId: string; value: string }[] } {
  for (const input of entry.inputs) {
    if (!values[input.id]?.trim()) throw new Error(`${input.label} is required`);
  }
  const cfg = entry.build(values, (id) => mcpSecretPlaceholder(entry.key, id));
  const secrets = entry.inputs
    .filter((i) => i.secret)
    .map((i) => ({ inputId: i.id, value: values[i.id] }));
  return { cfg, secrets };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run tests/mcp-catalog-install.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Add the IPC handler**

In `src/main/ipc.ts`, directly after the `hv:mcp-set-server` handler:

```typescript
  // §13 round 8: one-click catalog install. The renderer sends a catalog KEY and
  // form values — never a config object — so a renderer bug cannot write an
  // arbitrary server. Secrets are encrypted here and referenced from mcp.json by
  // ${HV_MCP_…} placeholder only.
  ipcMain.handle(
    "hv:mcp-install-catalog",
    (_e, catalogKey: string, scope: "global" | "workspace", workspaceId: string | null, values: Record<string, string>) => {
      const entry = catalogEntry(catalogKey);
      if (!entry) return { ok: false as const, error: "Unknown catalog entry" };

      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      try {
        const { cfg, secrets } = buildCatalogInstall(entry, values);
        // Encrypt first: if the write then fails on a collision we drop them again,
        // rather than leaving a config that points at a secret we never stored.
        for (const s of secrets) setMcpSecret(entry.key, s.inputId, s.value);
        try {
          writeMcpServer(file, entry.key, cfg, { failIfExists: true });
        } catch (err) {
          removeMcpSecrets(entry.key);
          throw err;
        }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }

      void log.append({
        type: "mcp.config",
        workspaceId: workspaceId ?? undefined,
        data: { scope, name: entry.key, removed: false, source: "catalog" },
      });
      scheduleMcpReload(scope, workspaceId);
      return { ok: true as const };
    },
  );
```

Add to the existing import block near `:49`:

```typescript
import { catalogEntry, buildCatalogInstall } from "./mcpCatalog";
import { setMcpSecret, removeMcpSecrets } from "./config";  // fold into the existing config import
import { hasNodeRuntime } from "./nodePreflight";           // if Task 5 did not already add it
```

- [ ] **Step 6: Clean up secrets on removal**

In the `hv:mcp-set-server` handler's `cfg === null` branch, next to the existing `deleteAuthEntry` call, add:

```typescript
        removeMcpSecrets(name);
```

- [ ] **Step 7: Expose over preload**

In `src/preload/index.ts`, after `mcpSetServer`:

```typescript
  mcpInstallCatalog: (
    catalogKey: string,
    scope: "global" | "workspace",
    workspaceId: string | null,
    values: Record<string, string>,
  ) => ipcRenderer.invoke("hv:mcp-install-catalog", catalogKey, scope, workspaceId, values) as
    Promise<{ ok: true } | { ok: false; error: string }>,
```

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add src/main/mcpCatalog.ts src/main/ipc.ts src/preload/index.ts tests/mcp-catalog-install.test.ts
git commit -m "feat(mcp): catalog install IPC with encrypted secrets"
```

---

### Task 7: Brand icons for the new entries

**Files:**
- Modify: `src/renderer/src/toolLabel.ts:44-87`
- Test: `tests/tool-label.test.ts` (existing — append; if no such file exists, create `tests/mcp-catalog-icons.test.ts` with the same body)

**Interfaces:**
- Consumes: `brandIconFor` (`toolLabel.ts:101`).
- Produces: nothing new — extends the existing `BRAND_ICONS` map.

- [ ] **Step 1: Confirm which classes exist**

```bash
grep -o 'si-context7\|si-shadcnui\|si-googlechrome\|si-n8n\|si-firecrawl\|si-composio\|si-neon' \
  node_modules/simple-icons-font/font/simple-icons.css | sort -u
```

Add **only** the classes this prints. A brand with no icon keeps the generic MCP glyph, which is already the documented fallback.

- [ ] **Step 2: Write the failing test**

Assert only on classes step 1 confirmed. Example, assuming `si-n8n` and `si-googlechrome` exist and `si-firecrawl` does not:

```typescript
import { describe, it, expect } from "vitest";
import { brandIconFor } from "../src/renderer/src/toolLabel";

describe("catalog brand icons", () => {
  it("resolves icons for catalog servers added in round 8", () => {
    expect(brandIconFor("n8n_list_nodes")).toBe("si-n8n");
    expect(brandIconFor("chrome_devtools_trace")).toBe("si-googlechrome");
  });

  it("falls back to the generic glyph for brands simple-icons does not ship", () => {
    expect(brandIconFor("firecrawl_scrape")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run tests/tool-label.test.ts`
Expected: FAIL — the new keys return `undefined`.

- [ ] **Step 4: Extend the map**

Add the confirmed entries to `BRAND_ICONS`, keeping the existing alphabetical-ish grouping:

```typescript
  n8n: "si-n8n",
  chromedevtools: "si-googlechrome",
  chrome: "si-googlechrome",
```

Note `brandIconFor` tokenises on non-alphanumerics and prefix-matches keys of length ≥ 5, so `chrome_devtools_trace` tokenises to `["chrome","devtools","trace"]` and hits the exact `chrome` key. Verify each addition against the test rather than assuming the tokeniser's behaviour.

Then set the matching `brand` field on those entries in `src/main/mcpCatalog.ts`.

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run tests/tool-label.test.ts && npx vitest run tests/mcp-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/toolLabel.ts src/main/mcpCatalog.ts tests/tool-label.test.ts
git commit -m "feat(mcp): brand icons for catalog entries"
```

---

### Task 8: Catalog UI — grid and confirm dialog

**Files:**
- Create: `src/renderer/src/components/McpCatalogSection.tsx`
- Modify: `src/renderer/src/components/McpView.tsx:12-14`
- Test: manual GUI pass (step 6) — this is presentational; the logic it drives is covered by Tasks 2–6.

**Interfaces:**
- Consumes: `MCP_CATALOG`, `type McpCatalogEntry` from `../../../main/mcpCatalog`; `window.hv.mcpInstallCatalog`, `window.hv.mcpGet`, `window.hv.nodeAvailable`.
- Produces: `<McpCatalogSection workspaceId={string | null} onInstalled={() => void} />`.

- [ ] **Step 1: Build the section**

Follow the visual language of `McpServersSection.tsx` exactly — `rounded-2xl bg-card border-2 border-line shadow-sticker-lg`, `bg-tangerine text-paper` primary buttons, `text-[10px] font-bold tracking-wider rounded-full` badges. Do not introduce new colors or a component library.

```tsx
import { useEffect, useState } from "react";
import { MCP_CATALOG, type McpCatalogEntry } from "../../../main/mcpCatalog";

/**
 * §13 round 8: the curated one-click catalog. Browsing is local (the list is
 * bundled); clicking opens a confirm dialog that presents the server and shows
 * exactly what will be written before anything is installed.
 */
export function McpCatalogSection({
  workspaceId,
  onInstalled,
}: {
  workspaceId: string | null;
  onInstalled: () => void;
}): React.JSX.Element {
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [hasNode, setHasNode] = useState(true);
  const [chosen, setChosen] = useState<McpCatalogEntry | null>(null);

  const refreshInstalled = async (): Promise<void> => {
    const r = await window.hv.mcpGet(workspaceId ?? undefined);
    setInstalledNames(new Set([
      ...Object.keys(r.global?.mcpServers ?? {}),
      ...Object.keys(r.workspace?.mcpServers ?? {}),
    ]));
  };

  useEffect(() => {
    void refreshInstalled().catch(() => { /* non-fatal — cards just show uninstalled */ });
    void window.hv.nodeAvailable().then(setHasNode).catch(() => setHasNode(true));
  }, [workspaceId]);

  return (
    <div>
      <p className="text-xs text-ink-soft mb-3">
        Recognised servers, ready to install. Every one still goes through your permission rules.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {MCP_CATALOG.map((e) => {
          const installed = installedNames.has(e.key);
          const blocked = e.transport === "stdio" && !hasNode;
          return (
            <button
              key={e.key}
              type="button"
              disabled={installed}
              onClick={() => setChosen(e)}
              className="text-left rounded-xl bg-card border-2 border-line px-3 py-2.5 hover:border-tangerine disabled:opacity-60 disabled:hover:border-line disabled:cursor-default cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {e.brand
                  ? <i className={`si ${e.brand} text-base shrink-0`} aria-hidden />
                  : <span className="size-4 rounded bg-paper-deep border border-line shrink-0" aria-hidden />}
                <span className="font-bold text-sm truncate">{e.name}</span>
                <span className="flex-1" />
                {installed && (
                  <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-leaf-soft text-leaf border border-leaf/50 shrink-0">
                    installed
                  </span>
                )}
                {!installed && blocked && (
                  <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-honey-soft text-tangerine-deep border border-honey/60 shrink-0">
                    needs Node
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-soft mt-1 line-clamp-2">{e.tagline}</p>
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">{e.category}</span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <McpCatalogConfirm
          entry={chosen}
          workspaceId={workspaceId}
          nodeMissing={chosen.transport === "stdio" && !hasNode}
          onClose={() => setChosen(null)}
          onInstalled={() => { setChosen(null); void refreshInstalled(); onInstalled(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the confirm dialog**

In the same file. It must show the blurb, the exact config that will be written, the scope toggle defaulting to global, the inputs, and the "needs Node" warning.

```tsx
function McpCatalogConfirm({
  entry, workspaceId, nodeMissing, onClose, onInstalled,
}: {
  entry: McpCatalogEntry;
  workspaceId: string | null;
  nodeMissing: boolean;
  onClose: () => void;
  onInstalled: () => void;
}): React.JSX.Element {
  const [scope, setScope] = useState<"global" | "workspace">("global");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = entry.transport === "remote"
    ? "a remote MCP server"
    : "a local command";

  const install = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.hv
      .mcpInstallCatalog(entry.key, scope, scope === "workspace" ? workspaceId : null, values)
      .catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setBusy(false);
    if (res.ok) onInstalled();
    else setError(res.error);
  };

  const inputCls = "rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-tangerine w-full";
  const labelCls = "text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1 mt-3 block";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          {entry.brand && <i className={`si ${entry.brand} text-xl shrink-0`} aria-hidden />}
          <h2 className="font-black text-xl leading-tight">Add {entry.name}?</h2>
        </div>
        <p className="text-sm text-ink-soft mb-3">{entry.blurb}</p>
        <a href={entry.docsUrl} target="_blank" rel="noreferrer"
           className="text-xs font-bold text-tangerine-deep underline">
          {entry.name} documentation ↗
        </a>

        <label className={labelCls}>What will be added</label>
        <p className="text-xs text-ink-soft mb-1">
          HappyVibe will add {preview} named <span className="font-mono font-bold">{entry.key}</span> to{" "}
          <span className="font-mono">{scope === "global" ? "your global MCP config" : ".mcp.json in this workspace"}</span>.
        </p>

        {nodeMissing && (
          <div className="mt-2 rounded-lg bg-honey-soft border border-honey/60 px-3 py-2 text-xs text-tangerine-deep">
            <span className="font-bold">Needs Node.</span> This server runs on your machine via{" "}
            <span className="font-mono">npx</span>, and HappyVibe could not find Node on your PATH.
            Install Node first, or it will fail to start.
          </div>
        )}

        <label className={labelCls}>Scope</label>
        <select value={scope} onChange={(e) => setScope(e.target.value as "global" | "workspace")}
                className={inputCls + " cursor-pointer"}>
          <option value="global">Global (all workspaces)</option>
          <option value="workspace" disabled={!workspaceId}>Workspace (.mcp.json shareable)</option>
        </select>

        {entry.inputs.map((input) => (
          <div key={input.id}>
            <label className={labelCls}>{input.label}</label>
            <input
              type={input.secret ? "password" : "text"}
              value={values[input.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
              className={inputCls}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-ink-soft mt-1">
              {input.hint}
              {input.secret && " — stored encrypted, never written to the config file."}
            </p>
          </div>
        ))}

        {error && <div className="mt-3 text-sm font-semibold text-berry">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border-2 border-line px-4 py-2 text-sm font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void install()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 disabled:opacity-60 cursor-pointer">
            {busy ? "Adding…" : `Add ${entry.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Place it on the MCP page**

Rewrite `src/renderer/src/components/McpView.tsx` — the catalog goes **above** the configured-servers list, since an empty install is the common first visit:

```tsx
import { useState } from "react";
import { Section } from "./Section";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";

/** MCP servers page (split out of the old combined Skills/MCP/Agents/Tools view). */
export function McpView({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  // Bumped after a catalog install so the configured-servers list refetches.
  const [installedTick, setInstalledTick] = useState(0);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">MCP</h1>
        <p className="text-sm text-ink-soft mb-8">External MCP servers.</p>

        <Section icon="mcp" title="Add a server" subtitle="Recognised Model Context Protocol servers, ready to install.">
          <McpCatalogSection workspaceId={workspaceId} onInstalled={() => setInstalledTick((n) => n + 1)} />
        </Section>

        <Section icon="mcp" title="Your servers" subtitle="Connected Model Context Protocol servers, and adding more.">
          <McpServersSection key={installedTick} workspaceId={workspaceId} embedded />
        </Section>
      </div>
    </div>
  );
}
```

The `key={installedTick}` remount is the smallest way to make the servers list pick up a catalog install; `McpServersSection` already refetches on mount.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean. A failure importing `../../../main/mcpCatalog` means Task 2 step 5 (the tsconfig `include`) was skipped.

- [ ] **Step 5: Run the full non-live gate**

Run the non-live suite command from `CLAUDE.md` §Tests verbatim.
Expected: all green. Paste the real output — never a summary.

- [ ] **Step 6: UI pass**

Follow `.claude/commands/uicheck.md` exactly. `attach {debugPort: 9222}` — **never `start_app`** (it has hung for 30 minutes in this repo). If the attach fails, print the launch line and stop:

```
HV_DEBUG_PORT=9222 npm run dev
```

Then screenshot the MCP page and confirm, with the picture:
1. The catalog grid renders, brand icons appear for the entries that have one, the rest show the neutral placeholder.
2. Clicking a card opens the dialog and **nothing is written** until Add is pressed.
3. The dialog shows the blurb, what will be added, and the scope toggle defaulting to Global.
4. Installing a server moves it into "Your servers" and its card flips to `installed`.
5. Clicking a card whose name already exists shows the collision error rather than overwriting.
6. `get_console_messages` with `level: error` is clean.

Remember `src/main` changes need a dev-server **restart**, not a renderer reload — and verify the built artifact (`grep mcp-install-catalog out/main/index.js`), not the source.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/McpCatalogSection.tsx src/renderer/src/components/McpView.tsx
git commit -m "feat(mcp): curated catalog UI with confirm-install dialog"
```

---

## Self-review notes

**Spec coverage.** Decision 1 (remote-first + needs-Node badge) → Tasks 2, 5, 8. Decision 2 (bundled static) → Task 2. Decision 3 (encrypted secrets) → Tasks 1, 3, 6. Decision 4 (confirm dialog + scope toggle) → Task 8. Decision 5 (never overwrite) → Tasks 4, 6. Decision 6 (source corrections) → Task 2 step 3. Decision 7 / adapter contract → Task 1.

**Known soft spots, called out rather than hidden:**
- Task 2 step 3 is a research step whose output this plan cannot pre-write. Every endpoint string is marked `<verified-endpoint>` and must be replaced; the integrity test does not catch a wrong-but-well-formed URL, only a malformed entry. A reviewer should spot-check three entries against vendor docs.
- Task 7's icon assertions depend on what `simple-icons` v16 actually ships, which cannot be checked until `npm install` runs. Step 1 is the check; write the test to match its output, not to match this plan's guess.
- The Task 8 test column is "manual GUI pass" by design — it is presentational glue over logic already covered by Tasks 2–6. If it grows conditional behaviour beyond what is written here, it needs unit tests too.
