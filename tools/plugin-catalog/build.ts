/**
 * §25 plugin catalog generator — run by a maintainer, output committed.
 *
 *   npm run catalog:plugins
 *
 * Resolves every entry in the official marketplace, classifies it with THE APP'S
 * OWN `scanPluginDir`, and writes src/main/plugins/catalog.generated.ts holding
 * only the plugins HappyVibe can actually install.
 *
 * Why the app's own scanner rather than a reimplementation: the store's whole
 * promise is that everything listed installs. A second classifier would drift,
 * and the drift would show up as a refusal in front of the user. Sharing the
 * code makes generator/app agreement structural instead of aspirational.
 *
 * Why tarballs rather than the GitHub API: codeload is not the 60/hour API, so
 * this needs no token and cannot be rate-limited. Extracted trees are cached by
 * sha under .cache/ (gitignored), so a monthly re-run only fetches repos whose
 * sha actually moved.
 *
 * Runs through jiti so it can import the app's TypeScript modules directly
 * (they use extensionless imports, which plain node cannot resolve).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseMarketplace, entryArchiveUrl, marketplaceRepoArchive, type MarketplaceEntry,
} from "../../src/main/plugins/marketplace";
import { classifyEntries, installable, type PluginProbe } from "../../src/main/plugins/classifyEntries";
import { scanPluginDir, readPluginManifest } from "../../src/main/plugins/scan";
import { downloadAndExtract } from "../../src/main/skills/gitImport";
import { OFFICIAL_MARKETPLACE_URL } from "../../src/main/plugins/officialMarketplace";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CACHE = path.join(HERE, ".cache");
const OUT = path.join(ROOT, "src/main/plugins/catalog.generated.ts");
const OVERRIDES = path.join(HERE, "brand-overrides.json");
const SIMPLE_ICONS_CSS = path.join(ROOT, "node_modules/simple-icons-font/font/simple-icons.css");

// ── brand icons ─────────────────────────────────────────────────────────────

/** Every slug the installed simple-icons font actually ships, so we can only
 *  emit a class that renders. */
