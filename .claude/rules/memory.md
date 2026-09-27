---
paths:
  - "src/main/memory/**"
  - "pi-runtime/extensions/hv-memory.ts"
  - "src/renderer/src/memoryFact.ts"
  - "src/renderer/src/components/Memory*.tsx"
  - "tests/memory*.test.ts"
---
# Memory (§33)

- The model supplies a NAME, never a path. Main is the one writer (agent envelopes + Memory-page
  edits, one serialized queue in `src/main/memory/store.ts`).
- `MEMORY.md` is GENERATED from the files' frontmatter on every change — nothing writes it by hand, so
  it can't drift and a forgotten memory leaves no dangling pointer.
- Frontmatter is Claude Code's NESTED `metadata: {type, originSessionId, modified}`. A flat `type:`
  is refused on purpose — one format to keep alive, not two.
- The workspace key is the PARENT of `git rev-parse --git-common-dir`, so every worktree of a clone
  shares one memory folder. `gitCommonDir` (git.ts) must `path.resolve(workspace, …)` — git answers
  a RELATIVE `.git` from the main worktree and an ABSOLUTE path from a linked one. It is SYNC on
  purpose: `spawnOpts` is sync, and a forgotten `await` would key a worktree by path silently.
- An ABSENT `HV_MEMORY_*` env var means off: no global dir = memory off; no workspace dir = off for
  that workspace, and the bridge then renders NO workspace block (not an empty one).
- `memorySection` must be named in `before_agent_start`'s return condition — memory can be the only
  thing a turn injects.
- A memory card reads BOTH `card.memory` (restored) and the live result's `details`
  (`memoryFromResult`); test both paths.
- The three tool schemas cost more context than the policy text; the settings panel shows both.
  Wire shapes and measured costs: `docs/validation/d1.md` §33.
