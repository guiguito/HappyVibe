/**
 * A literal NUL byte in a source file makes `grep` and `ripgrep` classify it as
 * BINARY and skip it — silently. A search for a symbol that lives in that file
 * returns nothing and exits 0, which reads as "not in the codebase".
 *
 * `Transcript.tsx` carried one inside a cache key (`${q}\0${active}` written as
 * the raw character), so the largest renderer file was invisible to every
 * search — found while reading it for round 12. The same class was fixed once
 * before in a plan document (db2d4fe). `\0` is the escape, and `tabs.ts`
 * already spells `bufferKey` that way.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const ROOTS = ["src", "pi-runtime/extensions", "tests"];
const EXTS = /\.(ts|tsx|css|json|md)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.test(name)) out.push(p);
  }
  return out;
}

test("no source file contains a NUL byte — it hides the file from grep, silently", () => {
  const root = join(__dirname, "..");
  const offenders = ROOTS.flatMap((r) => walk(join(root, r)))
    .filter((f) => readFileSync(f).includes(0x00))
    .map((f) => f.slice(root.length + 1));
  expect(offenders).toEqual([]);
});