function realSlugs(): Set<string> {
  const css = fs.readFileSync(SIMPLE_ICONS_CSS, "utf8");
  return new Set([...css.matchAll(/\.si-([a-z0-9-]+)/g)].map((m) => m[1]));
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Best-effort slug for a plugin: its whole name, then each dash-separated word,
 * then its repo owner. Returns undefined when nothing matches — BrandMark then
 * renders a monogram, which is the correct answer for a plugin with no brand.
 */
function autoBrand(entry: MarketplaceEntry, slugs: Set<string>): string | undefined {
  const tries = [norm(entry.name), ...entry.name.toLowerCase().split("-").map(norm)];
  const owner = /github\.com\/([^/]+)\//.exec(entry.source.repoUrl ?? "")?.[1];
  if (owner) tries.push(norm(owner));
  const hit = tries.find((t) => t.length > 1 && slugs.has(t));
  return hit ? `si-${hit}` : undefined;
}

// ── the tarball probe ───────────────────────────────────────────────────────

/** Extract (or reuse) a repo at one sha, and return the dir holding the plugin. */
async function pluginDir(entry: MarketplaceEntry, marketplaceRoot: string): Promise<string | null> {
  const sub = (root: string): string => (entry.source.subdir ? path.join(root, entry.source.subdir) : root);
  // A bare "./path" entry lives in the marketplace repo we already have.
  if (!entry.source.repoUrl) return sub(marketplaceRoot);

  const archiveUrl = entryArchiveUrl(entry.source);
  if (!archiveUrl) return null;
  const key = `${norm(entry.source.repoUrl)}-${entry.source.sha ?? "head"}`.slice(0, 120);
  const dest = path.join(CACHE, key);
  if (!fs.existsSync(path.join(dest, ".ok"))) {
    fs.rmSync(dest, { recursive: true, force: true });
    await downloadAndExtract({ archiveUrl, host: "", owner: "", repo: "", ref: entry.source.sha ?? "HEAD" }, dest);
    fs.writeFileSync(path.join(dest, ".ok"), "");
  }
  const root = path.join(dest, "extracted");
  const tops = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  return sub(tops.length === 1 ? path.join(root, tops[0].name) : root);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(CACHE, { recursive: true });
  const slugs = realSlugs();
  const overrides = (JSON.parse(fs.readFileSync(OVERRIDES, "utf8")) as {
    overrides: Record<string, string | null>;
  }).overrides;

  process.stdout.write(`fetching ${OFFICIAL_MARKETPLACE_URL}\n`);
  const res = await fetch(OFFICIAL_MARKETPLACE_URL, { headers: { "User-Agent": "HappyVibe" } });
  if (!res.ok) throw new Error(`marketplace fetch failed: HTTP ${res.status}`);
  const listText = await res.text();
  const mp = parseMarketplace(JSON.parse(listText) as unknown);
  process.stdout.write(`  ${mp.entries.length} entries (${mp.skipped.length} unparseable)\n`);

  // The marketplace's own repo, for every bare "./path" entry — ONE download
  // covering 53 of them rather than 53 downloads.
  const repo = marketplaceRepoArchive(OFFICIAL_MARKETPLACE_URL);
  if (!repo) throw new Error("could not derive the marketplace's own repo");
  const mpDest = path.join(CACHE, `marketplace-${repo.ref}`);
  if (!fs.existsSync(path.join(mpDest, ".ok"))) {
    fs.rmSync(mpDest, { recursive: true, force: true });
    process.stdout.write(`  downloading the marketplace repo @ ${repo.ref}\n`);
    await downloadAndExtract({ archiveUrl: repo.archiveUrl, host: "", owner: "", repo: "", ref: repo.ref }, mpDest);
    fs.writeFileSync(path.join(mpDest, ".ok"), "");
  }
  const mpExtract = path.join(mpDest, "extracted");
  const mpTops = fs.readdirSync(mpExtract, { withFileTypes: true }).filter((d) => d.isDirectory());
  const marketplaceRoot = mpTops.length === 1 ? path.join(mpExtract, mpTops[0].name) : mpExtract;

  const probe = async (entry: MarketplaceEntry): Promise<PluginProbe | null> => {
    const dir = await pluginDir(entry, marketplaceRoot);
    if (!dir || !fs.existsSync(dir)) return null;
    // The app's real scanner, for the counts. Its verdict is deliberately NOT
    // forwarded: classifyEntries owns the policy and re-derives it from the same
    // manifest + tree that scanPluginDir itself feeds to classifyPlugin, so the
    // two agree by construction rather than by one trusting the other.
    const s = scanPluginDir(dir, entry.entryComponents);
    return {
      manifest: readPluginManifest(dir),
      topLevel: fs.readdirSync(dir),
      // Feeds the client-allowlist gate in classifyEntries: a plugin whose
      // server only pre-approved clients can reach is not listed.
      mcpServers: s.mcpServers,
      counts: {
        // A skill that failed the path screen cannot be installed, so it must
        // not be counted as something this plugin offers.
        skills: s.skills.filter((k) => k.screen.verdict !== "reject").length,
        commands: s.commands.length,
        servers: Object.keys(s.mcpServers).length,
      },
    };
  };

  const result = await classifyEntries(mp.entries, probe, (done, total, name) => {
    if (done % 25 === 0 || done === total) process.stdout.write(`  ${done}/${total} ${name}\n`);
  });

  const keep = installable(result);
  const entries = keep.map((c) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, c.entry.name)
      ? overrides[c.entry.name]
      : undefined;
    const brand = override === null ? undefined : (override ?? autoBrand(c.entry, slugs));
    return {
      name: c.entry.name,
      description: c.entry.description,
      category: c.entry.category,
      homepage: c.entry.homepage,
      sha: c.entry.source.sha,
      ref: c.entry.source.ref,
      source: c.entry.source,
      brand,
      counts: c.counts,
    };
  });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // ── summary, so a big swing is visible at review ──────────────────────────
  const reasons = new Map<string, number>();
  for (const c of result.classified) {
    if (c.verdict.accepted) continue;
    const r = c.verdict.reason ?? "?";
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const emptyAccepted = result.classified.filter(
    (c) => c.verdict.accepted && c.counts.skills + c.counts.commands + c.counts.servers === 0,
  ).length;
  process.stdout.write(
    `\nlisted ${entries.length} of ${mp.entries.length}` +
      ` (${Math.round((100 * entries.length) / mp.entries.length)}%)\n` +
      `  accepted but empty (not listed): ${emptyAccepted}\n` +
      `  unresolvable (skipped):          ${result.skipped.length}\n` +
      `  with a brand icon:               ${entries.filter((e) => e.brand).length}\n` +
      `rejected by reason:\n` +
      [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `  ${String(n).padStart(4)}  ${r}\n`).join("") +
      (result.skipped.length
        ? `skips:\n${result.skipped.map((s) => `  ${s.name}: ${s.reason}\n`).join("")}`
        : ""),
  );

  const banner = `/**
 * GENERATED by tools/plugin-catalog/build.ts — do not edit by hand.
 *   npm run catalog:plugins
 *
 * §25: the plugin store is verified at release time and embedded, so the page
 * opens offline and lists only plugins that actually install. Every entry was
 * classified by the app's own scanPluginDir at the sha recorded below, and
 * install pins that same sha — what was checked is exactly what lands.
 *
 * The accepted cost is staleness: a plugin added upstream after this ran is
 * invisible until the next release. Same trade as the MCP catalog (§13 round 8),
 * without its manual per-entry tax, because this is generated.
 */
import type { PluginSourceRef } from "./marketplace";

export interface PluginCatalogEntry {
  name: string;
  description: string;
  category?: string;
  homepage?: string;
  /** The commit this was verified at, and the one install fetches. */
  sha: string | null;
  /** Branch or tag, display only. */
  ref?: string;
  /** Everything scan needs to fetch it with no live marketplace call. */
  source: PluginSourceRef;
  /** simple-icons class; undefined → BrandMark renders a monogram. */
  brand?: string;
  /** Card counts, so a card needs no download. */
  counts: { skills: number; commands: number; servers: number };
}

/** When this catalog was generated, shown in the UI so staleness is disclosed. */
export const CATALOG_GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};
/** The marketplace list ref these verdicts came from. */
export const CATALOG_MARKETPLACE_REF = ${JSON.stringify(repo.ref)};

export const PLUGIN_CATALOG: PluginCatalogEntry[] = ${JSON.stringify(entries, null, 2)};
`;
  fs.writeFileSync(OUT, banner);
  process.stdout.write(`\nwrote ${path.relative(ROOT, OUT)}\n`);
}

await main();
