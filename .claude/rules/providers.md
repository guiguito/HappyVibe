---
paths:
  - "src/main/{providers,providerCatalog.generated,calls,modelsJson,thinking}.ts"
  - "tools/provider-catalog/**"
  - "src/renderer/src/{modelPrice,providerError}.ts"
  - "src/renderer/src/components/{ModelsView,ModelSelect,AuthFlowModal}.tsx"
  - "tests/{provider,providers,live-model}*.test.ts"
  - "tests/liveModel.ts"
  - "scripts/patch-pi-oauth-page.mjs"
  - "tests/pi-oauth-page-patch.test.ts"
---
# Providers and the BYOK catalog

- The provider list is GENERATED from Pi's registry (`builtinProviders()`) by
  `npm run catalog:providers`; `BYOK_PROVIDERS`/`BYOK_PROVIDER_IDS`/`OAUTH_PROVIDERS` are views over
  it. `tests/provider-catalog.test.ts` RE-DERIVES it from the vendored tree, so a bump that adds a
  provider fails there instead of drifting.
- pi-ai is a NESTED scoped dep:
  `pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/` —
  since Pi 1.0.1 dropped its shrinkwrap, because tintinweb's open peer range (`>=0.84.0`) keeps a
  stale top-level pi-ai from the lockfile (extensions never see that copy; Pi serves its embedded
  one). Never `npm dedupe` pi-runtime to "fix" it: dedupe hoists the NEWEST matching pi-ai (1.0.3
  under Pi 1.0.2, measured 2026-10-05) — a silent runtime change behind the pin. If the nested
  copy ever disappears, the generator plus `provider-catalog` / `cache-retention` tests fail loudly
  at the nested path — repoint them then.
- A new OAuth flow can need the options Pi's own `/login` passes as `login()`'s 4th argument
  (`interactive-mode.js` `loginProvider`); "Sign in with ChatGPT" throws without `getDeviceId`. The
  bridge's `/hv-login` passes the same one — diff the two on a bump. `tests/auth-bridge.test.ts`.
- The page a sign-in lands on is served by the Pi child on localhost: the redirect URL is the
  provider's (fixed), the HTML is Pi's, with no setting. `scripts/patch-pi-oauth-page.mjs` (owned
  patch) gives it our icon, derived from `build/icon.svg`, and a "…and return to HappyVibe." success
  line, in every bundle chunk that inlines the page — FOUND by scanning for `var LOGO_SVG=`, because
  one chunk name is hashed. It also sets ChatGPT's `AGENT_NAME_HINT` to "HappyVibe" — the name on
  OpenAI's consent screen; the robot icon there is OpenAI's, not settable. A bump that rewords any of
  them fails the install: re-derive `PI_LOGO` / `PI_SUCCESS` / the hint anchor. A new `build/icon.svg` needs `cd pi-runtime && npm ci`. `tests/pi-oauth-page-patch.test.ts`.
- The env-var map is a local const in a non-exported function — never re-parse it. A RECORDING ctx
  passed to `auth.apiKey.resolve()` reads the candidate list off the real implementation.
- Providers sharing an env var (`moonshotai`/`moonshotai-cn`, `opencode`/`opencode-go`,
  `qwen-token-plan`/`-individual`) collapse to ONE row — the row is what `buildProviderEnv` writes and
  `keySource` reads.
- Every exclusion is DERIVED (no `auth.apiKey`, zero models, >1 env var, no usable base URL). The only
  hand-listed id is `github-copilot` (OAuth-only here); the only pinned env var is `anthropic`'s. A
  derived exclusion can expire on a bump — offering the newly eligible provider is then a product
  decision, not a pin side effect.
- A flow upstream REPLACES goes in `SUPERSEDED_OAUTH` (providers.ts), not `OAUTH_NOT_ENABLED`: it stays in
  `OAUTH_PROVIDERS` (so `knownProviders` still spawns existing sessions and the signed-in row can sign
  out), and both sign-in surfaces filter `superseded`. Today: `openai-codex`, replaced by `openai`.
- `OAUTH_NOT_ENABLED` is empty by design: adding an id withholds a flow WITH its reason; the test fails
  on any flow neither offered nor listed.
- A provider that is BOTH `isSubscription` and `auth.apiKey` must be in `KEY_RESOLVED_PLAN_PROVIDERS`
  (calls.ts), or §19 reports a covered subscription's tokens as dollars owed. The test derives that
  set from upstream's flags.
- `buildProviderEnv` and `keySource` treat any `sk-REPLACE*` env value as absent, for EVERY catalog
  row — `tests/providers.test.ts` asserts it per row, so the non-live suite's placeholder can never
  reach a spawned Pi as a real key.
- Live-test model resolution lives only in `tests/liveModel.ts` (resolver pinned by
  `tests/live-model.test.ts`). A bogus OpenRouter key returns `401 User not found`, which proves the
  route independently of any balance.
