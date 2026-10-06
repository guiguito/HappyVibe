/**
 * §13 (2026-10-05): one launch-time pass over what the adapter era left behind.
 * The global mcp.json is translated EVERY launch (idempotent — a hand-added entry
 * without `exposure` gets "deferred", or Pi defaults it to codemode, which we don't
 * load). Stored permission rules are migrated once (config flag).
 */
import fs from "node:fs";
import { toPiEntry } from "../../pi-runtime/extensions/hv-mcp-config";
import type { RulesFile } from "../../pi-runtime/extensions/hv-rules";

export function migrateGlobalMcpFile(file: string): boolean {
  let raw: { mcpServers?: Record<string, Record<string, unknown>>; [k: string]: unknown };
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return false; }
  if (!raw || typeof raw.mcpServers !== "object" || raw.mcpServers === null) return false;
  let changed = false;
  for (const [name, cfg] of Object.entries(raw.mcpServers)) {
    if (!cfg || typeof cfg !== "object") continue;
    const r = toPiEntry(cfg);
    if (r.changed) { raw.mcpServers[name] = r.entry; changed = true; }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  return changed;
}

/** Pi spells every char outside [A-Za-z0-9_] as `_`; the adapter kept `-` in tool names.
    The server part stays the configured name (longest match wins). mcp-manage:* rules
    named a surface that no longer exists (the model cannot install or sign in). */
export function migrateMcpRules(rules: RulesFile, servers: string[]): { rules: RulesFile; changed: boolean } {
  const byLength = [...servers].sort((a, b) => b.length - a.length);
  let changed = false;
  const fix = (list: RulesFile["global"]): RulesFile["global"] =>
    list.flatMap((r) => {
      if (r.layer !== "tool") return [r];
      if (r.pattern.startsWith("mcp-manage:")) { changed = true; return []; }
      if (!r.pattern.startsWith("mcp:")) return [r];
      const rest = r.pattern.slice(4);
      const s = byLength.find((n) => rest.startsWith(`${n}_`));
      if (!s) return [r];
      const next = `mcp:${s}_${rest.slice(s.length + 1).replace(/[^A-Za-z0-9_*]/g, "_")}`;
      if (next === r.pattern) return [r];
      changed = true;
      return [{ ...r, pattern: next }];
    });
  const out: RulesFile = { global: fix(rules.global), workspaces: Object.fromEntries(Object.entries(rules.workspaces).map(([k, v]) => [k, fix(v)])) };
  return { rules: out, changed };
}
