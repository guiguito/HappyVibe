# Commands (prompt templates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship user-authored `/slash` commands (Pi prompt templates) as a visible, reviewable, gated HappyVibe surface in both global and workspace scopes — plus a transcript card that makes an expansion honest.

**Architecture:** A near-clone of the §14 skills subsystem in `src/main/commands/`, one axis simpler (a command is one `.md` file, not a directory). Enforcement is spawn-time only: `--no-prompt-templates` (already passed unconditionally) plus one `--prompt-template <file>` per approved command. The bridge is **not** involved in gating — its only job is correlating `input` (original text) with `before_agent_start` (expanded text) so the renderer can draw a command card that survives a reload.

**Tech Stack:** TypeScript, Electron main/renderer, vitest, vendored Pi 0.83.0.

## Global Constraints

- PRD §24 is the source of truth. Do not re-litigate its decisions.
- Approval is **per file**, never per directory.
- `.claude/commands` is **read in place, never copied** — global via a linked dir, workspace as a second scan root.
- Every fs writer must be path-confined (pattern: `agentsMd.ts` / `files.ts` `resolveInWorkspace`).
- Pure modules (`discovery`, `registry`, `view`, `index`, `remove`) stay electron-free and vitest-importable.
- Never pipe a test run to `tail`/`grep`. Redirect once: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"`.
- Full gate is `npm run gate` (build runs both typechecks first — never run `npm run typecheck` before it).
- New Pi-facing behaviour goes in `docs/validation/`; wire shapes go in `docs/validation/d1.md`.

---

### Task 1: Command discovery + single-file hashing

**Files:**
- Create: `src/main/commands/discovery.ts`
- Test: `tests/commands-discovery.test.ts`

**Interfaces:**
- Produces: `CommandSource = "managed" | "workspace" | "linked" | "bundled" | "claude"`; `DiscoveredCommand { id, name, description, argumentHint, source, hash, body, hasBashInjection, estTokens: {body} }`; `parseCommandFrontmatter(content)`, `hashCommandFile(file)`, `readCommandFile(file, source)`, `scanCommandsDir(root, source)`.

Mirror `src/main/skills/discovery.ts` with these deliberate differences, all from PRD §24:

- `id` is the absolute **file** path (the `--prompt-template` arg and the approval key).
- `name` is `basename(file, ".md")` — Pi has no frontmatter `name` key (`core/prompt-templates.js:85`).
- Frontmatter keys are exactly `description` and `argument-hint`. Reuse the skills frontmatter regex approach.
- `description` falls back to Pi's own rule when absent: first non-empty **body** line, truncated to 60 chars + `"..."` (`core/prompt-templates.js:88-96`). There is therefore **no `loadable` flag and no `error` status** — every readable `.md` loads.
- `hasBashInjection` = body matches ``/!`/`` — the CC feature Pi silently drops.
- `scanCommandsDir` is a **flat, non-recursive** `*.md` read (matching Pi's own non-recursive prompt discovery), skipping dotfiles and `node_modules`. A missing root yields `[]`.
- `estTokens` is `{ body }` only — there is no per-turn card cost, since commands never enter the system prompt.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseCommandFrontmatter, readCommandFile, scanCommandsDir, hashCommandFile } from "../src/main/commands/discovery";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-"));

describe("command discovery", () => {
  it("reads frontmatter and derives the name from the filename", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "review.md"), `---\ndescription: Review the diff\nargument-hint: "[path]"\n---\nReview $1.\n`);
    const [c] = scanCommandsDir(d, "managed");
    expect(c.name).toBe("review");
    expect(c.description).toBe("Review the diff");
    expect(c.argumentHint).toBe("[path]");
    expect(c.id).toBe(path.join(d, "review.md"));
  });

  it("falls back to the first body line, truncated to 60 chars, like Pi does", () => {
    const d = tmp();
    const long = "x".repeat(80);
    fs.writeFileSync(path.join(d, "nodesc.md"), `${long}\nmore\n`);
    const [c] = scanCommandsDir(d, "managed");
    expect(c.description).toBe("x".repeat(60) + "...");
  });

  it("flags inline bash injection, which Pi does not support", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "a.md"), "Context: !`git status`\n");
    fs.writeFileSync(path.join(d, "b.md"), "No injection here\n");
    const byName = Object.fromEntries(scanCommandsDir(d, "managed").map((c) => [c.name, c]));
    expect(byName.a.hasBashInjection).toBe(true);
    expect(byName.b.hasBashInjection).toBe(false);
  });

  it("does not recurse, and ignores non-markdown and dotfiles", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "nested"));
    fs.writeFileSync(path.join(d, "nested", "deep.md"), "deep\n");
    fs.writeFileSync(path.join(d, ".hidden.md"), "hidden\n");
    fs.writeFileSync(path.join(d, "notes.txt"), "nope\n");
    fs.writeFileSync(path.join(d, "top.md"), "top\n");
    expect(scanCommandsDir(d, "managed").map((c) => c.name)).toEqual(["top"]);
  });

  it("hash changes when the file content changes", () => {
    const d = tmp();
    const f = path.join(d, "c.md");
    fs.writeFileSync(f, "one\n");
    const h1 = hashCommandFile(f);
    fs.writeFileSync(f, "two\n");
    expect(hashCommandFile(f)).not.toBe(h1);
  });

  it("returns [] for a missing root", () => {
    expect(scanCommandsDir("/nope/does/not/exist", "workspace")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/commands-discovery.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: FAIL — cannot resolve `../src/main/commands/discovery`.

- [ ] **Step 3: Implement `src/main/commands/discovery.ts`**

Follow `src/main/skills/discovery.ts` for style and comment density. Header comment must state that this mirrors skills discovery and name the three dropped concepts (directory walk, `scriptCount`, `loadable`) with the reason for each.

- [ ] **Step 4: Run the test and watch it pass**

```
L=/tmp/vitest.log; npx vitest run tests/commands-discovery.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 5: Commit**

