# Plugin marketplaces + MCP-by-import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse a Claude Code plugin marketplace inside HappyVibe, filter it to the components whose execution funnels through `tool_call` (skills, top-level commands, MCP servers), and install/remove a plugin as a unit — with every component landing in the trust machinery §14/§24/§13 already ship.

**Architecture:** Four new PURE modules under `src/main/plugins/` (marketplace parsing, component classification, path screening, plugin-dir scanning) plus one impure installer, all electron-free and vitest-importable. Nothing new is invented at the trust layer: skills go through `skillRegistry.approve`, commands through the prompt-template registry, MCP servers through `writeMcpServer`. The plugin↔component link is `plugin`/`marketplace` fields on existing provenance records and an `origin` key on the `mcp.json` entry — no new store.

**Tech Stack:** TypeScript, Node `fs`/`https`, existing `tar` dep, vitest, React 19 + Tailwind v4 renderer.

## Global Constraints

- PRD §25 is the spec. Every decision cited below is recorded there and in the Notion PRD.
- Accepted component surface is exactly `skills`, `commands`, `mcpServers`. Everything else rejects.
- Unknown *directories* are ignored (payload); only a **known** component outside the accepted three rejects.
- Manifest key allowlist: `name, version, description, author, homepage, repository, license, keywords, category`. Unknown key ⇒ reject, and the message names the key.
- Pin = `source.sha` (universal on object sources). `ref` is display-only.
- Plugin-installed skills are approved with `enabled: false`.
- Only **top-level** `commands/*.md` install; nested ones are counted and disclosed.
- `~/.claude/skills/` in a skill ⇒ hard reject. `${CLAUDE_PLUGIN_ROOT}` ⇒ substituted at install. `$SKILL_DIR` ⇒ soft warning.
- Every fs writer is path-confined (pattern: `files.ts` `resolveInWorkspace`, `skills/remove.ts`).
- Never run `npm run lint` / `npm run format` (CLAUDE.md — scaffold leftovers).
- Verification: `npm run gate` (= build → both typechecks → non-live suite). Never pipe a test run to `tail`/`grep`; redirect to a log then grep the log.

---

### Task 1: Marketplace parsing (PURE) + real fixtures

**Files:**
- Create: `src/main/plugins/marketplace.ts`
- Create: `tests/fixtures/marketplace-official.json` (trimmed real entries, one per source shape)
- Create: `tests/plugin-marketplace.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseMarketplace(raw: unknown): ParsedMarketplace`; types `MarketplaceEntry`, `PluginSourceRef`, `ParsedMarketplace`; `entryArchiveUrl(src: PluginSourceRef): string | null`.

```ts
export interface PluginSourceRef {
  /** null ⇒ the plugin lives inside the marketplace repo itself (bare "./path" entry). */
  repoUrl: string | null;
  /** source.sha — the commit we fetch. null only for marketplace-local entries. */
  sha: string | null;
  /** source.ref — branch or tag, DISPLAY ONLY (absent on 146 of 278 official entries). */
  ref?: string;
  /** Subdirectory holding the plugin, "" for repo root. */
  subdir: string;
}
export interface MarketplaceEntry {
  name: string; description: string;
  category?: string; homepage?: string;
  source: PluginSourceRef;
  /** Component keys declared on the ENTRY — the official marketplace puts lspServers/skills here. */
  entryComponents: string[];
}
export interface ParsedMarketplace {
  name: string; description?: string;
  entries: MarketplaceEntry[];
  skipped: Array<{ name: string; reason: string }>;
}
```

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseMarketplace, entryArchiveUrl } from "../src/main/plugins/marketplace";

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/marketplace-official.json"), "utf8"));

