---
paths:
  - "tsconfig*.json"
  - "scripts/typecheck-ext.mjs"
  - ".oxlintrc.json"
  - "tests/extensions-typecheck.test.ts"
---
# TypeScript 7 and the typechecks

- The typecheck runs on TypeScript 7, the native compiler. TS 7 REMOVED `baseUrl`, so every `paths`
  entry is `./`-relative to its own tsconfig. Never re-add `baseUrl`, never set `ignoreDeprecations`
  — a deprecation is the work list, not noise. `typecheck:node`/`typecheck:web` pass
  `--composite false`, which overrides a `composite: true` config; don't hand-roll the raw `tsc` calls.
- `require("typescript")` does NOT throw at 7.x: it resolves to `lib/version.cjs` and exports only
  `version`/`versionMajorMinor` — every compiler function is `undefined`. A version probe succeeds
  and the failure lands at the first real call.
- Lint is **oxlint**, not ESLint: typescript-eslint throws *"does not support TS 7.0"* before linting
  a file, and a second TypeScript 6 install just for it was refused (the gate is the only consumer of
  `typescript`). oxlint is written in Rust and never loads TypeScript, so TS 7 is a non-issue. Pinned
  EXACT — a linter's rule set changes between versions, and a loose range lets the gate go red on its
  own. Bump it deliberately, like a pin, and fix or exempt what the new version flags.
- All of `pi-runtime/extensions/` is typechecked by `tsconfig.extensions.json` (standalone `--noEmit`,
  not referenced from the root tsconfig). Load-bearing knobs: `allowImportingTsExtensions` (explicit
  `.ts` imports), `noUnusedLocals/Parameters` off (vendored raw `.ts`), and `paths` mapping the NESTED
  `pi-ai`/`pi-agent-core` under `pi-coding-agent/node_modules/`. `tests/extensions-typecheck.test.ts`
  pins the whole-directory include and the chain wiring.
- `npm run typecheck:ext` is `node scripts/typecheck-ext.mjs`: it PRINTS every diagnostic from
  vendored code (tintinweb's raw `.ts` arrives via relative import) with a count, and exits non-zero
  only for `pi-runtime/extensions/`. A prefix-less compiler error (e.g. `error TS5058:` from a broken
  config) names no path and always fails. A `paths` shim can't silence vendored files — they arrive
  through RELATIVE imports. A renamed nested dep shows as `TS2307` naming the specifier: fix OUR
  config first.
