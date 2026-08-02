# TC1 — Forcing a tool call: `toolChoice` is present, typed, and silently discarded

**Verified:** 2026-08-02 against the vendored tree at `@earendil-works/pi-coding-agent@0.83.0`
(single `pi-ai@0.83.0`, nested at `pi-coding-agent/node_modules/@earendil-works/pi-ai`).

## Why this doc exists

The live-Pi suite's dominant failure mode is **class A**: the model finishes its turn in prose
instead of emitting a `tool_call`, and the assertion reads
`model never called bash across 3 attempts`. `tests/reask.ts` `askUntil` re-asks 3×, which costs
~136 s and then fails anyway when the provider is drifting.

The obvious fix is to stop asking nicely and *force* the call with the provider's `tool_choice`
parameter. This doc records what happens when you try, because the answer is worse than "not
supported" — **the option exists, is typed, is accepted, and is then dropped on the floor with no
error**. Anyone who investigates this from scratch will conclude it works. It does not.

## The trap

`pi-coding-agent` only ever calls `streamSimple`, never `stream`. `streamSimple` funnels caller
options through an explicit allowlist, `buildBaseOptions`:

`pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js:10-30`

19 fields survive: `temperature`, `maxTokens`, `signal`, `apiKey`, `fetch`, `transport`,
`cacheRetention`, `sessionId`, `headers`, `onPayload` (:21), `onResponse`, `timeoutMs`,
`websocketConnectTimeoutMs`, `maxRetries`, `maxRetryDelayMs`, `metadata`, `env`.

**`toolChoice` is not among them.** Pass it and it vanishes — no throw, no warning.

It is not an unknown key to `pi-ai`, which is what makes this convincing-looking: `toolChoice` is
a real, typed, per-provider extra (`dist/api/openai-completions.d.ts` and siblings). It simply
never travels through the shared base-options path that the coding agent uses. And the agent
itself never sets it:

```
grep -rc "toolChoice" pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist --include='*.js'
→ zero hits
```

Two other doors are also shut:
- **No CLI flag.** The full list is in `dist/cli/args.js` — 39 flags, nothing tool-choice related.
- **No RPC param.** `prompt`/`steer`/`follow_up` accept only `message`, `images`,
  `streamingBehavior`. None of the RPC commands carries a per-turn options bag, so nothing in
  `spawn.ts`'s spawn shape can be extended to reach it.

## The one route that does work

`onPayload` **is** in the allowlist (:21), and `pi-coding-agent` wires it to an extension hook
whose return value replaces the **raw provider request body** before the HTTP call:

| step | location (0.83.0) |
| --- | --- |
| event declared | `dist/core/extensions/types.d.ts:505` (`type: "before_provider_request"`) |
| handler signature | `dist/core/extensions/types.d.ts:868` |
| implementation | `dist/core/extensions/runner.js:773` (`emitBeforeProviderRequest`) |
| **return replaces payload** | `dist/core/extensions/runner.js:787-789` — `if (handlerResult !== undefined) currentPayload = handlerResult` |
| wired to the provider | `dist/core/sdk.js:200` (`onPayload: async (payload, _model) => …`) |

So a test-only fixture extension registering `before_provider_request` can write `tool_choice`
straight into the body — ~15 lines, no vendor edit, no pin bump.

Sibling hooks exist and are wired the same way: `before_provider_headers`, `after_provider_response`.

## Constraints found in the same read — do not skip these

1. **The hook fails OPEN.** Handler throws are swallowed into `emitError`
   (`runner.js`, the `emitError` path) and the unmodified payload continues. Good for safety,
   bad for testing: **a broken fixture is indistinguishable from a working one** unless the test
   asserts the tool call actually happened. Never assert "the run was green".
2. **Arm per turn, disarm after the first payload.** The hook fires on *every* request in the
   agent loop. Pin `tool_choice` forever and the agent can never emit a final text answer —
   `bridge.test.ts`'s `agent_end` await would hang.
3. **Keep `askUntil` as the fallback.** It costs nothing when the first attempt succeeds and it
   is the safety net if a pin bump moves the hook. Kept, this change cannot make anything worse.

## TC2 — Does DeepSeek honour it? Yes, but ONLY with thinking mode OFF

**Measured 2026-08-02** by direct `POST https://api.deepseek.com/chat/completions` — no Pi in the
loop, so this isolates the provider from everything else. Identical body each time
(`"hi, how are you?"` + a one-tool `bash` schema), varying only `model` / `tool_choice` / `thinking`:

| config | result |
| --- | --- |
| `deepseek-v4-flash`, no `tool_choice` | `finish=stop`, **no tool call** — class A reproduced on demand |
| `deepseek-v4-flash`, `tool_choice:"required"` | **HTTP 400** — `Thinking mode does not support this tool_choice` |
| `deepseek-v4-flash`, `tool_choice:{type:"function",function:{name:"bash"}}` | **HTTP 400** — same |
| `deepseek-v4-flash` + `thinking:{type:"disabled"}`, named | ✅ `finish=tool_calls`, `tools=bash` |
| `deepseek-chat`, named | ✅ same (served as `deepseek-v4-flash` — `deepseek-chat` is the thinking-off alias) |

### What this means for the fixture

**`tool_choice` alone would make things strictly worse.** Every live test spawns with
`--model deepseek-v4-flash`, which has thinking ON by default, so injecting `tool_choice` into the
request body turns a flaky-but-usually-green suite into a **uniformly HTTP 400 red** one. The
`before_provider_request` hook fails open on a *throw*, but a 400 from the provider is not a throw
in the hook — it is a real failed request.

So a working fixture must set **both**:

```js
payload.tool_choice = { type: "function", function: { name: "bash" } };
payload.thinking    = { type: "disabled" };   // REQUIRED — 400 without it
```

### The tradeoff this exposes

Disabling thinking to force the call means the live tests would no longer exercise the model in
the mode **the app actually ships** (`deepseek-v4-flash`, thinking on). We would be trading a real
flake for reduced fidelity: the suite would stop reproducing the exact class-A condition that
bites users. That is a product decision, not a test-infra one — hence not implemented here.

If it is taken, the honest shape is to force the tool **only on the specific turn an assertion
depends on**, leaving the rest of the agent loop in its shipped configuration, and to keep
`askUntil` so the fixture is an optimisation rather than a dependency.

## Related

- `docs/validation/v6.md` — the other "looks supported, isn't in RPC" finding (permission system).
- Notion: *⚠️ Tests flakyness* — the class A/B taxonomy this doc serves.
- `CLAUDE.md` §Tests — the class-A vs boot-race discriminator.
