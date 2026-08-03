import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every relative import inside `pi-runtime/extensions/` must resolve on disk.
 *
 * WHY THIS EXISTS. `npm run build` does NOT typecheck the bridge.
 * `tsconfig.node.json`'s `include` lists six hand-picked extension modules
 * (hv-rules, hv-context, hv-agents, hv-ask-user, hv-plan, hv-builtins) —
 * `happyvibe-bridge.ts` itself is not one of them, and neither are hv-skills,
 * hv-mcp, hv-agents-md or hv-commands. They cannot simply be added: the bridge
 * has a pre-existing overload error and the vendored pi-subagents sources it
 * reaches produce a dozen more.
 *
 * So a renamed or deleted extension module fails NOWHERE at build time. It
 * fails at extension LOAD, which in RPC mode means the app silently loses its
 * whole permission layer at spawn — the exact class of failure the resource
 * gate's contract test exists to make loud (docs/validation/sk1.md).
 *
 * This is the cheap substitute: a few ms of readdir + existsSync that turns a
 * broken import into a red test instead of a dead app. Same technique as
 * `tests/commands-reserved.test.ts`, which already reads the bridge off disk.
 */

const EXT_DIR = path.join(__dirname, "..", "pi-runtime", "extensions");

/** `from "./x"` / `from "../y"` — the specifiers Node must resolve at load. */
const RELATIVE_IMPORT = /from\s+"(\.\.?\/[^"]+)"/g;

describe("pi-runtime/extensions relative imports", () => {
  const files = fs.readdirSync(EXT_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the extension sources (guards against an empty sweep)", () => {
    expect(files).toContain("happyvibe-bridge.ts");
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} — every relative import resolves`, () => {
      const src = fs.readFileSync(path.join(EXT_DIR, file), "utf8");
      const specs = [...src.matchAll(RELATIVE_IMPORT)].map((m) => m[1]);
      for (const spec of specs) {
        const base = path.join(EXT_DIR, spec);
        // A specifier may be written with or without its extension, and the
        // pi-subagents reaches are `.ts` paths into node_modules (deliberate —
        // see the bridge's import comment).
        const resolved = [base, `${base}.ts`, path.join(base, "index.ts")].some((p) =>
          fs.existsSync(p),
        );
        expect(resolved, `${file} imports "${spec}" which does not exist on disk`).toBe(true);
      }
    });
  }
});
