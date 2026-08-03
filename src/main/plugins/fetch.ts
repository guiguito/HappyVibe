import { parseMarketplace, entryArchiveUrl, type ParsedMarketplace, type PluginSourceRef } from "./marketplace";
import { downloadAndExtract } from "../skills/gitImport";

/**
 * §25 network side — fetching a marketplace list and a plugin's archive.
 *
 * A marketplace IS a remote list by definition, which is why plugin marketplaces
 * are fetched while the MCP catalog stays bundled (PRD §13, the split decision).
 * Nothing here auto-runs: a fetch produces data the user then reads.
 *
 * The archive download deliberately reuses the §14 skills importer — HTTPS
 * tarball, no `git` binary, symlink/hardlink entries filtered out, 100 MB cap.
 * A plugin is not a more trusted download than a skill repo.
 */

const MAX_MARKETPLACE_BYTES = 8 * 1024 * 1024;

/**
 * GET and parse a marketplace.json.
 * @throws on a network error, a non-200, an over-large body, or invalid JSON —
 * the caller surfaces it on the page rather than showing an empty store.
 */
export async function fetchMarketplace(url: string): Promise<ParsedMarketplace> {
  const res = await fetch(url, {
    headers: { "User-Agent": "HappyVibe", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`marketplace fetch failed: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_MARKETPLACE_BYTES) throw new Error("marketplace file is implausibly large");
  const text = await res.text();
  if (text.length > MAX_MARKETPLACE_BYTES) throw new Error("marketplace file is implausibly large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("marketplace file is not valid JSON");
  }
  const parsed = parseMarketplace(raw);
  if (parsed.entries.length === 0) throw new Error("no usable plugins in that marketplace");
  return parsed;
}

/**
 * Download the repo holding a plugin and return the directory the plugin lives
 * in — the extraction root's single top-level dir, plus the entry's subdir.
 *
 * `src.repoUrl === null` is a marketplace-local entry ("./plugins/foo"): the
 * caller already has the marketplace repo extracted and passes it as
 * `localRoot`, so nothing is downloaded.
 */
export async function fetchPluginDir(
  src: PluginSourceRef,
  workDir: string,
  localRoot?: string,
): Promise<{ dir: string; sha: string | null }> {
  const path = await import("node:path");
  const fs = await import("node:fs");

  const joinSub = (root: string): string => (src.subdir ? path.join(root, src.subdir) : root);

  if (!src.repoUrl) {
    if (!localRoot) throw new Error("a marketplace-local plugin needs the marketplace checkout");
    return { dir: joinSub(localRoot), sha: null };
  }
  const archiveUrl = entryArchiveUrl(src);
  if (!archiveUrl) throw new Error(`unsupported plugin source: ${src.repoUrl}`);
  // downloadAndExtract only reads archiveUrl; the rest of ForgeArchive is
  // metadata the skills importer uses for provenance.
  const { root } = await downloadAndExtract(
    { archiveUrl, host: "", owner: "", repo: "", ref: src.sha ?? src.ref ?? "HEAD" },
    workDir,
  );
  // A forge tarball wraps everything in one top-level "<repo>-<ref>" dir.
  const tops = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const base = tops.length === 1 ? path.join(root, tops[0].name) : root;
  const dir = joinSub(base);
  if (!fs.existsSync(dir)) {
    throw new Error(`the plugin's path is not in that repo: ${src.subdir || "/"}`);
  }
  return { dir, sha: src.sha };
}
