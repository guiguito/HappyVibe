/**
 * §25 plugin component classifier — PURE, electron-free, vitest-importable.
 *
 * ALLOWLIST, never denylist: Anthropic keeps adding executable component types
 * (monitors and channels are recent), so a denylist fails OPEN on the next
 * release while an allowlist merely fails closed on something new until we
 * understand it.
 *
 * Two halves, and both were calibrated against the real marketplace on
 * 2026-08-04 because the design-as-written got each one wrong:
 *
 *  1. Components are detected by KNOWN NAME over dirs, files AND manifest/entry
 *     fields. Unknown directories are IGNORED — real plugin roots ship
 *     hooks-handlers/, scripts/, core/, utils/, matchers/, examples/, assets/
 *     and references/ as ordinary payload, so "reject on unknown component
 *     dirs" would have rejected working plugins for shipping a source folder.
 *  2. ALLOWED_MANIFEST_KEYS carries the benign metadata real plugins use.
 *     `category` is the proof: the survey validated 42crunch BY HAND as clean,
 *     yet its manifest has `category`, so the first allowlist would have
 *     rejected the one plugin used to prove the classifier worked.
 *
 * Unknown-key reject is KEPT rather than relaxed to "ignore unknown metadata",
 * because a manifest field is exactly where the next executable component type
 * will announce itself. The message names the key, so a benign addition is a
 * one-line data change rather than an unexplained missing plugin.
 *
 * Classifying from the manifest ALONE is unsound, not merely incomplete: every
 * executable component type has both a convention path and a manifest field.
 * Verified empirically — the `airtable` plugin declares no `mcpServers` yet
 * ships a `.mcp.json`, so a manifest-only filter passes it.
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

/**
 * Every component key we recognise, in a plugin manifest OR a marketplace entry.
 * The official marketplace declares `lspServers` (12 entries) and `skills` (4)
 * on the ENTRY rather than in the manifest — a free pre-filter signal that
 * needs no per-plugin download.
 */
export const KNOWN_COMPONENT_KEYS: string[] = [
  ...Object.keys(COMPONENT_DIRS),
  ...Object.keys(COMPONENT_FILES),
];

/** Scenario C (PRD §25). Everything else rejects. */
export const ACCEPTED_COMPONENTS = ["commands", "mcpServers", "skills"] as const;

/**
 * Benign manifest metadata, observed across 25 bundled manifests plus 42crunch's
 * (fetched at its pinned commit). A key outside this set AND outside
 * KNOWN_COMPONENT_KEYS rejects, by name.
 */
export const ALLOWED_MANIFEST_KEYS = new Set<string>([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "category",
  ...ACCEPTED_COMPONENTS,
]);

export interface Verdict {
  accepted: boolean;
  /** One line for the greyed card: "uses hooks, not supported in HappyVibe". */
  reason?: string;
  /** Accepted components detected, sorted. */
  components: string[];
  /** Detected but not accepted — what the disclosure names. */
  rejected: string[];
}

export interface ClassifyInput {
  manifest: Record<string, unknown> | null;
  /** Top-level entry names in the plugin dir (bare names, no paths). */
  topLevel: string[];
  /** Component keys declared on the marketplace entry. */
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
  const all = detectComponents(input.manifest, input.topLevel, input.entryComponents);
  const ok = new Set<string>(ACCEPTED_COMPONENTS);
  const rejected = all.filter((c) => !ok.has(c));
  const components = all.filter((c) => ok.has(c));

  // A manifest key we do not recognise is where a future executable component
  // type will announce itself — reject, and name it so it is a data fix.
  const badKey = Object.keys(input.manifest ?? {}).find(
    (k) => !ALLOWED_MANIFEST_KEYS.has(k) && !KNOWN_COMPONENT_KEYS.includes(k),
  );
  if (badKey) {
    return {
      accepted: false,
      reason: `declares "${badKey}", which HappyVibe does not recognise`,
      components,
      rejected,
    };
  }
  if (rejected.length > 0) {
    return {
      accepted: false,
      reason: `uses ${rejected.join(" and ")}, not supported in HappyVibe`,
      components,
      rejected,
    };
  }
  if (components.length === 0) {
    return { accepted: false, reason: "nothing HappyVibe can install", components: [], rejected: [] };
  }
  return { accepted: true, components, rejected: [] };
}
