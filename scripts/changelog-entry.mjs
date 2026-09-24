/**
 * §38 — print one version's CHANGELOG.md entry, heading excluded. The release
 * workflow uses it as the draft's notes, so GitHub, the in-app Changelog page
 * and the update row all carry the same words (§30: one copy).
 *
 *   node scripts/changelog-entry.mjs 0.2.0
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function changelogEntry(md, version) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const body = changelogEntry(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), process.argv[2] ?? "");
  if (body === null) {
    console.error(`No CHANGELOG.md entry for ${process.argv[2]}`);
    process.exit(1);
  }
  process.stdout.write(body + "\n");
}
