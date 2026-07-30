# Rewind with file rollback — design

*Locked 2026-07-30. Mirror of the Notion proposal "Rewind with file rollback"
(under the Happyibe page). PRD: §6 V1 list, §9 (round-7 decision), §11, §23.*

## 1. What ships

Today's rewind is chat-only (`App.tsx` `rewindTo`, `ChatView` confirm dialog): it
truncates the transcript at a user message, drops the matching tail from Pi's
context, and returns the message to the composer. The dialog states truthfully
that files on disk are not rolled back.

This completes it. Rewinding a user message offers three scopes:

| scope | effect |
| --- | --- |
| Conversation only | today's behaviour — the **default** |
| Conversation + files | today's behaviour, plus the workspace is restored to its state before that message |
| Files only | the workspace is restored; the conversation is untouched |

The confirm dialog names the files that would change before the user commits.

Plan Mode's Implement takes a labelled snapshot, and the PlanCard gains
**Revert implementation** — closing the post-V1 pointer that §23 had deferred.

## 2. Why native rather than a vendored extension

Three published Pi extensions were read at source level first.

| | `@ayulab/pi-rewind` 0.4.6 | `pi-chrono` 0.3.2 | `pi-rewind` 0.5.0 (arpagon) |
| --- | --- | --- | --- |
| Licence | **GPL-3.0** | MIT | MIT |
| Restore UX over RPC | **dead** (`ctx.ui.custom` → `undefined`) | viable | viable |
| User's git polluted | no (shadow bare repo) | no git at all | **yes** (commits, refs, `reset --hard`) |
| Non-git workspace | works | works | **inert** |
| Conversation restore | own tree hooks | `ctx.fork` → **new session id** | `navigateTree` → same file |
| Scope choice | partial | **none** | explicit 3-way |

Disqualifiers: `@ayulab/pi-rewind` is GPL-3.0 (and bundles its GPL-3.0
`pi-checkpoint` dependency inside its own tarball), and its picker is a silent
no-op under RPC — pinned Pi 0.80.10 defines `async custom() { return undefined }`,
so the handler bails, the same class of finding as V6. `pi-chrono`'s `ctx.fork`
mints a new session file and id, colliding with respawn-resume. `pi-rewind`
writes into the user's own repository and does nothing outside git.

Taken as design influence, not code: the three-way scope choice and the
safety-snapshot discipline (arpagon), the git-free content-addressed store
(chrono).

## 3. Mechanism

### Snapshot

A snapshot is a **manifest** (`path → sha256`) plus the blobs it references,
taken **once per user prompt**, covering the **whole workspace**.

*Per prompt, not per tool call* — the rewind anchor is a user message, and the
completed-turn gate forbids mid-turn removal, so finer resolution is
unreachable.

*Whole workspace, not just declared paths* — this is what makes coverage honest.
`bash` and MCP side effects are included without attribution, so there is no
"we could not restore this" gap. It also makes restore simpler: a full manifest
is a self-contained description of state, so restore is
`diff(manifest, disk) → write differences, delete extras`, with no backwards
walk over a span.

Cost is one directory walk plus a stat per file per prompt; a file is hashed
only when its mtime or size moved. When the resulting manifest is identical to
the previous one, no snapshot is stored — read-only turns are free.

### Keying

Main takes the snapshot in `hv:prompt-session` (the single user-prompt entry
point; every other `type:"prompt"` main sends is an internal `/hv-*` command)
and stamps it with the **first `toolCallId` of the turn that follows**, observed
off the Pi event stream main already consumes.

`toolCallId` is the only identifier durable across a reload — renderer
transcript ids are a per-mount counter that renumbers. The existing `rewindTo`
already collects exactly the set of `toolCallId`s in the rewound tail, so
restore is "the earliest snapshot whose stamp is in that set".

This is correct by construction: a file can only change via a tool call, so a
turn with no tool calls has nothing to restore, and the next stamped snapshot
still describes the state at the anchor.

Steered messages (`behavior === "steer"`) join an in-flight turn and do **not**
snapshot; rewinding to one falls back to the snapshot of the turn it joined,
which restores more rather than less.

### No bridge changes

The feature is main + renderer only. Nothing in `pi-runtime/` is touched, so
there is no new bridge surface, no exposure on a Pi pin bump, and no live-Pi
tests in the gate.

### Restore

Human-only and audited (`who:"human"`). There is no rewind tool the model can
call — this mirrors §23's security invariant that only humans make
power-granting transitions.

A **safety snapshot** is taken before every restore, as an internal guard
against a botched restore. It is not surfaced as an Undo button.

Every file is **stale-checked**: restore touches a path only if its current
hash still matches what the agent's turn produced. A file changed since — by a
parallel session in the same workspace, by the user in the built-in editor, or
externally — is **skipped and named in the result**. This is what makes parallel
sessions safe without a cross-session lock, and it covers the more common case
of the user's own edits. A parallel session that writes after our restore simply
wins, which is correct: its conversation still believes it made that edit.

### Storage

Content-addressed blobs and manifests under
`<userData>/snapshots/<sessionId>/`. Deleted with the session, exactly as the
Pi session file is. A per-session cap bounds growth.

Exclusions reuse `isVisibleEntry` — the same ignore list the file tree and the
watcher share (`node_modules`, `.git`, `.pi-subagents`, and dotfiles outside
`.pi`/`.github`/`.agents`) — extended with common build outputs (`dist`,
`build`, `.next`, `target`, `venv`, `__pycache__`) in a snapshot-local list,
**not** by widening the shared one, which would change what the tree shows.

Two invariants:

- An excluded path is outside the manifest **and** outside restore, so restore
  can never delete a build directory.
- Symlinks are **skipped**, never followed — reading through one would escape
  workspace confinement.

Files over `MAX_FILE_BYTES` are recorded as *not captured* rather than dropped
silently. Edits outside the workspace root (§10 permits them after an ask
prompt) are **never captured and therefore never restored** — the walk starts at
the workspace root, and restoring outside it would mean writing past
`resolveInWorkspace`. They are not individually *reported* either: knowing an
out-of-workspace edit happened would require the bridge to hand us tool paths,
which this design deliberately avoids.

Known ceiling: blobs deduplicate, manifests do not (~300 KB per snapshot on a
5k-file project). Bounded by the per-session cap and deletion-with-session;
delta manifests are the named upgrade path.

## 4. Out of scope

- A visible redo stack / "undo this rewind".
- Rewinding to a point inside a turn.
- Restoring edits outside the workspace root.
- Delta-encoded manifests.
- Any git integration.

## 5. Testing

Unit coverage for manifest build, diff, stale-check, and retention; main-side
coverage for path confinement; renderer coverage for the three-scope dialog.
There is currently **no test at all** for the existing conversation-rewind path
— this work adds the first.

No live-Pi tests are required: nothing in `pi-runtime/extensions/` or
`src/main/pi/` changes.
