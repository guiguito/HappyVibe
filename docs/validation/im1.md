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