describe("parseMarketplace", () => {
  it("parses the four real source shapes", () => {
    const mp = parseMarketplace(raw);
    expect(mp.name).toBe("claude-plugins-official");
    const by = (n: string) => mp.entries.find((e) => e.name === n)!;

    // git-subdir: url + path + ref + sha
    expect(by("42crunch-api-security-testing").source).toMatchObject({
      repoUrl: "https://github.com/42Crunch-AI/claude-plugins.git",
      subdir: "plugins/api-security-testing",
      ref: "v1.5.5",
      sha: "30287f5e3f122a646d1ac5ca3ab96e130c52a3ad",
    });
    // bare "./path" — local to the marketplace repo, so no repoUrl and no sha of its own
    expect(by("agent-sdk-dev").source).toMatchObject({ repoUrl: null, sha: null, subdir: "plugins/agent-sdk-dev" });
    // url + sha, no path, no ref
    expect(by("agentforce-adlc").source).toMatchObject({ subdir: "", ref: undefined });
    expect(by("agentforce-adlc").source.sha).toHaveLength(40);
    // github + repo + commit — commit wins over sha as the pin
    expect(by("fullstory").source).toMatchObject({
      repoUrl: "https://github.com/fullstorydev/fullstory-skills.git",
      sha: "1ec5865e7ab1449f9a0859d164c4b6a8c53b6e2f",
    });
  });

  it("surfaces entry-level component declarations", () => {
    const mp = parseMarketplace(raw);
    expect(mp.entries.find((e) => e.name === "clangd-lsp")!.entryComponents).toContain("lspServers");
    expect(mp.entries.find((e) => e.name === "agent-sdk-dev")!.entryComponents).toEqual([]);
  });

  it("skips malformed entries instead of throwing", () => {
    const mp = parseMarketplace({ name: "x", plugins: [{ description: "no name" }, { name: "ok", source: "./p" }] });
    expect(mp.entries.map((e) => e.name)).toEqual(["ok"]);
    expect(mp.skipped).toHaveLength(1);
  });

  it("returns an empty marketplace for junk rather than throwing", () => {
    expect(parseMarketplace(null).entries).toEqual([]);
    expect(parseMarketplace({ plugins: "nope" }).entries).toEqual([]);
  });

  it("builds a codeload URL pinned to the sha", () => {
    const mp = parseMarketplace(raw);
    expect(entryArchiveUrl(mp.entries.find((e) => e.name === "42crunch-api-security-testing")!.source))
      .toBe("https://codeload.github.com/42Crunch-AI/claude-plugins/tar.gz/30287f5e3f122a646d1ac5ca3ab96e130c52a3ad");
    expect(entryArchiveUrl(mp.entries.find((e) => e.name === "agent-sdk-dev")!.source)).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-marketplace.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `src/main/plugins/marketplace`.

- [x] **Step 3: Write the fixture**

Trim the real file to the five entries the test names, keeping their `source` objects byte-identical:

```bash
cd /tmp && curl -sSL -o mp.json https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/mp.json'))
keep={"42crunch-api-security-testing","agent-sdk-dev","agentforce-adlc","fullstory","clangd-lsp"}
out={"name":d["name"],"description":d["description"],"owner":d.get("owner"),
     "plugins":[p for p in d["plugins"] if p["name"] in keep]}
json.dump(out,open('tests/fixtures/marketplace-official.json','w'),indent=2)
PY
```
(Run from the repo root so the output path lands in `tests/fixtures/`. Create the dir first if needed.)

- [x] **Step 4: Implement `marketplace.ts`**

```ts
import { KNOWN_COMPONENT_KEYS } from "./classify";

/**
 * §25 marketplace.json parsing — PURE, electron-free, vitest-importable.
 *
 * Calibrated against the real `anthropics/claude-plugins-official` (278 entries,
 * fetched 2026-08-04), NOT against the docs: the shapes actually present are
 * `url` (143), `git-subdir` (80), a bare "./path" string (53) and `github` (2).
 *
 * The PIN is `source.sha`. It is present on all 225 object sources and resolves
 * as a real git commit on codeload (verified against two entries in different
 * repos). `source.ref` is only a branch or tag, is absent on 146 entries, and is
 * therefore display-only. A bare "./path" entry lives inside the marketplace
 * repo, so it is pinned by whatever commit we fetched the marketplace at and
 * carries no sha of its own.
 *
 * Every failure is a SKIP, never a throw: two official entries are already dead
 * links, and one bad row must not cost the user the other 277.
 */
export interface PluginSourceRef { repoUrl: string | null; sha: string | null; ref?: string; subdir: string }
export interface MarketplaceEntry {
  name: string; description: string; category?: string; homepage?: string;
  source: PluginSourceRef; entryComponents: string[];
}
export interface ParsedMarketplace {
  name: string; description?: string;
  entries: MarketplaceEntry[]; skipped: Array<{ name: string; reason: string }>;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Normalize a repo reference to an https clone URL. Accepts "owner/name" or a full URL. */
function repoUrl(v: string): string {
  if (/^https?:\/\//.test(v)) return v;
  return `https://github.com/${v.replace(/^\/+|\/+$/g, "")}.git`;
}

function parseSource(raw: unknown): PluginSourceRef | string {
  // Bare "./plugins/foo" — relative to the marketplace repo.
  if (typeof raw === "string") {
    const p = raw.replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (!p || p.startsWith("..") || p.startsWith("/")) return "source path escapes the marketplace";
    return { repoUrl: null, sha: null, subdir: p };
  }
  if (!raw || typeof raw !== "object") return "missing source";
  const o = raw as Record<string, unknown>;
  const kind = str(o.source) ?? "";
  const url = str(o.url);
  const repo = str(o.repo);
  const base = url ?? (repo ? repoUrl(repo) : undefined);
  if (!base) return `source "${kind}" has neither url nor repo`;
  // `commit` (github shape) is an explicit pin; otherwise `sha`, which every
  // object source carries. Both are real commits.
  const sha = str(o.commit) ?? str(o.sha) ?? null;
  const sub = (str(o.path) ?? "").replace(/^\.\/+/, "").replace(/\/+$/, "");
  // `path: "."` means repo root.
  const subdir = sub === "." ? "" : sub;
  if (subdir.startsWith("..") || subdir.startsWith("/")) return "source path escapes the repo";
  return { repoUrl: repoUrl(base), sha, ref: str(o.ref), subdir };
}

export function parseMarketplace(raw: unknown): ParsedMarketplace {
  const out: ParsedMarketplace = { name: "", entries: [], skipped: [] };
  if (!raw || typeof raw !== "object") return out;
  const d = raw as Record<string, unknown>;
  out.name = str(d.name) ?? "";
  out.description = str(d.description);
  const plugins = Array.isArray(d.plugins) ? d.plugins : [];
  for (const p of plugins) {
    if (!p || typeof p !== "object") { out.skipped.push({ name: "?", reason: "not an object" }); continue; }
    const e = p as Record<string, unknown>;
    const name = str(e.name);
    if (!name) { out.skipped.push({ name: "?", reason: "missing name" }); continue; }
    const src = parseSource(e.source);
    if (typeof src === "string") { out.skipped.push({ name, reason: src }); continue; }
    out.entries.push({
      name,
      description: str(e.description) ?? "",
      category: str(e.category),
      homepage: str(e.homepage),
      source: src,
      // The official marketplace declares lspServers (12) and skills (4) on the
      // ENTRY, not only in the plugin manifest — a free pre-filter signal.
      entryComponents: KNOWN_COMPONENT_KEYS.filter((k) => k in e),
    });
  }
  return out;
}

/** codeload archive URL for an entry, or null when it lives in the marketplace repo. */
export function entryArchiveUrl(src: PluginSourceRef): string | null {
  if (!src.repoUrl) return null;
  const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(src.repoUrl);
  if (!m) return null;
  const [, host, owner, repo] = m;
  const ref = src.sha ?? src.ref ?? "HEAD";
  if (host === "github.com" || host === "www.github.com") {
    return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
  }
  return `https://${host}/${owner}/${repo}/archive/${ref}.tar.gz`;
}
```

- [x] **Step 5: Run the test — expect PASS**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-marketplace.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 6: Commit**

```bash
git add src/main/plugins/marketplace.ts tests/plugin-marketplace.test.ts tests/fixtures/marketplace-official.json
git commit -m "feat(plugins): parse marketplace.json, pinned to source.sha"
```

---

### Task 2: Component classifier (PURE)

**Files:**
- Create: `src/main/plugins/classify.ts`
- Create: `tests/plugin-classify.test.ts`

**Interfaces:**
- Consumes: nothing (Task 1 imports `KNOWN_COMPONENT_KEYS` from here — write this file's constants before wiring Task 1's import, or accept a red `marketplace.ts` until this lands).
- Produces: `KNOWN_COMPONENT_KEYS`, `ACCEPTED_COMPONENTS`, `ALLOWED_MANIFEST_KEYS`, `detectComponents(...)`, `classifyPlugin(...): Verdict`.

```ts
export interface Verdict {
  accepted: boolean;
  /** One line for the greyed card: "uses hooks, not supported in HappyVibe". */
  reason?: string;
  /** Every accepted component detected, sorted. */
  components: string[];
  /** Detected but not accepted — what the disclosure names. */
  rejected: string[];
}
```

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyPlugin, detectComponents } from "../src/main/plugins/classify";

const clean = { name: "42crunch", description: "d", version: "1", author: {}, homepage: "h", repository: "r", license: "l", keywords: [], category: "security" };

describe("classifyPlugin", () => {
  it("accepts the hand-validated clean plugin, category and all", () => {
    // Regression guard: `category` is real and was missing from the first
    // allowlist, which would have rejected the plugin used to prove the design.
    const v = classifyPlugin({ manifest: clean, topLevel: [".claude-plugin", "LICENSE", "README.md", "RECIPES.md", "references", "skills"] });
    expect(v.accepted).toBe(true);
    expect(v.components).toEqual(["skills"]);
  });

  it("rejects a tree-only .mcp.json case by TREE, not manifest — but mcpServers is accepted", () => {
    // airtable declares no mcpServers yet ships .mcp.json: a manifest-only
    // filter passes it. We must SEE it (and, under scenario C, accept it).
    const v = classifyPlugin({ manifest: { name: "airtable", description: "d", author: {} }, topLevel: [".mcp.json", "skills"] });
    expect(v.components).toEqual(["mcpServers", "skills"]);
    expect(v.accepted).toBe(true);
  });

  it("rejects hooks found only on disk", () => {
    const v = classifyPlugin({ manifest: { name: "x", description: "d", author: {} }, topLevel: ["skills", "hooks"] });
    expect(v.accepted).toBe(false);
    expect(v.rejected).toEqual(["hooks"]);
    expect(v.reason).toBe("uses hooks, not supported in HappyVibe");
  });

  it("rejects lspServers declared on the marketplace entry alone", () => {
    const v = classifyPlugin({ manifest: { name: "clangd-lsp", description: "d", author: {} }, topLevel: [], entryComponents: ["lspServers"] });
    expect(v.accepted).toBe(false);
    expect(v.rejected).toEqual(["lspServers"]);
  });

  it("IGNORES unknown directories — they are payload, not components", () => {
    // Real plugin roots ship these. Rejecting on them would kill working plugins.
    const v = classifyPlugin({
      manifest: clean,
      topLevel: ["skills", "hooks-handlers", "scripts", "core", "utils", "matchers", "examples", "assets", "references", "docs", ".gitignore", "SECURITY.md"],
    });
    expect(v.accepted).toBe(true);
    expect(v.components).toEqual(["skills"]);
  });

  it("rejects an unknown manifest key and names it", () => {
    const v = classifyPlugin({ manifest: { ...clean, monitors: {} }, topLevel: ["skills"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toContain("monitors");
  });

  it("names an unrecognised metadata key rather than failing silently", () => {
    const v = classifyPlugin({ manifest: { ...clean, wobble: 1 }, topLevel: ["skills"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toContain("wobble");
  });

  it("reports a plugin with nothing we can install", () => {
    const v = classifyPlugin({ manifest: { name: "x", description: "d", author: {} }, topLevel: ["README.md"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe("nothing HappyVibe can install");
  });

  it("detects a component from the manifest field as well as the dir", () => {
    expect(detectComponents({ name: "x", commands: ["./c.md"] }, [])).toEqual(["commands"]);
    expect(detectComponents({ name: "x" }, ["commands"])).toEqual(["commands"]);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-classify.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 3: Implement `classify.ts`**

```ts
/**
 * §25 plugin component classifier — PURE, electron-free, vitest-importable.
 *
 * ALLOWLIST, never denylist: Anthropic keeps adding executable component types
 * (monitors and channels are recent), so a denylist fails OPEN on the next
 * release while an allowlist merely fails closed on something new.
 *
 * Two halves, and both were calibrated against the real marketplace on
 * 2026-08-04 because the design-as-written got each one wrong:
 *
 *  1. Components are detected by KNOWN NAME over dirs, files AND manifest/entry
 *     fields. Unknown directories are IGNORED — real plugin roots ship
 *     hooks-handlers/, scripts/, core/, utils/, matchers/, examples/, assets/
 *     and references/ as ordinary payload, so "reject on unknown component
 *     dirs" would have rejected working plugins for shipping a source folder.
 *  2. The manifest key allowlist carries the benign metadata real plugins use.
 *     `category` is the proof: the survey validated 42crunch BY HAND as clean,
 *     yet its manifest has `category`, so the first allowlist would have
 *     rejected the one plugin used to prove the classifier worked.
 *
 * Unknown-key reject is KEPT rather than relaxed to "ignore unknown metadata",
 * because a manifest field is exactly where the next executable component type
 * will announce itself. The message names the key so a benign addition is a
 * one-line data change, not an unexplained missing plugin.
 *
 * Classifying from the manifest ALONE is unsound, not merely incomplete: every
 * executable component type has both a convention path and a manifest field.
 * Verified empirically — the `airtable` plugin declares no `mcpServers` yet
 * ships a `.mcp.json`.
 */

/** Component key ⇢ its convention directory name. */
export const COMPONENT_DIRS: Record<string, string> = {
  skills: "skills",
  commands: "commands",
  agents: "agents",
  hooks: "hooks",
  workflows: "workflows",
  monitors: "monitors",
  outputStyles: "output-styles",
  themes: "themes",
  channels: "channels",
};

/** Component key ⇢ its convention file name. */
export const COMPONENT_FILES: Record<string, string> = {
  mcpServers: ".mcp.json",
  lspServers: ".lsp.json",
};

/** Every component key we recognise, in either a manifest or a marketplace entry. */
export const KNOWN_COMPONENT_KEYS: string[] = [
  ...Object.keys(COMPONENT_DIRS),
  ...Object.keys(COMPONENT_FILES),
];

/** Scenario C. Everything else rejects. */
export const ACCEPTED_COMPONENTS = ["commands", "mcpServers", "skills"] as const;

/**
 * Benign manifest metadata, observed in 25 bundled manifests plus 42crunch's.
 * A key outside this set AND outside KNOWN_COMPONENT_KEYS rejects by name.
 */
export const ALLOWED_MANIFEST_KEYS = new Set([
  "name", "version", "description", "author", "homepage", "repository",
  "license", "keywords", "category",
  ...ACCEPTED_COMPONENTS,
]);

export interface Verdict { accepted: boolean; reason?: string; components: string[]; rejected: string[] }

export interface ClassifyInput {
  manifest: Record<string, unknown> | null;
  /** Top-level entry names in the plugin dir (files and dirs, no paths). */
  topLevel: string[];
  /** Component keys declared on the marketplace entry (§25 — lspServers lives there). */
  entryComponents?: string[];
}

/** Every component present, by any of the three routes. Sorted, deduped. */
export function detectComponents(
  manifest: Record<string, unknown> | null,
  topLevel: string[],
  entryComponents: string[] = [],
): string[] {
  const found = new Set<string>();
  const names = new Set(topLevel);
  for (const [key, dir] of Object.entries(COMPONENT_DIRS)) if (names.has(dir)) found.add(key);
  for (const [key, file] of Object.entries(COMPONENT_FILES)) if (names.has(file)) found.add(key);
  for (const key of KNOWN_COMPONENT_KEYS) {
    if (manifest && key in manifest) found.add(key);
    if (entryComponents.includes(key)) found.add(key);
  }
  return [...found].sort();
}

export function classifyPlugin(input: ClassifyInput): Verdict {
  const components = detectComponents(input.manifest, input.topLevel, input.entryComponents);
  const accepted = new Set<string>(ACCEPTED_COMPONENTS);
  const rejected = components.filter((c) => !accepted.has(c));

  // A manifest key we do not recognise is where a future component type will
  // announce itself — reject, and say which key so it is a data fix.
  const badKey = Object.keys(input.manifest ?? {}).find(
    (k) => !ALLOWED_MANIFEST_KEYS.has(k) && !KNOWN_COMPONENT_KEYS.includes(k),
  );
  if (badKey) {
    return { accepted: false, reason: `declares "${badKey}", which HappyVibe does not recognise`, components: components.filter((c) => accepted.has(c)), rejected };
  }
  if (rejected.length > 0) {
    return { accepted: false, reason: `uses ${rejected.join(" and ")}, not supported in HappyVibe`, components: components.filter((c) => accepted.has(c)), rejected };
  }
  if (components.length === 0) {
    return { accepted: false, reason: "nothing HappyVibe can install", components: [], rejected: [] };
  }
  return { accepted: true, components, rejected: [] };
}
```

- [x] **Step 4: Run the test — expect PASS**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-classify.test.ts tests/plugin-marketplace.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 5: Commit**

```bash
git add src/main/plugins/classify.ts tests/plugin-classify.test.ts
git commit -m "feat(plugins): classify a plugin's component surface from tree, manifest and entry"
```

---

### Task 3: Path screening + `${CLAUDE_PLUGIN_ROOT}` substitution (PURE)

**Files:**
- Create: `src/main/plugins/screen.ts`
- Create: `tests/plugin-screen.test.ts`

**Interfaces:**
- Produces: `screenSkillText(text): ScreenResult`, `substitutePluginRoot(text, root): string`, `countPluginRootRefs(text): number`.

```ts
export interface ScreenResult { verdict: "ok" | "reject" | "warn"; reason?: string }
```

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { screenSkillText, substitutePluginRoot, countPluginRootRefs } from "../src/main/plugins/screen";

describe("screenSkillText", () => {
  it("hard-rejects a hardcoded ~/.claude/skills path", () => {
    // The failure mode is SILENT: every such call is `2>/dev/null || true`, so
    // the user gets confident prose with the machinery quietly dead.
    const r = screenSkillText("run bash ~/.claude/skills/gstack/bin/x 2>/dev/null || true");
    expect(r.verdict).toBe("reject");
    expect(r.reason).toContain(".claude/skills");
  });

  it("hard-rejects the absolute spelling too", () => {
    expect(screenSkillText("cat /Users/me/.claude/skills/a/SKILL.md").verdict).toBe("reject");
  });

  it("passes a clean skill", () => {
    expect(screenSkillText("# Skill\nRun `npm test`.").verdict).toBe("ok");
  });

  it("warns on a bare $SKILL_DIR — degrades, does not break", () => {
    const r = screenSkillText("python3 $SKILL_DIR/scripts/go.py");
    expect(r.verdict).toBe("warn");
    expect(r.reason).toContain("SKILL_DIR");
  });

  it("does NOT reject ${CLAUDE_PLUGIN_ROOT} — it is substituted at install", () => {
    expect(screenSkillText("bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh").verdict).toBe("ok");
  });
});

describe("substitutePluginRoot", () => {
  it("replaces every spelling with the installed root", () => {
    const out = substitutePluginRoot('a ${CLAUDE_PLUGIN_ROOT}/x $CLAUDE_PLUGIN_ROOT/y "${CLAUDE_PLUGIN_ROOT}"', "/tmp/p");
    expect(out).toBe('a /tmp/p/x /tmp/p/y "/tmp/p"');
  });
  it("counts refs for the disclosure", () => {
    expect(countPluginRootRefs("${CLAUDE_PLUGIN_ROOT}/a $CLAUDE_PLUGIN_ROOT/b")).toBe(2);
    expect(countPluginRootRefs("none")).toBe(0);
  });
  it("leaves text without refs byte-identical", () => {
    const t = "# nothing to do here\n";
    expect(substitutePluginRoot(t, "/tmp/p")).toBe(t);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-screen.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 3: Implement `screen.ts`**

```ts
/**
 * §25 ingestion screening — PURE. Runs PER FILE at ingestion, not per repo by
 * hand: the original survey sampled only 1–2 SKILL.md per repo, and the failure
 * mode it was looking for is silent (every hardcoded-path call is typically
 * `2>/dev/null || true`, so the user gets prose with the machinery dead).
 *
 * Pi sets NO skill-path environment variable at all — no SKILL_DIR, no
 * CLAUDE_PLUGIN_ROOT — so this is an install-time screen or nothing.
 */
export interface ScreenResult { verdict: "ok" | "reject" | "warn"; reason?: string }

/** `~/.claude/skills/...` or any absolute path through a .claude/skills dir. */
const CLAUDE_SKILLS = /(?:~|\/[^\s"']*)?\/?\.claude\/skills\//;
/** A bare $SKILL_DIR — but not ${CLAUDE_PLUGIN_ROOT}, which we repair. */
const SKILL_DIR = /\$\{?SKILL_DIR\}?/;
const PLUGIN_ROOT = /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g;

export function screenSkillText(text: string): ScreenResult {
  if (CLAUDE_SKILLS.test(text)) {
    return {
      verdict: "reject",
      reason: "hardcodes a ~/.claude/skills path, which cannot work here and fails silently",
    };
  }
  if (SKILL_DIR.test(text)) {
    return {
      verdict: "warn",
      reason: "uses $SKILL_DIR, which Pi does not set — the agent can usually resolve it, so this degrades rather than breaks",
    };
  }
  return { verdict: "ok" };
}

/**
 * Rewrite ${CLAUDE_PLUGIN_ROOT} to the directory the skill was installed into.
 * Sound because import copies the skill dir to a path HappyVibe chose and hashes
 * it AFTER the copy, so the substitution lands inside the content the user then
 * reviews and approves. Disclosed on the row — we are rewriting third-party text.
 */
export function substitutePluginRoot(text: string, root: string): string {
  return text.replace(PLUGIN_ROOT, root);
}

export function countPluginRootRefs(text: string): number {
  return text.match(PLUGIN_ROOT)?.length ?? 0;
}
```

- [x] **Step 4: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/plugin-screen.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/plugins/screen.ts tests/plugin-screen.test.ts
git commit -m "feat(plugins): screen skill paths, substitute CLAUDE_PLUGIN_ROOT"
```

---

### Task 4: Scan an extracted plugin directory

**Files:**
- Create: `src/main/plugins/scan.ts`
- Create: `tests/plugin-scan.test.ts`

**Interfaces:**
- Consumes: `classifyPlugin`, `screenSkillText`, `countPluginRootRefs`; `scanSkillsDir`/`readSkillDir` from `../skills/discovery`; `readMcpFile` from `../mcp`.
- Produces: `scanPluginDir(dir: string, entryComponents?: string[]): PluginScan`.

```ts
export interface PluginScan {
  name: string; description: string;
  verdict: Verdict;
  skills: Array<{ dir: string; name: string; description: string; scriptCount: number; screen: ScreenResult; pluginRootRefs: number }>;
  /** Top-level commands/*.md only — Pi's loader is a flat readdir. */
  commands: Array<{ file: string; name: string }>;
  /** Namespaced command paths: counted and disclosed, never installed. */
  nestedCommands: string[];
  mcpServers: Record<string, McpServerConfig>;
  /** Rejected component ⇢ how many, for the disclosure banner. */
  dropped: Record<string, number>;
}
```

- [x] **Step 1: Write the failing test** (builds a fake plugin tree in a temp dir)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanPluginDir } from "../src/main/plugins/scan";

let root: string;
const w = (rel: string, body: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plugin-"));
  w(".claude-plugin/plugin.json", JSON.stringify({ name: "demo", description: "d", author: {}, category: "dev" }));
  w("skills/good/SKILL.md", "---\nname: good\ndescription: a good skill\n---\nBody using ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh\n");
  w("skills/bad/SKILL.md", "---\nname: bad\ndescription: hardcoded\n---\ncat ~/.claude/skills/bad/notes.md 2>/dev/null || true\n");
  w("commands/review.md", "---\ndescription: review it\n---\nReview $ARGUMENTS\n");
  w("commands/git/commit.md", "---\ndescription: nested\n---\nnope\n");
  w(".mcp.json", JSON.stringify({ mcpServers: { demo: { url: "https://example.com/mcp" } } }));
  w("hooks/hooks.json", JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo a" }, { type: "command", command: "echo b" }] }] } }));
  w("scripts/payload.sh", "#!/bin/sh\necho payload\n");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("scanPluginDir", () => {
  it("reads the manifest name and rejects on hooks", () => {
    const s = scanPluginDir(root);
    expect(s.name).toBe("demo");
    expect(s.verdict.accepted).toBe(false);
    expect(s.verdict.rejected).toEqual(["hooks"]);
  });

  it("finds skills and screens each one", () => {
    const s = scanPluginDir(root);
    const good = s.skills.find((k) => k.name === "good")!;
    const bad = s.skills.find((k) => k.name === "bad")!;
    expect(good.screen.verdict).toBe("ok");
    expect(good.pluginRootRefs).toBe(1);
    expect(bad.screen.verdict).toBe("reject");
  });

  it("takes top-level commands only and counts the nested ones", () => {
    const s = scanPluginDir(root);
    expect(s.commands.map((c) => c.name)).toEqual(["review"]);
    expect(s.nestedCommands).toEqual(["git/commit.md"]);
  });

  it("reads .mcp.json servers", () => {
    expect(Object.keys(scanPluginDir(root).mcpServers)).toEqual(["demo"]);
  });

  it("counts dropped hook commands for the disclosure", () => {
    expect(scanPluginDir(root).dropped).toMatchObject({ hooks: 2 });
  });

  it("ignores payload directories", () => {
    expect(scanPluginDir(root).verdict.components).not.toContain("scripts");
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-scan.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [x] **Step 3: Implement `src/main/plugins/scan.ts`**

Read the manifest from `<dir>/.claude-plugin/plugin.json` (tolerate absent/corrupt → `null`), list top-level entries with `fs.readdirSync(dir, {withFileTypes:true})`, call `classifyPlugin`. Then:
- skills: `scanSkillsDir(path.join(dir,"skills"), "managed")`, and for each, `screenSkillText(fs.readFileSync(skill.skillMdPath,"utf8"))` + `countPluginRootRefs`.
- commands: `fs.readdirSync(path.join(dir,"commands"),{withFileTypes:true})` — `.md` **files** become `commands`, and every `.md` under a subdirectory (walk it) becomes a `nestedCommands` relative path. Name = basename minus `.md`.
- mcpServers: merge `readMcpFile(path.join(dir,".mcp.json")).mcpServers` with `manifest.mcpServers` when present (manifest wins on a key clash).
- `dropped`: for each rejected component, a count worth showing — hooks: total hook **commands** across `hooks/hooks.json` (walk `hooks[event][].hooks[]`), otherwise the number of files/keys found. Add `nestedCommands.length` under key `"namespaced commands"` when non-zero.

Every read is wrapped: a corrupt plugin must scan to a verdict, never throw.

- [x] **Step 4: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/plugin-scan.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/plugins/scan.ts tests/plugin-scan.test.ts
git commit -m "feat(plugins): scan an extracted plugin into installable components"
```

---

### Task 5: Install and remove a plugin (impure, path-confined)

**Files:**
- Create: `src/main/plugins/install.ts`
- Create: `tests/plugin-install.test.ts`

**Interfaces:**
- Consumes: `PluginScan`; `substitutePluginRoot`; `readSkillDir`; `writeMcpServer`.
- Produces:
  - `installPluginSkills(scan, opts): InstalledSkill[]` where `opts = {destParent, pluginId, marketplaceId}` — copies each chosen skill dir, then rewrites `${CLAUDE_PLUGIN_ROOT}` **in the copy** to the installed dir, returning `{dir, skill: DiscoveredSkill, substituted: number}`.
  - `installPluginCommands(scan, opts): string[]` — copies chosen top-level `.md` files to `destDir`, refusing a name already present.
  - `pluginOrigin(pluginId, marketplaceId): {plugin: string; marketplace: string}`.
  - `findPluginServers(mcpFile, pluginId): string[]` — server names whose `origin.plugin` matches, for removal.

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPluginSkills, installPluginCommands, findPluginServers, pluginOrigin } from "../src/main/plugins/install";
import { scanPluginDir } from "../src/main/plugins/scan";
import { writeMcpServer, readMcpFile } from "../src/main/mcp";

let tmp: string, src: string, dest: string;
const w = (base: string, rel: string, body: string) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-pi-"));
  src = path.join(tmp, "plugin"); dest = path.join(tmp, "dest");
  w(src, ".claude-plugin/plugin.json", JSON.stringify({ name: "demo", description: "d", author: {} }));
  w(src, "skills/one/SKILL.md", "---\nname: one\ndescription: uses its root\n---\nbash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh\n");
  w(src, "skills/one/scripts/x.sh", "echo hi\n");
  w(src, "commands/review.md", "---\ndescription: r\n---\nbody\n");
  fs.mkdirSync(dest, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("installPluginSkills", () => {
  it("copies the skill and rewrites CLAUDE_PLUGIN_ROOT to the installed dir", () => {
    const scan = scanPluginDir(src);
    const out = installPluginSkills(scan, { destParent: dest, pluginId: "demo", marketplaceId: "official", skillDirs: scan.skills.map((s) => s.dir) });
    expect(out).toHaveLength(1);
    const installed = out[0].dir;
    const body = fs.readFileSync(path.join(installed, "SKILL.md"), "utf8");
    expect(body).toContain(`bash ${installed}/scripts/x.sh`);
    expect(body).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(out[0].substituted).toBe(1);
    // the hash must be taken AFTER substitution, so approval covers what runs
    expect(out[0].skill.hash).toBe(scanHashOf(installed));
    function scanHashOf(d: string): string { return readSkillDirHash(d); }
    function readSkillDirHash(d: string): string {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readSkillDir } = require("../src/main/skills/discovery");
      return readSkillDir(d, "managed").hash;
    }
  });

  it("refuses to escape the destination parent", () => {
    const scan = scanPluginDir(src);
    expect(() => installPluginSkills(scan, { destParent: dest, pluginId: "demo", marketplaceId: "official", skillDirs: ["/etc"] })).toThrow();
  });
});

describe("installPluginCommands", () => {
  it("copies a top-level command", () => {
    const scan = scanPluginDir(src);
    const names = installPluginCommands(scan, { destDir: dest, files: scan.commands.map((c) => c.file) });
    expect(names).toEqual(["review"]);
    expect(fs.existsSync(path.join(dest, "review.md"))).toBe(true);
  });

  it("refuses a name already on disk rather than overwriting", () => {
    fs.writeFileSync(path.join(dest, "review.md"), "mine");
    const scan = scanPluginDir(src);
    expect(() => installPluginCommands(scan, { destDir: dest, files: scan.commands.map((c) => c.file) })).toThrow(/review/);
    expect(fs.readFileSync(path.join(dest, "review.md"), "utf8")).toBe("mine");
  });
});

describe("origin link", () => {
  it("finds a plugin's servers for removal and leaves others alone", () => {
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "fromplugin", { url: "https://a", origin: pluginOrigin("demo", "official") });
    writeMcpServer(f, "byhand", { url: "https://b" });
    expect(findPluginServers(f, "demo")).toEqual(["fromplugin"]);
    // and the origin survives the round-trip (unknown keys are preserved)
    expect(readMcpFile(f).mcpServers.fromplugin.origin).toMatchObject({ plugin: "demo" });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/plugin-install.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

- [x] **Step 3: Implement `install.ts`** — confinement first (resolve the destination and assert it is inside `destParent`, the `ipc.ts:2326` pattern), `fs.cpSync`, then walk the copy and `substitutePluginRoot` every text file (`.md`, `.sh`, `.py`, `.js`, `.mjs`, `.cjs`, `.ts`, `.txt`, `.json`, `.yaml`, `.yml`), then `readSkillDir(dest, "managed")` so the returned hash covers the substituted bytes.

- [x] **Step 4: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/plugin-install.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/plugins/install.ts tests/plugin-install.test.ts
git commit -m "feat(plugins): install a plugin's components, origin-linked and confined"
```

---

### Task 6: IPC surface

**Files:**
- Modify: `src/main/ipc.ts` (new `hv:plugins-*` handlers beside the `hv:skills-*` block)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/hv.d.ts`
- Modify: `src/main/config.ts` (a `marketplaces` list in app config, seeded with the official one)
- Create: `tests/plugin-ipc.test.ts` (pure helpers only — the handlers themselves are covered by the GUI pass)

**Interfaces:**
- `hv:plugins-marketplaces` → `HvMarketplace[]` (`{id, url, name, entryCount}`)
- `hv:plugins-add-marketplace(url)` / `hv:plugins-remove-marketplace(id)`
- `hv:plugins-list(marketplaceId)` → `HvPluginCard[]` (`{name, description, category, accepted, reason, components}`) — classified from the **entry** alone, no per-plugin download
- `hv:plugins-scan(marketplaceId, name)` → `HvPluginScan` — downloads at `source.sha`, extracts, scans, returns the picker payload + disclosure; keeps a token like `registerImport` does
- `hv:plugins-install(token, {skillDirs, commandFiles, mcpKeys})` → installed summary; approves skills `enabled:false`, approves commands, writes servers with `origin`, then `scheduleSkillReload` + `scheduleMcpReload`
- `hv:plugins-remove(pluginId)` → removes skills/commands by provenance and servers by `origin`

- [x] **Step 1: Seed the marketplace list in config**

```ts
// §25: the resolver supports N marketplaces; V1 ships exactly one listed.
// Adding another is a user action — the app lists nothing on the user's behalf.
export const OFFICIAL_MARKETPLACE = {
  id: "claude-plugins-official",
  url: "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
};
export function listMarketplaces(): Array<{ id: string; url: string }> {
  const cfg = load();
  return cfg.marketplaces ?? [OFFICIAL_MARKETPLACE];
}
```

- [x] **Step 2: Add the handlers**, following the `hv:skills-import-*` shape exactly: a `Map<string, PluginInstallSession>` with a token, a `cleanup()` that `rmSync`es the download dir, and `void log.append({type:"plugin.installed", data:{...}})` on success.

- [x] **Step 3: Typecheck**

```
npm run typecheck
```
Expected: clean (this runs node + web with `--composite false`).

- [x] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts src/main/config.ts
git commit -m "feat(plugins): IPC for browse, scan, install and remove"
```

---

### Task 7: Plugins page

**Files:**
- Create: `src/renderer/src/components/PluginsView.tsx`
- Create: `src/renderer/src/components/PluginsSection.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx` (add `"plugins"` to `View`, plus a nav icon)
- Modify: `src/renderer/src/App.tsx` (route the new view)

Follow `McpCatalogSection.tsx` for the card grid + confirm dialog and `SkillsSection.tsx`'s `ImportPicker` for the component picker. Rejected cards render greyed with `reason` — same one-line branch as an accepted card, per §25.

The confirm dialog must show, before anything is written: the resolved `sha`, what will be installed (n skills / m commands / k servers), the **disclosure banner** when `dropped` is non-empty, that skills land **disabled**, and any `${CLAUDE_PLUGIN_ROOT}` substitution count.

- [x] **Step 1: Build the page**, - [x] **Step 2: `npm run typecheck`**, - [x] **Step 3: Commit**

---

### Task 8: Full gate + GUI pass

- [x] **Step 1: Full gate**

```
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: both typechecks pass, ~908+ tests pass, build succeeds.

- [x] **Step 2: Is a live-Pi run required?**

```
npm run live:why
```
Empty output ⇒ not required, and say so. This feature touches no `pi-runtime/extensions/`, `src/main/pi/` or live test file, so it should be empty.

- [x] **Step 3: GUI pass** — `npm run dev`, then attach via the electron-debug MCP and drive: Plugins page loads the official marketplace, a rejected plugin is greyed with its reason, installing an accepted one shows the confirm with the sha and disclosure, installed skills appear on the Skills page as **disabled**, an installed server appears on the MCP page, and Remove takes all three away. Use `deepseek-v4-flash` for any model turn.

- [x] **Step 4: Commit** any GUI fixes, one per bug.

---

## Self-review

**Spec coverage:** §25 scope → Task 2; classifier (both calibrations) → Task 2; multi-marketplace + `sha` pin → Tasks 1, 6; screening + substitution → Tasks 3, 5; install-lands-disabled → Task 6; disclosure → Tasks 4, 7; provenance/removal → Tasks 5, 6. §13's MCP-by-import → Tasks 4–6. §24's top-level-commands-only → Tasks 4, 5.

**Deferred deliberately:** no marketplace refresh/cache-invalidation UI (re-scan on open is enough at 278 entries); no per-entry "update available" (§14 out-of-scope); the workspace tier for plugin skills (global only in V1, matching MCP's global-tier decision).

---

## Outcome (2026-08-04) — implemented, gate green

All eight tasks landed. `npm run gate` green (120 files, 1107 tests). `npm run live:why`
printed nothing, so the live-Pi batch was **not required** and was not run.

Three things differed from the plan, all because reality was checked before coding:

1. **A pre-existing bug blocked Task 4 and was fixed at its root.** Both frontmatter readers
   scanned one `key: value` line at a time while Pi uses `yaml.parse`, so any multi-line
   `description:` read as empty — which for skills means `loadable:false`, a false "missing a
   description" on the Skills page, and `resolveActiveSkills` refusing to pass the dir to
   `--skill`. Anthropic's own `math-olympiad` hit it. Fixed in the two shared readers with
   `yaml` pinned to Pi's version; recorded in CLAUDE.md.
2. **Task 5's confinement test initially passed for the wrong reason** (ENOENT, not the guard).
   Rewritten to drive the guard through a `basename === ".."` path.
3. **The GUI pass found two real gaps**, both fixed: install had no inverse in the UI, and the
   browse line claimed "266 of 278 supported" when entry-level classification can only rule out
   12 — about thirty points of overstatement.

Verified in the running app, not just in tests: browse fetches all 278 real entries; installing
42crunch pins to its commit (shown before the write) and lands 5 skills **DISABLED/MANAGED**; a
hooks-bearing bundled `./path` entry rejects at scan with only Cancel offered; Remove empties both
the Installed block and the Skills page.

Still open: workspace-tier plugin installs (global only, matching the MCP-tier decision), and the
`agents/` surface, which stays blocked until the subagent permission gap closes.