```bash
git add src/main/commands/discovery.ts tests/commands-discovery.test.ts
git commit -m "feat(commands): discover prompt templates as single-file resources"
```

---

### Task 2: Approval registry + resolveActiveCommands

**Files:**
- Create: `src/main/commands/registry.ts`
- Test: `tests/commands-registry.test.ts`

**Interfaces:**
- Consumes: `DiscoveredCommand` from Task 1.
- Produces: `CommandProvenance` (same shape as `SkillProvenance`), `CommandRecord { id, hash, enabled, approvedAt, provenance?, snapshot?: { body: string } }`, `class CommandRegistry` with `record`, `approvalStatus`, `approve`, `setEnabled`, `forget`; `resolveActiveCommands(discovered, registry, activation): string[]`.

A direct port of `src/main/skills/registry.ts`. Two differences: `snapshot` holds `{ body }` rather than `{ skillMd, files }`, and `resolveActiveCommands` has **no `loadable` guard** (Task 1 removed the concept) — it filters on approved ∩ enabled ∩ active-for-workspace only.

- [ ] **Step 1: Write the failing test** covering: approve then `approvalStatus === "approved"`; content change flips it to `needs-review`; `setEnabled(false)` keeps trust; `forget` tombstones; `resolveActiveCommands` returns only approved+enabled+active, with activation defaulting to on (opt-out).

```ts
it("activation is opt-out and a disabled command never spawns", () => {
  const reg = new CommandRegistry(path.join(tmp(), "commands.jsonl"));
  const [a, b] = scanCommandsDir(dirWithTwoCommands, "managed");
  reg.approve(a, NOW);
  reg.approve(b, NOW);
  expect(resolveActiveCommands([a, b], reg, undefined)).toEqual([a.id, b.id]);
  expect(resolveActiveCommands([a, b], reg, { [b.id]: false })).toEqual([a.id]);
  reg.setEnabled(a.id, false, NOW);
  expect(resolveActiveCommands([a, b], reg, undefined)).toEqual([b.id]);
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `src/main/commands/registry.ts`.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): approval registry with per-file content hashing`

---

### Task 3: Status view + collision/shadow detection

**Files:**
- Create: `src/main/commands/view.ts`
- Test: `tests/commands-view.test.ts`

