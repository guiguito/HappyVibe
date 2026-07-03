# HappyVibe Spike — Validation Results (V1–V7)

| Gate | Hypothesis | Result | Date | Notes |
|------|-----------|--------|------|-------|
| — | Pi runtime vendored (0.80.3) | PASS | 2026-07-03 | smoke-pi.mjs prints 0.80.3. **Native DeepSeek support confirmed** (provider `deepseek` + `DEEPSEEK_API_KEY` in cli/args.js & model-registry.js) → no models.json needed. Exact model id verified at V5-core (Task 6). |

| V4 | D1: ctx.ui surfaces over RPC | PASS | 2026-07-03 | Path A confirmed; wire shapes in d1.md. Note: confirm response field is `confirmed: boolean`, not `value`. Extensions must fire confirm async-detached from session_start to allow JSONL reader to attach first. |

| V1 | Spawn & handshake | PASS | 2026-07-03 | Real pinned Pi answers RPC from tests |

| V5-core | Permission round-trip with real model | PASS | 2026-07-03 | Bridge extension gates bash via `ctx.ui.select`; deny blocks tool call (forbidden.txt NOT created); `agent_end` arrives (agent continues gracefully). Model: `deepseek-v4-flash` (provider `deepseek`). Select response field proven: `value: string`. Full select wire shape in d1.md. |

| V6 | Enforcement coexistence | FAIL | 2026-07-03 | pi-permission-system ask prompts do NOT surface over RPC as select ui-requests — only setStatus events arrive. Bridge-only enforcement works (deny blocks). Extensions coexist without crash. PRD impact: pi-permission-system is TUI-only; HappyVibe must own all RPC-mode permission UI via its bridge. see v6.md. **CRITICAL fix (final review):** setStatus/non-select ui-requests reaching renderer's PermissionModal caused `req.options.map is not a function` white-screen crash; fixed by filtering in App.tsx (`if (r.method === "select")`) and adding `options ?? []` belt-and-suspenders in PermissionModal; `method` was already forwarded end-to-end (PiClient emits raw msg); types widened in hv.d.ts + preload. |

| V5 | Permission modal (GUI) | PENDING (manual) | 2026-07-03 | PermissionModal.tsx created; uiReq state + onUiRequest subscription wired in App.tsx. Title parsed defensively (JSON hv.permission → tool+summary; non-JSON → plain text fallback, exercised by Task 13). Options rendered from req.options (not hardcoded). V5-core (headless round-trip) already PASS (Task 6). GUI modal requires manual `npm run dev` validation. |
| V2 | Streaming chat | PENDING (manual) | 2026-07-03 | Code complete: setup/folder/chat screens implemented; text_delta accumulation wired; awaiting manual GUI validation with `npm run dev` |
| V3 | Tool visibility | PENDING (manual) | 2026-07-03 | Code complete: ToolCard.tsx created; Transcript.tsx widened; tool_execution_start/end branches wired in App.tsx. Field names (`toolCallId`, `toolName`, `args`, `result`, `isError`) derived from `pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`. Awaiting manual GUI validation (`npm run dev`, prompt that triggers tool calls). |

| V7 | True embedding | PARTIAL (headless) | 2026-07-03 | `npm run package` produced unsigned `release/mac-arm64/HappyVibe Spike.app`. Bundle structure confirmed: `Contents/Resources/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` PRESENT. Bundled-runtime smoke test (`ELECTRON_RUN_AS_NODE=1 "<MacOS binary>" "<bundled cli.js>" --version </dev/null`) printed `0.80.3` — embedding proven. Interactive GUI demo (streaming, permission modal) PENDING manual validation. |

## Bring-up findings

- **Pi CLI one-shot invocations hang if stdin stays open** (TTY-read behavior). All non-RPC invocations (`--version`, `--list-models`) MUST use `stdin: "ignore"` / `</dev/null`. RPC mode is unaffected (we own the stdin pipe). smoke-pi.mjs uses `stdio: ["ignore","pipe","pipe"]`.
- `pi --list-models` shows only *configured* models ("No models available" without a key) — it is NOT a catalog dump. Native provider support is confirmed via the built-in model registry instead.
