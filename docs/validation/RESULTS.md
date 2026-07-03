# HappyVibe Spike — Validation Results (V1–V7)

| Gate | Hypothesis | Result | Date | Notes |
|------|-----------|--------|------|-------|
| — | Pi runtime vendored (0.80.3) | PASS | 2026-07-03 | smoke-pi.mjs prints 0.80.3. **Native DeepSeek support confirmed** (provider `deepseek` + `DEEPSEEK_API_KEY` in cli/args.js & model-registry.js) → no models.json needed. Exact model id verified at V5-core (Task 6). |

| V4 | D1: ctx.ui surfaces over RPC | PASS | 2026-07-03 | Path A confirmed; wire shapes in d1.md. Note: confirm response field is `confirmed: boolean`, not `value`. Extensions must fire confirm async-detached from session_start to allow JSONL reader to attach first. |

| V1 | Spawn & handshake | PASS | 2026-07-03 | Real pinned Pi answers RPC from tests |

| V5-core | Permission round-trip with real model | PASS | 2026-07-03 | Bridge extension gates bash via `ctx.ui.select`; deny blocks tool call (forbidden.txt NOT created); `agent_end` arrives (agent continues gracefully). Model: `deepseek-v4-flash` (provider `deepseek`). Select response field proven: `value: string`. Full select wire shape in d1.md. |

| V2 | Streaming chat | PENDING (manual) | 2026-07-03 | Code complete: setup/folder/chat screens implemented; text_delta accumulation wired; awaiting manual GUI validation with `npm run dev` |

## Bring-up findings

- **Pi CLI one-shot invocations hang if stdin stays open** (TTY-read behavior). All non-RPC invocations (`--version`, `--list-models`) MUST use `stdin: "ignore"` / `</dev/null`. RPC mode is unaffected (we own the stdin pipe). smoke-pi.mjs uses `stdio: ["ignore","pipe","pipe"]`.
- `pi --list-models` shows only *configured* models ("No models available" without a key) — it is NOT a catalog dump. Native provider support is confirmed via the built-in model registry instead.