**Interfaces:**
- Produces: `CommandStatus = "active" | "disabled" | "needs-review" | "shadowed"`; `CommandView { id, name, description, argumentHint, source, status, hasBashInjection, estTokens, changed, provenance? }`; `RESERVED_COMMAND_NAMES: Set<string>`; `isShadowed(name)`; `toCommandView(cmd, registry, activation?)`.

`"error"` is replaced by `"shadowed"`: Pi matches extension commands and returns **before** template expansion (`core/agent-session.js:799-806`), so a command whose name collides with a `/hv-*` registration is unreachable no matter how it is approved. `shadowed` outranks every other status.

`RESERVED_COMMAND_NAMES` must be derived from the bridge's actual `registerCommand` calls, not hand-typed — see Task 4's contract test.

- [ ] **Step 1: Write the failing test.**

```ts
it("a name colliding with a bridge command is shadowed, whatever its approval state", () => {
  const cmd = { ...base, name: "hv-plan", id: "/x/hv-plan.md" };
  const reg = approvedRegistryFor(cmd);
  expect(toCommandView(cmd, reg).status).toBe("shadowed");
});

it("changed=true only when a previously approved command's content moved", () => { /* … */ });
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `src/main/commands/view.ts`.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): status view, with shadowed as its own state`

---

### Task 4: Reserved names are derived from the bridge, not guessed

**Files:**
- Modify: `src/main/commands/view.ts`
- Test: `tests/commands-reserved.test.ts`

A hand-maintained reserved list rots the moment someone adds a `/hv-*` command. Derive it by reading `pi-runtime/extensions/happyvibe-bridge.ts` and extracting every `pi.registerCommand("…"` literal, and assert the derived set matches what `view.ts` uses.

- [ ] **Step 1: Write the failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { RESERVED_COMMAND_NAMES } from "../src/main/commands/view";

