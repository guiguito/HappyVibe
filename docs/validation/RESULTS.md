# HappyVibe Spike — Validation Results (V1–V7)

| Gate | Hypothesis | Result | Date | Notes |
|------|-----------|--------|------|-------|
| — | Pi runtime vendored (0.80.3) | PASS | 2026-07-03 | smoke-pi.mjs prints 0.80.3. **Native DeepSeek support confirmed** (provider `deepseek` + `DEEPSEEK_API_KEY` in cli/args.js & model-registry.js) → no models.json needed. Exact model id verified at V5-core (Task 6). |

## Bring-up findings

- **Pi CLI one-shot invocations hang if stdin stays open** (TTY-read behavior). All non-RPC invocations (`--version`, `--list-models`) MUST use `stdin: "ignore"` / `</dev/null`. RPC mode is unaffected (we own the stdin pipe). smoke-pi.mjs uses `stdio: ["ignore","pipe","pipe"]`.
- `pi --list-models` shows only *configured* models ("No models available" without a key) — it is NOT a catalog dump. Native provider support is confirmed via the built-in model registry instead.
