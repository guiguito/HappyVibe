/**
 * HappyVibe's owned patch to the vendored @tintinweb/pi-subagents (PRD §3, 2026-09-26).
 *
 * Each hunk replaces EXACT anchor text and carries a `hv-patch:<id>` marker. A
 * missing or ambiguous anchor fails the install: a patch that silently stops
 * applying is the security hole it exists to close (children trusting a folder
 * the parent refused). Re-running is a no-op, because `npm ci` re-runs postinstall.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HUNKS } from "./tintinweb-hunks.mjs";

export const TW_PKG = "node_modules/@tintinweb/pi-subagents";

export function applyHunks(pkgRoot, hunks = HUNKS) {
  // Two passes: every anchor is checked before any file is written, so a failed
  // install never leaves a half-patched package behind.
  const files = new Map();
  const todo = [];
  for (const h of hunks) {
    const mark = `hv-patch:${h.id}`;
    if (!h.replace.includes(mark)) throw new Error(`hv-patch ${h.id}: replacement must carry its marker`);
    if (!files.has(h.file)) files.set(h.file, fs.readFileSync(path.join(pkgRoot, h.file), "utf8"));
    const src = files.get(h.file);
    if (src.includes(mark)) continue;
    const n = src.split(h.find).length - 1;
    if (n !== 1) {
      throw new Error(`hv-patch ${h.id}: anchor ${n === 0 ? "missing" : `found ${n}×`} in ${h.file} — re-derive the hunk against this version`);
    }
    // Function form: a `$&` or `$1` inside a hunk stays literal.
    files.set(h.file, src.replace(h.find, () => h.replace));
    todo.push(h);
  }
  for (const f of new Set(todo.map((h) => h.file))) fs.writeFileSync(path.join(pkgRoot, f), files.get(f));
  return todo.map((h) => h.id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pi-runtime", TW_PKG);
  if (!fs.existsSync(root)) throw new Error(`[patch-tintinweb] ${root} is missing — the pi-runtime install is broken`);
  const done = applyHunks(root);
  console.log(`[patch-tintinweb] ${done.length ? `applied ${done.join(", ")}` : "already patched"}`);
}
