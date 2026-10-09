# fk1 — fork / duplicate through a bare one-shot Pi (round 28)

Key-free: `tests/session-fork-contract.test.ts` boots a real Pi with the faux model to write a two-turn session, then forks it with `resolveForkSpawn` + `forkSessionFile`.

## Timings (Pi 1.0.2, macOS, warm)
- `[fk1] fork one-shot: 196 ms`
- `[fk1] duplicate one-shot: 214 ms`

## Wire
- `--fork <file>` makes Pi write a full copy at start. `get_state.sessionFile` is the COPY (new id, new file in `--session-dir`), never the source.
- RPC `fork {entryId}` replies `{ text: "<the message forked before>", cancelled: false }`.
- `get_state.sessionFile` after `fork` is a THIRD file: the branch holding history up to (not including) that user message.
- The fork's header: `{type:"session", version:3, id:<new>, cwd:<process cwd>, parentSession:<the intermediate copy>}`. `parentSession` names the copy we then delete. Harmless: it is top level, `twChildren` only scans `subagents/`, and HappyVibe's link is `SessionMeta.forkedFrom`.
- A duplicate keeps every conversational entry id; only the header id is new.
- A live user-role `message_end` over RPC carries `message.timestamp`, equal to the file entry's `message.timestamp` (the `piTs` key, `userEntryAt`).
- Header `cwd` is stamped from the process cwd, so `resolveForkSpawn` takes the source session's root.
