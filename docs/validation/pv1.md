# pv1 — Pi's provider registry, measured (2026-08-29)

Evidence behind the "Support more providers" round: what `pi-ai` actually declares, how the
generator reads it, and which of the audit's assumptions were wrong. Re-run the commands here
after any Pi pin bump — `tests/provider-catalog.test.ts` gates the same facts automatically, but
this is where to look when it goes red.

Pin at time of measurement: `@earendil-works/pi-coding-agent` 0.83.

## Where pi-ai actually lives

The audit (and the first draft of the plan) assumed a top-level `pi-runtime/node_modules/pi-ai`.
There is no such directory. pi-ai is a **nested, scoped** dependency of pi-coding-agent:

```
pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/
```

`tools/provider-catalog/build.ts` reaches it by that relative path and **exits non-zero with the
path in the message** when it is missing, because the common cause is a fresh worktree that never
ran `(cd pi-runtime && npm ci)`.

## The registry: one entry point, everything structured

`dist/providers/all.js` exports `builtinProviders()` → **40 provider objects** (39 have model
catalogs; `radius` has none). Each is:

```js
{ id, name, baseUrl, headers, auth: { apiKey?, oauth? }, getModels(), stream, ... }
```

`name` is a real display label — "Kimi For Coding", "OpenCode Zen", "Hugging Face", "Z.AI". The
plan had budgeted a label prettifier (title-case + regional-suffix mapping); it was **deleted
unwritten**. Upstream's labels are better than anything derived from the id, and using them means
a renamed provider follows the pin instead of drifting.

Two neighbouring exports are traps: `getBuiltinProviders()` returns provider **id strings**, not
objects, and `builtinProviders` is a **function**, not an array — reading either as the other
yields `{0:"a",1:"m",...}` from a string, which is how this was first misread.

## Reading the env vars WITHOUT parsing source

`env-api-keys.js` does export `findEnvKeys` / `getEnvApiKey`, but the `envMap` the audit quoted is
a **local const inside `getApiKeyEnvVars`, which is not exported**. Regex-parsing dist output would
have been the obvious fallback and would rot silently.

The supported route instead: `envApiKeyAuth(name, envVars)` closes over the list and its `resolve`
calls `ctx.env(envVar)` once per candidate, in order. So a **recording ctx** reads the real list
off the real implementation:

```js
const asked = [];
await provider.auth.apiKey.resolve({
  ctx: { env: async (n) => { asked.push(n); return undefined; } },
  credential: undefined,
  signal: { throwIfAborted() {}, aborted: false },
});
```

Returning `undefined` matters: a truthy value short-circuits the loop after the first candidate,
which is what made an earlier Proxy-based attempt report `amazon-bedrock` as single-key (it
answered `AWS_PROFILE` and stopped). With `undefined` it reports all six.

`google-vertex` throws mid-probe (`ctx.fileExists is not a function`, its ambient-ADC check).
The generator and the test both swallow it — whatever it recorded before throwing already
classifies it as multi-var.

## Derived exclusions — what the shape tells you

Every provider HappyVibe does not offer as a one-key setup is excluded by a property upstream
declares, not by a name in a list. The generator prints this histogram on every run:

| Excluded | Derived reason |
| --- | --- |
| `openai-codex` | declares no `auth.apiKey` at all |
| `radius` | ships no model catalog (0 models) |
| `amazon-bedrock` (6 vars), `cloudflare-ai-gateway` (3), `cloudflare-workers-ai` (2), `google-vertex` (2) | more than one env var — the multi-field cloud class the PRD defers |
| `azure-openai-responses` | no base URL anywhere, provider-level or per-model (needs a resource/deployment URL) |
| `github-copilot` | **the only hand-written exclusion**, and a product decision: it is an OAuth provider here, and asking a beginner for a GitHub token is the rung sign-in exists to replace |

`anthropic` is the one pinned exception in the other direction: it declares three env vars
(`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`) because it also accepts
OAuth, so the >1-var rule would have dropped one of the featured five. It is pinned to
`ANTHROPIC_API_KEY`, which is what its key input has always meant.

A base URL containing `{placeholders}` (`https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/…`,
`https://{location}-aiplatform.googleapis.com`) is also rejected — it is not a URL anything can call.

## Providers that SHARE one env var

Not anticipated by the audit, and the reason catalog rows are keyed by env var rather than by
provider id:

| Env var | Provider ids |
| --- | --- |
| `MOONSHOT_API_KEY` | `moonshotai`, `moonshotai-cn` |
| `OPENCODE_API_KEY` | `opencode`, `opencode-go` |
| `QWEN_TOKEN_PLAN_API_KEY` | `qwen-token-plan`, `qwen-token-plan-individual` |
| `CLOUDFLARE_API_KEY` | `cloudflare-ai-gateway`, `cloudflare-workers-ai` (both excluded anyway) |

This is not cosmetic. `buildProviderEnv` writes one env var per row and `keySource` reads one per
row, so two rows over one variable would make a single key look like two, and report a key
configured for a provider the user never touched. They collapse to one row (canonical id =
shortest, then alphabetical) that keeps every id it unlocks in `providerIds`; Pi still offers both
catalogs once the key is set.

Note `zai` / `zai-coding-cn` do **not** share (`ZAI_API_KEY` vs `ZAI_CODING_CN_API_KEY`), so they
stay two rows — which is the shape the "plain rows, no region picker" decision wanted anyway.

## OAuth flows

`dist/auth/oauth/` ships seven: anthropic, github-copilot, kimi-coding, openai-codex, openrouter,
radius, xai. A provider advertises one by declaring `auth.oauth` (`lazyOAuth`), which also carries
upstream's own `loginLabel` and `isSubscription`.

Offered: **all six** in `OAUTH_CATALOG` (`radius` falls out on 0 models). `OAUTH_NOT_ENABLED` is
empty by design — it is the mechanism for withholding a flow WITH its reason, and the contract test
asserts every upstream flow is either offered or listed there, so a pin that adds a seventh fails
rather than surfacing a sign-in button nobody reviewed.

`kimi-coding` was initially withheld (it was not in the round's decision) and **enabled on
2026-08-30 at Guilhem's request**. Enabling it was not just a list edit: upstream declares it
`isSubscription: true` AND it accepts `KIMI_API_KEY`, which makes it the **third** provider — after
`anthropic` and `xai` — whose billing cannot be settled from the provider id alone. It therefore
joined `KEY_RESOLVED_PLAN_PROVIDERS`, and that set is now DERIVED from upstream in the contract
test (`isSubscription && auth.apiKey && offered as a key row`), so the next such provider fails the
gate instead of silently reporting a covered subscription's tokens as dollars owed.

**No new flow needed bridge or renderer work**, verified in source rather than assumed:
`hv-login` validates against `runtime.getProviders()` and has no per-provider branches, and the
interaction types all three use are already handled end to end — openrouter emits
`auth_url` + `manual_code` + `progress`, xai and kimi-coding emit `device_code`, and
`AuthFlowModal` already renders all eight stages.

## Result

29 key rows covering 993 models (was 5 covering ~385), plus 6 OAuth flows. Regenerate with
`npm run catalog:providers` and read the run summary — the reject histogram is where a surprise
shows up, exactly as it does for the plugin catalog (§25).
