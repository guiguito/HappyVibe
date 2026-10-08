# im1 — Pi's image price estimate vs OpenRouter's charge (round 27, 2026-10-08)

Pi 1.0.2 (pi-ai nested copy). One paid image per model, same prompt
("A flat app icon of a smiling sun, simple shapes."), through pi-ai's own
`generateImages` — the exact path `ctx.modelRegistry.generateImages()` takes.

```
set -a; . ./.env; set +a
node tools/image-cost-check.mjs google/gemini-3.1-flash-lite-image
node tools/image-cost-check.mjs google/gemini-2.5-flash-image
```

| Model | Pi estimate (`usage.cost.total`) | OpenRouter charged (`usage.cost` in the response) | Ratio |
|---|---|---|---|
| `google/gemini-3.1-flash-lite-image` | $0.001683 (12 in / 1120 out tokens) | $0.03326697 | 0.051 |
| `google/gemini-2.5-flash-image` | $0.0032561 | $0.038343789 | 0.085 |

**Why:** Pi's catalogue prices an image's output tokens at the model's TEXT output rate
($1.50/M, $2.50/M); OpenRouter bills image output tokens at the image rate (≈$30/M).
So even the 14 "fully priced" models are under-estimated by 12–20×.

**How it was read:** OpenRouter returns its own charge in the response body's
`usage.cost`; pi-ai's `parseUsage` (api/openrouter-images.js) drops it. The script
passes a wrapped `fetch` to `generateImages` and reads it off the same response.
`GET /api/v1/generation?id=…` answered 404 for these requests for over a minute —
not usable.

**Verdict: STOP (plan Task 7).** The ratio is far outside 0.5–2. Showing Pi's number
would understate every image ~15×, which §19 ruling 3 forbids. Decision needed before
Task 8.

## Which models work through Pi at all (2026-10-08)

Pi's image call always uses OpenRouter's `chat/completions`; some image models only serve the
separate image endpoint and answer `404 … cannot be used with the chat/completions endpoint`
(free). Nothing in Pi's catalogue or OpenRouter's `/models` / `/endpoints` metadata tells them
apart, so `tools/image-model-probe.mjs` made one image per model at its default size and wrote
`tools/provider-catalog/image-probe.json`. Spent: **$3.59**.

- **ok — 39:** FLUX.2 (flex, klein-4b, max, pro), Seedream (4.5, 5.0 flash/lite/pro), Gemini image
  (6), Microsoft MAI (4), OpenAI `gpt-5-image`, `gpt-5-image-mini`, `gpt-5.4-image-2`, Recraft
  (v3, v4, v4.1 and their pro/vector/utility variants — 13), Riverflow (4), Grok Imagine (2).
- **wrong endpoint — 14:** `black-forest-labs/flux-3-image`, inclusionAI (2), Krea (3), Meta muse,
  OpenAI `gpt-image-1`, `-1-mini`, `-2`, `-2.5-flare`, `-2.5-sunburst`, Qwen (2). Five of these
  were in the first, price-based list — it would have offered models that cannot work.
- **failed — 4:** Recraft `v4-styles*`: "style references are required".
- Size: OpenRouter's smallest `image_config` size ("1K") cost MORE than the default on
  FLUX.2 Klein ($0.0168 vs $0.0139), so the probe uses the default size.
- Cheapest measured: `recraft/recraft-v4.1-flash` $0.0069; dearest: `recraft/recraft-v4-pro-vector`
  $0.297. These are single samples — the picker says "about".
