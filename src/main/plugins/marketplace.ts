import { KNOWN_COMPONENT_KEYS } from "./classify";

/**
 * §25 marketplace.json parsing — PURE, electron-free, vitest-importable.
 *
 * Calibrated against the real `anthropics/claude-plugins-official` (278 entries,
 * fetched 2026-08-04), NOT against the docs: the `source` shapes actually
 * present are `url` (143), `git-subdir` (80), a bare "./path" string (53) and
 * `github` (2), where url/git-subdir may carry `path` and `ref`.
 *
 * The PIN is `source.sha`. It is present on all 225 object sources and resolves
 * as a real git commit on codeload (verified against two entries in different
 * repos). `source.ref` is only a branch or tag, is absent on 146 entries, and is
 * therefore DISPLAY ONLY. A bare "./path" entry lives inside the marketplace
 * repo, so it is pinned by whatever commit we fetched the marketplace at and
 * carries no sha of its own.
 *
 * Every failure is a SKIP, never a throw: two official entries are already dead
 * links, and one bad row must not cost the user the other 277.
 */

export interface PluginSourceRef {
  /** null ⇒ the plugin lives inside the marketplace repo itself (bare "./path"). */
  repoUrl: string | null;
  /** The commit we fetch (source.commit ?? source.sha). null for marketplace-local entries. */
  sha: string | null;
  /** Branch or tag, for display only. */
  ref?: string;
  /** Subdirectory holding the plugin; "" means repo root. */
  subdir: string;
}

export interface MarketplaceEntry {
  name: string;
  description: string;
  category?: string;
  homepage?: string;
  source: PluginSourceRef;
  /** Component keys declared on the ENTRY (the official marketplace puts lspServers there). */
  entryComponents: string[];
}

export interface ParsedMarketplace {
  name: string;
  description?: string;
  entries: MarketplaceEntry[];
  skipped: Array<{ name: string; reason: string }>;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Normalize a repo reference to an https clone URL. Accepts "owner/name" or a full URL. */
function toRepoUrl(v: string): string {
  if (/^https?:\/\//.test(v)) return v;
  return `https://github.com/${v.replace(/^\/+|\/+$/g, "")}.git`;
}

/** Strip "./" and trailing slashes; "." means repo root. Returns null if it escapes. */
function cleanSubdir(v: string | undefined): string | null {
  const p = (v ?? "").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (p === "." || p === "") return "";
  if (p.startsWith("/") || p.split("/").includes("..")) return null;
  return p;
}

/** @returns a PluginSourceRef, or a string explaining why the entry is skipped. */
function parseSource(raw: unknown): PluginSourceRef | string {
  // Bare "./plugins/foo" — relative to the marketplace repo.
  if (typeof raw === "string") {
    const sub = cleanSubdir(raw);
    if (sub === null || sub === "") return "source path is empty or escapes the marketplace";
    return { repoUrl: null, sha: null, subdir: sub };
  }
  if (!raw || typeof raw !== "object") return "missing source";
  const o = raw as Record<string, unknown>;
  const kind = str(o.source) ?? "?";
  const base = str(o.url) ?? (str(o.repo) ? toRepoUrl(str(o.repo) as string) : undefined);
  if (!base) return `source "${kind}" has neither url nor repo`;
  const sub = cleanSubdir(str(o.path));
  if (sub === null) return "source path escapes the repo";
  // `commit` (github shape) is an explicit pin; otherwise `sha`, which every
  // object source carries. Both are real commits.
  return {
    repoUrl: toRepoUrl(base),
    sha: str(o.commit) ?? str(o.sha) ?? null,
    ref: str(o.ref),
    subdir: sub,
  };
}

export function parseMarketplace(raw: unknown): ParsedMarketplace {
  const out: ParsedMarketplace = { name: "", entries: [], skipped: [] };
  if (!raw || typeof raw !== "object") return out;
  const d = raw as Record<string, unknown>;
  out.name = str(d.name) ?? "";
  out.description = str(d.description);
  const plugins = Array.isArray(d.plugins) ? d.plugins : [];
  for (const p of plugins) {
    if (!p || typeof p !== "object") {
      out.skipped.push({ name: "?", reason: "not an object" });
      continue;
    }
    const e = p as Record<string, unknown>;
    const name = str(e.name);
    if (!name) {
      out.skipped.push({ name: "?", reason: "missing name" });
      continue;
    }
    const src = parseSource(e.source);
    if (typeof src === "string") {
      out.skipped.push({ name, reason: src });
      continue;
    }
    out.entries.push({
      name,
      description: str(e.description) ?? "",
      category: str(e.category),
      homepage: str(e.homepage),
      source: src,
      entryComponents: KNOWN_COMPONENT_KEYS.filter((k) => k in e),
    });
  }
  return out;
}

/**
 * codeload (or generic forge) archive URL for an entry, pinned to its sha.
 * Returns null when the plugin lives in the marketplace repo — the caller
 * already has those files.
 */
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