it("reserved names match every registerCommand in the bridge", () => {
  const src = fs.readFileSync(path.join(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  const found = [...src.matchAll(/pi\.registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(found.length).toBeGreaterThan(10); // guard against the regex silently matching nothing
  expect([...RESERVED_COMMAND_NAMES].sort()).toEqual([...new Set(found)].sort());
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Populate `RESERVED_COMMAND_NAMES` to match.** Add a comment pointing at this test so the next person adding an `/hv-*` command learns why it went red.
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `test(commands): derive reserved names from the bridge so the list cannot rot`

---

### Task 5: Locations, bundled install, and the `.claude` scan roots

**Files:**
- Create: `src/main/commands/index.ts`
- Test: `tests/commands-locations.test.ts`

**Interfaces:**
- Produces: `managedCommandsDir(agentDir)` → `<agentDir>/prompts`; `bundledCommandsDir(runtimeDir)` → `<runtimeDir>/prompts`; `workspaceCommandsDir(ws)` → `<ws>/.agents/prompts`; `claudeCommandsDir(ws)` → `<ws>/.claude/commands`; `discoverGlobalCommands({managedDir, bundledDir, linkedDirs})`; `discoverWorkspaceCommands(ws)`; `installBundledCommands(bundledDir, registry, now)`. Re-exports discovery/registry/view/remove/gitImport.

`discoverWorkspaceCommands` scans **both** `.agents/prompts` (source `workspace`) and `.claude/commands` (source `claude`). `installBundledCommands` is a port of `installBundledSkills`: first sight → approve `enabled:false`; bundle hash bump → re-approve **keeping** the user's on/off; unchanged → skip.

- [ ] **Step 1: Write the failing test** — assert both workspace roots are scanned with distinct sources, and the three bundled-install branches.

```ts
it("scans .agents/prompts and .claude/commands with distinct sources", () => {
  const ws = tmp();
  fs.mkdirSync(path.join(ws, ".agents/prompts"), { recursive: true });
  fs.mkdirSync(path.join(ws, ".claude/commands"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".agents/prompts/mine.md"), "mine\n");
  fs.writeFileSync(path.join(ws, ".claude/commands/team.md"), "team\n");
  const bySource = Object.fromEntries(discoverWorkspaceCommands(ws).map((c) => [c.name, c.source]));
  expect(bySource).toEqual({ mine: "workspace", team: "claude" });
});

it("a bundle bump re-approves but keeps the user's on/off", () => { /* … mirrors tests/skills-bundled.test.ts */ });
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `src/main/commands/index.ts`.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): scopes, including .claude/commands read in place`

---

### Task 6: Removal semantics

**Files:**
- Create: `src/main/commands/remove.ts`
- Test: `tests/commands-delete.test.ts`

Port `src/main/skills/remove.ts`: `planCommandRemoval(view)` returns `{ action: "delete" | "unlink" | "refused", path, reason? }`. Managed/workspace/claude → delete the file (the confirm copy states a `claude` or `workspace` file is typically git-tracked); bundled → refused (the runtime reinstalls it); linked → unlink the directory, never delete. Deletion must be path-confined.

- [ ] **Step 1: Write the failing test** covering all five sources plus a traversal attempt (`../../etc/passwd`) being refused.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `src/main/commands/remove.ts`.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): per-source removal semantics`

---

### Task 7: Spawn flag

**Files:**
- Modify: `src/main/pi/spawn.ts:40-60` (opts doc) and `:128-155` (flags)
- Test: `tests/commands-spawn.test.ts`, and extend `tests/resource-gate-contract.test.ts`

Add `commands?: string[]` to the spawn opts and emit `...(opts.commands ?? []).flatMap((f) => ["--prompt-template", f])` immediately after the `--no-prompt-templates` flag. `--no-prompt-templates` already ships unconditionally — do not touch it.

- [ ] **Step 1: Write the failing test**

```ts
it("passes one --prompt-template per approved command, and always --no-prompt-templates", () => {
  const { args } = resolvePiSpawn({ ...base, commands: ["/a/x.md", "/b/y.md"] });
  expect(args).toContain("--no-prompt-templates");
  expect(args.join(" ")).toContain("--prompt-template /a/x.md");
  expect(args.join(" ")).toContain("--prompt-template /b/y.md");
});

it("still passes --no-prompt-templates when no command is approved", () => {
  const { args } = resolvePiSpawn(base);
  expect(args).toContain("--no-prompt-templates");
  expect(args).not.toContain("--prompt-template");
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the spawn change.**
- [ ] **Step 4: Extend `tests/resource-gate-contract.test.ts`** with a **per-file** arm — the existing test passes a directory; add one asserting a single `--prompt-template <file>` loads exactly that command and no sibling in the same directory.
- [ ] **Step 5: Run both and watch them pass.**
- [ ] **Step 6: Commit** — `feat(commands): gate spawn with one --prompt-template per approved file`

---

### Task 8: Per-workspace activation

**Files:**
- Modify: `src/main/store.ts:155-165` (`WorkspaceEntry`), `:221-235` (accessors)
- Test: extend `tests/store.test.ts` (or create `tests/commands-store.test.ts` if that file does not exist)

Add `commandsActive?: Record<string, boolean>` beside `skillsActive`, with `getCommandsActive(p)` and `setCommandActive(p, id, on | null)`. Same semantics: only explicit overrides stored, `null` deletes, an emptied map is removed from the entry, paths normalized by the existing `WorkspaceRegistry` normalization.

- [ ] **Step 1: Write the failing test** — set/unset an override, assert a trailing-slash workspace path hits the same entry.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the store change.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): per-workspace activation overrides`

---

### Task 9: IPC surface, reload reason, and the file watcher

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts:188-214`, `src/renderer/src/hv.d.ts`
- Modify: `src/main/config.ts:24-26, 293-303` (add `linkedCommandDirs`)
- Test: `tests/commands-ipc.test.ts` for the pure helpers only

Mirror the skills channels: `hv:commands-list`, `-read`, `-approve`, `-set-enabled`, `-set-active`, `-get-linked` / `-set-linked` / `-add-linked`, `-import-local`, `-import-git`, `-import-select`, `-delete`, `-promote`. Reuse `src/main/skills/gitImport.ts` directly — it is source-agnostic.

Three wiring details:

1. **Spawn.** Add an `activeCommandEntries(workspace)` helper next to `activeSkillEntries` (`ipc.ts:156-166`) and feed `commands` into `spawnOpts`. There is **no manifest file** — the bridge reads nothing about commands.
2. **Reload.** Widen the `reason` union at `ipc.ts:753, 806, 824` from `"mcp" | "skills"` to include `"commands"`, add a `scheduleCommandReload` alias beside `scheduleSkillReload`, and call it from every mutating handler.
3. **Import collision refusal.** `hv:commands-import-select` must refuse any candidate whose name is in `RESERVED_COMMAND_NAMES`, returning the conflicting name so the UI can say which one — PRD §24.

Watchers: add the managed `<agentDir>/prompts` dir to the existing `fs.watch` block at `ipc.ts:2343-2354`, and let the workspace watcher (`ipc.ts:1750-1758`) cover both `.agents/prompts` and `.claude/commands`.

- [ ] **Step 1: Write the failing test** for the import-refusal helper (extract it as a pure `refuseReservedCommands(candidates)` so it is testable without Electron).
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement the IPC surface, config key, reload reason, and watcher.**
- [ ] **Step 4: Run the test and `npm run build` to typecheck main + preload + renderer types.**
- [ ] **Step 5: Commit** — `feat(commands): IPC surface, linked dirs, live reload`

---

### Task 10: Commands page and workspace block

**Files:**
- Create: `src/renderer/src/components/CommandsView.tsx`, `src/renderer/src/components/CommandsSection.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx:7, :122`, `src/renderer/src/App.tsx` (import + route), `src/renderer/src/components/WorkspaceSettingsView.tsx:134-135, :192-270`

Clone `SkillsView.tsx` / `SkillsSection.tsx`, importing `STATUS_TONE` / `STATUS_LABEL` / `SOURCE_TONE` and `SkillDiff` from `SkillsSection.tsx` rather than duplicating them (export them if they are not already). Add the `Commands` entry to the Settings group after Skills, and a `WorkspaceCommandsBlock` after the skills block, ordered Model → Permissions → Skills → **Commands** → MCP.

Row differences from skills: no "includes N scripts" pill; instead a `` !`bash` `` risk pill and a `shadowed` pill. The inspector shows the rendered body, the `argument-hint`, provenance, and the re-review diff — no file list, no token-weight line (resting cost is zero).

`ImportControls` gains a **one-click `~/.claude/commands` suggestion**, rendered only when `hv:commands-check-claude-dir` reports the directory exists.

- [ ] **Step 1: Build the page and block.**
- [ ] **Step 2: Run `npm run build`** — expect both typechecks clean.
- [ ] **Step 3: GUI pass** — `npm run dev`, confirm the page lists commands, approve/disable/delete work, and the workspace block toggles activation. Use `/uicheck` and attach a screenshot.
- [ ] **Step 4: Commit** — `feat(commands): Commands page and workspace block`

---

### Task 11: `/` autocomplete includes prompt commands

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx:208-249` (the `source === "skill"` filter at :222), `:1011-1028` (the menu subtitle)
- Modify: `src/main/ipc.ts:2221-2237` (`hv:list-commands`) to merge in `argumentHint`
- Test: extend `tests/composer-commands.test.ts`

`get_commands` does not carry `argumentHint` (`rpc-types.d.ts:135-144`), so main must join Pi's list against its own scan by name and add the hint. Widen the renderer filter to keep `source === "skill" || source === "prompt"`, and make the subtitle source-dependent: "Load this skill" vs the command's description + argument hint.

- [ ] **Step 1: Write the failing test** — `filterCommands` returns both sources; a prompt entry renders its `argumentHint`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): offer prompt commands in the composer's slash menu`

---

### Task 12: Bridge correlates the typed and expanded text — FAIL OPEN

**Files:**
- Create: `pi-runtime/extensions/hv-commands.ts`
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts`
- Test: `tests/hv-commands.test.ts` (pure), `tests/commands-bridge.test.ts` (live-Pi)

This is the only genuinely new code in the feature, and it sits in the path of **every** user prompt. Get the safety shape right before the feature shape.

`hv-commands.ts` is pure: `rememberTyped(state, text)` records the last typed text when it starts with `/`, and `pairExpanded(state, expanded)` returns `{ typed, expanded } | null`, clearing the state either way. It returns `null` when the texts are equal (no expansion happened) or when nothing was remembered.

In the bridge:

```ts
// The input hook sits in front of EVERY user prompt. A throw here would take
// the whole turn with it, so it is wrapped and always falls through — the card
// is a nicety, the prompt is the product. Same rule as before_provider_request
// (docs/validation/tc1.md): the hook fails OPEN.
pi.on("input", async (e) => {
  try {
    rememberTyped(commandState, e.text);
  } catch {
    /* never block a prompt for a transcript nicety */
  }
  return undefined; // undefined = continue unchanged; {action:"handled"} would swallow it
});
```

and in the existing `before_agent_start` handler, after the current work:

```ts
try {
  const pair = pairExpanded(commandState, prompt);
  if (pair) ctx.ui.notify(JSON.stringify({ kind: "hv.command", ...pair }), "info");
} catch {
  /* fail open */
}
```

- [ ] **Step 1: Write the failing pure test**

```ts
it("pairs a slash prompt with its expansion", () => {
  const s = {};
  rememberTyped(s, "/review src/foo.ts");
  expect(pairExpanded(s, "Review src/foo.ts for bugs.")).toEqual({
    typed: "/review src/foo.ts",
    expanded: "Review src/foo.ts for bugs.",
  });
});

it("returns null when nothing expanded, and never pairs twice", () => {
  const s = {};
  rememberTyped(s, "/hv-tools");
  expect(pairExpanded(s, "/hv-tools")).toBeNull();
  rememberTyped(s, "/review");
  expect(pairExpanded(s, "Review.")).not.toBeNull();
  expect(pairExpanded(s, "Review.")).toBeNull();
});

it("ignores an ordinary prompt", () => {
  const s = {};
  rememberTyped(s, "hello there");
  expect(pairExpanded(s, "hello there")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `hv-commands.ts` and wire both hooks in the bridge.**
- [ ] **Step 4: Run the pure test and watch it pass.**
- [ ] **Step 5: Write the live-Pi test `tests/commands-bridge.test.ts`** (`skipIf(!KEY)`), asserting three things in one session: an ordinary non-slash prompt still reaches the model and produces a turn (**the fail-open proof — this is the assertion that matters**); an approved command expands and emits one `hv.command` notify carrying both texts; an unapproved `.md` in `<agentDir>/prompts` is absent from `get_commands`.
- [ ] **Step 6: Run it** — `npx vitest run tests/commands-bridge.test.ts --no-file-parallelism > /tmp/live.log 2>&1; echo "EXIT=$?"`
- [ ] **Step 7: Commit** — `feat(commands): correlate typed and expanded prompt text, failing open`

---

### Task 13: Persist the pairing and re-pair on restore

**Files:**
- Modify: `src/main/ipc.ts` (parse the `hv.command` notify alongside `parseSkillNotify` at `:88-94`, forward + log), `src/main/restore.ts:71-76`
- Test: `tests/commands-restore.test.ts`

Main logs `{ type: "command.invoked", data: { sessionId, typed, expandedHash } }` to the EventLog, where `expandedHash` is `sha256(expanded)`. On restore, hash each user message's text and attach `typed` when it matches a logged entry for that session, so `contextItems` yields `{ kind: "user", text, command?: { typed } }`.

Hashing is what makes this order-independent and reload-proof; do not pair by ordinal, because ask-user answers and queued messages also produce user messages.

- [ ] **Step 1: Write the failing test** — a session log with one `command.invoked` entry plus a session file containing the expanded text yields a restored item carrying `command.typed`; a non-matching message stays plain.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test and watch it pass.**
- [ ] **Step 5: Commit** — `feat(commands): persist the typed form and re-pair it after a reload`

---

### Task 14: The command card

**Files:**
- Modify: `src/renderer/src/App.tsx:1086-1097` (send path), `:796-803` (queue delivery), `:1030-1059` (restore adoption)
- Create: `src/renderer/src/components/CommandCard.tsx`
- Test: `tests/command-card.test.ts`

A transcript item gains an optional `command?: { typed: string }`. When present, `MessageItem` renders `CommandCard`: the header shows the typed form in monospace with the description beside it, and a disclosure toggles the expanded prompt. Absent → today's plain bubble, unchanged.

Three call sites must set it: the optimistic idle send (from the local command list — the renderer already fetched it for autocomplete), the `queue_update` delivery path (from the `hv.command` notify), and the restore adoption path (from Task 13).

- [ ] **Step 1: Write the failing test** for the pure part — a helper `attachCommand(item, pairs)` that decides whether an item renders as a card.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement `CommandCard.tsx` and the three call sites.**
- [ ] **Step 4: Run the test, then `npm run build`.**
- [ ] **Step 5: GUI pass** — type a command idle, type one while the agent is busy, then ⌘R. All three must show the same card. Screenshot via `/uicheck`.
- [ ] **Step 6: Commit** — `feat(commands): render an invocation as a card that survives a reload`

---

### Task 15: Bundled starter commands

**Files:**
- Create: `pi-runtime/prompts/*.md` + `pi-runtime/prompts/bundled.json`
- Modify: the packaging file list if `pi-runtime/skills` is enumerated explicitly rather than copied wholesale
- Test: extend `tests/commands-locations.test.ts`

Ship three genuinely useful commands, pre-approved and **off by default**: `review` (review the current diff), `explain` (explain a file or symbol), `test` (write tests for a file). Each carries a `description` and an `argument-hint`. `bundled.json` records provenance in the same shape skills use.

- [ ] **Step 1: Write the commands and `bundled.json`.**
- [ ] **Step 2: Extend the test** to assert all three install approved-but-disabled on a fresh registry.
- [ ] **Step 3: Run the test and watch it pass.**
- [ ] **Step 4: Verify packaging** — confirm `pi-runtime/prompts` lands in a built app (`npm run build`, then check the artifact).
- [ ] **Step 5: Commit** — `feat(commands): bundle three starter commands, off by default`

---

### Task 16: Documentation, full gate, live batch

**Files:**
- Create: `docs/validation/cm1.md`
- Modify: `docs/validation/d1.md` (the `hv.command` wire shape), `CLAUDE.md`

`cm1.md` records what was measured against 0.83.0, because the next person will otherwise re-derive it: `--prompt-template` takes a file **or** a directory; explicit paths are merged **last** and `dedupePrompts` is first-wins, so an explicit path would lose to a same-named discovered one (harmless only because we always pass `--no-prompt-templates`); extension commands shadow prompt templates silently; `argumentHint` is missing from `get_commands`; and `resources_discover` was evaluated and rejected, with the reason.

`CLAUDE.md` gains a short Commands bullet in the Architecture section and adds `tests/commands-bridge.test.ts` to the live-test list.

- [ ] **Step 1: Write `cm1.md` and the `d1.md` addendum.**
- [ ] **Step 2: Update `CLAUDE.md`.**
- [ ] **Step 3: Run the full gate** — `npm run gate > /tmp/gate.log 2>&1; echo "EXIT=$?"`
- [ ] **Step 4: Run the live batch** — `npm run live:why` first; if it prints anything, `npm run test:live > /tmp/live.log 2>&1; echo "EXIT=$?"`. Report the real result either way.
- [ ] **Step 5: Commit** — `docs(commands): record the 0.83.0 prompt-template contract`

---

## Self-review

**Spec coverage.** PRD §24's five decisions map to: scope/reuse → Tasks 1-8; scopes and `.claude/commands` → Task 5 + Task 9's linked dirs; invocation transparency → Tasks 12-14; collisions and degraded commands → Tasks 3, 4, 9 (refusal) and Task 1 (`hasBashInjection`); surfaces → Tasks 10-11. The rejected `resources_discover` path is recorded in Task 16 rather than built.

**Ordering.** Tasks 1-8 are main-side and independent of the renderer; 10-11 depend on 9; 12-14 form the card chain and depend only on 9. Tasks 1-6 can run in parallel — they share no files.

**Risk concentration.** Task 12 is the only task that can break existing behaviour, and its live test's first assertion is the fail-open proof rather than the feature itself. If that assertion is red, stop and revert the hook — the card is worth less than the composer.
