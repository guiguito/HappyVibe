import { classifyPlugin, type Verdict } from "./classify";
import type { MarketplaceEntry } from "./marketplace";

/**
 * §25 — the one classification pass over a marketplace's entries.
 *
 * The way a plugin's files are OBTAINED is injected, because there are two
 * callers with genuinely different constraints and only one policy:
 *
 *  - the release-time generator (tools/plugin-catalog) downloads each repo's
 *    tarball and runs the app's real `scanPluginDir`. Heavy, but it is a
 *    maintainer's machine and codeload is not the 60/hour API.
 *  - the runtime indexer for user-added marketplaces (phase 2) cannot download
 *    hundreds of tarballs onto a user's disk, so it probes the GitHub trees API
 *    instead and throttles.
 *
 * Keeping the policy here means the two can never disagree about what
 * "supported" means, which is the whole reason the store can be trusted.
 */

/** What the classifier needs about one plugin, however it was obtained. */
export interface PluginProbe {
  /** Parsed `.claude-plugin/plugin.json`, or null when absent/corrupt. */
  manifest: Record<string, unknown> | null;
  /** Top-level entry names in the plugin dir (bare names, no paths). */
  topLevel: string[];
  /** Installable component counts, for the card. */
  counts: { skills: number; commands: number; servers: number };
}

/** Obtain a probe for one entry. Return null to skip it (dead repo, bad path). */
export type ProbeEntry = (entry: MarketplaceEntry) => Promise<PluginProbe | null>;

export interface ClassifiedEntry {
  entry: MarketplaceEntry;
  verdict: Verdict;
  counts: { skills: number; commands: number; servers: number };
}

export interface ClassifyEntriesResult {
  /** Every entry that produced a verdict, accepted or not. */
  classified: ClassifiedEntry[];
  /** Entries we could not probe at all — recorded, never thrown. */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Classify every entry. A probe that throws or returns null becomes a SKIP:
 * two entries in the official marketplace are already dead links, and one bad
 * row must not cost the user the other 277.
 */
export async function classifyEntries(
  entries: MarketplaceEntry[],
  probe: ProbeEntry,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<ClassifyEntriesResult> {
  const out: ClassifyEntriesResult = { classified: [], skipped: [] };
  let done = 0;
  for (const entry of entries) {
    try {
      const p = await probe(entry);
      if (!p) {
        out.skipped.push({ name: entry.name, reason: "could not be resolved" });
      } else {
        out.classified.push({
          entry,
          verdict: classifyPlugin({
            manifest: p.manifest,
            topLevel: p.topLevel,
            entryComponents: entry.entryComponents,
          }),
          counts: p.counts,
        });
      }
    } catch (e) {
      out.skipped.push({ name: entry.name, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(++done, entries.length, entry.name);
  }
  return out;
}

/**
 * Only entries worth listing: accepted AND carrying something installable.
 * A plugin whose `skills/` dir holds nothing Pi would load is accepted by the
 * classifier but has nothing to offer, and listing it would be a card that
 * installs zero items.
 */
export function installable(r: ClassifyEntriesResult): ClassifiedEntry[] {
  return r.classified.filter(
    (c) => c.verdict.accepted && c.counts.skills + c.counts.commands + c.counts.servers > 0,
  );
}
