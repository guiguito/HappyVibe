import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isShadowed, RESERVED_SLASH_COMMANDS } from "../src/main/promptTemplates/view";

/**
 * A hand-maintained reserved list rots the moment someone adds an `/hv-*`
 * command: the new bridge command silently shadows any same-named prompt
 * template (PRD §24), and the Commands page would show that file as "active"
 * while Pi never reaches it. So the truth is DERIVED from the bridge here, and
 * `view.ts` only has to agree.
 */
const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");

test("reserved names match every registerCommand in the bridge", () => {
  const src = fs.readFileSync(BRIDGE, "utf8");
  const found = [...src.matchAll(/pi\.registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(found.length).toBeGreaterThan(10); // guard against the regex silently matching nothing
  // Every registerCommand call must be a plain string literal, or the regex above
  // under-counts and the assertion below passes vacuously.
  expect((src.match(/pi\.registerCommand\(/g) ?? []).length).toBe(found.length);
  expect([...RESERVED_SLASH_COMMANDS].sort()).toEqual([...new Set(found)].sort());
});

test("isShadowed is the only reader — bare names, no leading slash", () => {
  for (const name of RESERVED_SLASH_COMMANDS) {
    expect(name.startsWith("/")).toBe(false);
    expect(isShadowed(name)).toBe(true);
  }
});
