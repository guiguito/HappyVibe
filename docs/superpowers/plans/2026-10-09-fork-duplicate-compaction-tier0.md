# Fork, Duplicate, auto-compaction switch, Tier 0 guard (round 28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four changes:
- A user message can be forked into a new session.
- A session can be duplicated.
- Pi's auto-compaction gets one global switch.
- A typed extension command (`/mcp`, `/agents`, `/hv-*`) never reaches Pi, except `/hv-dangerous off`.

**Architecture:**
- **Fork and Duplicate.** Never use Pi's live `fork` RPC. A short-lived bare Pi does the work and exits: it starts with `--fork <original file>` (a full copy) and, for a fork, then receives RPC `fork <entryId>`. Pi's own code writes the new file. Main registers it as a NEW `SessionMeta` (new id, `forkedFrom: {sessionId, at}`), so the existing open path paints it from the file and spawns its Pi as a resume.
- **Finding the message to fork.** The renderer names the message by Pi's own `message.timestamp` (`piTs`). Live bubbles get it from a user-role `message_end`, restored ones from the file. Main matches it on the leaf path.
- **Cost.** It is counted once by a timestamp cut in `sessionCalls`.
- **Tier 0.** One pure function, `slashRefusal`, is called at the top of `promptSession`.
- **Auto-compaction.** The switch is a config key, merge-written into `<agentDir>/settings.json` and pushed live with `set_auto_compaction`.

**Tech Stack:** Electron + React renderer, Pi 1.0.2 RPC, vitest (no DOM). Key-free Pi boots use `tests/fixtures/faux-model.ts`.

**Spec:**
- Notion "Pi /commands full support" (`3cbd33dfffca803687ceee6cea8da8b6`), §0 (decided 2026-10-09).
- `docs/prd.md`:
  - §9 "Decision (Feedback round 28, 2026-10-09) — auto-compaction gets a switch…"
  - §10 "Decision (Feedback round 28, 2026-10-09) — a typed extension command never reaches Pi…"
  - §17 "Decision (Feedback round 28, 2026-10-09) — a session can be forked from a message or duplicated…"

## Global Constraints

- **The original is never touched.** A fork or duplicate never writes the original's session file, never stops or aborts its process, and never changes its `SessionMeta`.
- **A fork or duplicate is a NEW session id.** Snapshots (`<userData>/snapshots/<id>/`), audit rows and the skills manifest stay with the original.
- **Not inherited:** `scheduleId` and session grants. **Inherited:** `model`, `thinking`, and plan state (it lives in the file).
- **Titles:** `‹title› (fork)` and `‹title› (copy)`. `titleSource` is copied from the original.
- **Fork is never offered above a compaction boundary** (`outOfContext`), and never on a bubble without `piTs`.
- **The Fork dialog's scopes:** `conversation` (the default) and `both`. Never `files`.
- **Duplicate** is disabled while the session is working, both in the menu and in main.
- **Cost:** a fork's or duplicate's ledger counts only calls with `ts > forkedFrom.at`.
- **Auto-compaction:** global only, default ON, an off confirm with the exact copy *"When the context fills up, the next message fails instead of being summarized."*
- **The only typed reserved command allowed** is exactly `/hv-dangerous off` (after `trim()`).
- **Bare one-shot Pi spawn flags:** `--no-extensions --no-skills --no-prompt-templates --no-themes`. Its `cwd` is the original session's root (`meta.workspaceId`), because Pi stamps the copy's header `cwd` from the process cwd.
- **Commits:** `git commit -s`, conventional messages, with the attribution trailer.
- **New literal `throw new Error("…")`** → run `npm run catalog:crash-messages` in the same commit.

## Review Focus

1. **Fork from the very FIRST user message.** Pi would produce an empty, unwritten file. Expected: a fresh session with no Pi fork, the message in its composer, and the title `‹title› (fork)`. (Task 3 test: `userEntryAt(...).first`. Task 4 test: `forkInto` skips the one-shot when `first`.)
2. **Fork while the original is mid-turn**, with its file being appended. Expected: the original's file is byte-identical afterwards, and the fork holds the history up to the chosen message. (Task 3 contract test: sha256 before/after.)
3. **Fork from a message after an earlier conversation-scope rewind** (the rewound messages are still in the file, only marked). Expected: `piTs` still resolves on the leaf path to the right entry. (Task 3 test: a duplicate timestamp can't collide, because `userEntryAt` matches the exact epoch ms.)
4. **The original is deleted before the fork is reopened.** Expected: the marker reads *"Forked from a deleted session"*, pre-fork run cards still say they're from the original, and the fork's cost pill doesn't change. (Task 7 test on `forkMarkerCopy(null)`; Task 5 test, since the ledger never reads the original.)
5. **Typed variants of the exception:** `"  /hv-dangerous off  "` is allowed; `"/hv-dangerous"`, `"/hv-dangerous on"` and `"/hv-dangerous  off"` are refused. `"/skill:skill-creator"` (SkillsSection's own send) and `"/mcpfoo"` are allowed. (Task 2 test.)

---

### Task 1: The reserved list is every command a chat session registers

**Files:**
- Modify: `src/main/promptTemplates/view.ts:24-53` (doc comment + `RESERVED_SLASH_COMMANDS`)
- Modify: `tests/prompt-templates-reserved.test.ts`

**Interfaces:**
- Produces: `RESERVED_SLASH_COMMANDS` now also has `agents` and `mcp`. `isShadowed` is unchanged.

- [ ] **Step 0: Bootstrap.** If `pi-runtime/node_modules` is missing: `npm install && (cd pi-runtime && npm ci)` (or `/devdoctor`). The test reads tintinweb's `src/` and Pi's `dist/extensions/`.
- [ ] **Step 1: Write the failing test.** Replace the first test in `tests/prompt-templates-reserved.test.ts` with:

```ts
import { PI_MCP_EXTENSIONS } from "../src/main/pi/spawn";

const RT = path.join(__dirname, "..", "pi-runtime");
const PI_EXT = path.join(RT, "node_modules/@earendil-works/pi-coding-agent/dist/extensions");
const TW_SRC = path.join(RT, "node_modules/@tintinweb/pi-subagents/src");
const literals = (src: string): string[] => [...src.matchAll(/registerCommand\(\s*"([^"]+)"/g)].map((m) => m[1]);
const filesUnder = (dir: string, ext: RegExp): string[] =>
  (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => ext.test(f) && !/test/.test(f)).map((f) => path.join(dir, f));

test("reserved names = every command a chat session registers (bridge + tintinweb + loaded Pi built-ins)", () => {
  const bridge = fs.readFileSync(BRIDGE, "utf8");
  // Every bridge registerCommand call must be a plain string literal, or the scan under-counts.
  expect((bridge.match(/pi\.registerCommand\(/g) ?? []).length).toBe(literals(bridge).length);
  const builtins = PI_MCP_EXTENSIONS.filter((a) => a.startsWith("builtin:")).map((a) => a.slice("builtin:".length));
  const found = new Set([
    ...literals(bridge),
    ...filesUnder(TW_SRC, /\.ts$/).flatMap((f) => literals(fs.readFileSync(f, "utf8"))),
    ...builtins.flatMap((b) => filesUnder(path.join(PI_EXT, b), /\.js$/).flatMap((f) => literals(fs.readFileSync(f, "utf8")))),
  ]);
  // Guards against a scan that silently matches nothing.
  expect(found.has("agents")).toBe(true);
  expect(found.has("mcp")).toBe(true);
  expect(found.size).toBeGreaterThan(15);
  expect([...RESERVED_SLASH_COMMANDS].sort()).toEqual([...found].sort());
});
```

- [ ] **Step 2: Run it.** `L=/tmp/vitest.log; npx vitest run tests/prompt-templates-reserved.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`. Expected: FAIL, because `agents` and `mcp` are missing.
- [ ] **Step 3: Implement.**
  - Add `"agents",` and `"mcp",` to `RESERVED_SLASH_COMMANDS`.
  - Rewrite the doc comment above it to say: every command a chat session registers (the bridge's `/hv-*`, tintinweb's `/agents`, Pi's built-in `/mcp`). §10 round 28 also uses this list as the slash guard (`slashGuard.ts`).
  - Fix the wrong test name in the comment: `tests/commands-reserved.test.ts` → `tests/prompt-templates-reserved.test.ts`.
- [ ] **Step 4: Run again.** Same command. Expected: PASS. Also run `tests/prompt-templates-view.test.ts` (it asserts `hv-dangerous` is reserved). Expected: PASS.
- [ ] **Step 5: Commit.** `fix(prompts): a prompt named agents or mcp is marked shadowed — the reserved list is every command a chat session registers`

### Task 2: The slash guard in `promptSession`

**Files:**
- Create: `src/main/slashGuard.ts`
- Modify: `src/main/ipc.ts` (`promptSession`, ~3612: insert after the payload validation, before `let client = manager.get(sessionId)`)
- Create: `tests/slash-guard.test.ts`

**Interfaces:**
- Consumes: `RESERVED_SLASH_COMMANDS` (Task 1).
- Produces: `slashRefusal(text: string): string | null` and `ALLOWED_TYPED = "/hv-dangerous off"`.

- [ ] **Step 1: Write the failing test** in `tests/slash-guard.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { slashRefusal } from "../src/main/slashGuard";

describe("slashRefusal", () => {
  test.each([
    ["/mcp logout github", "/mcp is managed from the MCP page."],
    ["/mcp", "/mcp is managed from the MCP page."],
    ["/agents", "/agents is managed from the Agents page."],
    ["/hv-logout openai", "Sign-ins are managed from Models."],
    ["/hv-login anthropic", "Sign-ins are managed from Models."],
    ["/hv-dangerous on", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-dangerous", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-dangerous  off", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-plan", "/hv-plan is internal to HappyVibe and can't be typed."],
  ])("refuses %j", (text, reason) => expect(slashRefusal(text)).toBe(reason));

  test.each(["/hv-dangerous off", "  /hv-dangerous off  ", "/skill:skill-creator", "/mcpfoo", "please run /mcp logout", "/MCP", "hello", ""])(
    "allows %j",
    (text) => expect(slashRefusal(text)).toBeNull(),
  );
});

test("promptSession refuses BEFORE it wakes a hibernated session", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const body = ipc.slice(ipc.indexOf("const promptSession = async ("), ipc.indexOf('"hv:prompt-session"'));
  expect(body.indexOf("slashRefusal(msg)")).toBeGreaterThan(-1);
  expect(body.indexOf("slashRefusal(msg)")).toBeLessThan(body.indexOf("startClient("));
});
```

- [ ] **Step 2: Run it.** `L=/tmp/vitest.log; npx vitest run tests/slash-guard.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/main/slashGuard.ts`:

```ts
import { RESERVED_SLASH_COMMANDS } from "./promptTemplates/view";

/**
 * PRD §10 round 28 — Pi runs a registered extension command the moment a prompt names it,
 * before any bridge hook, even mid-turn. Main is the only choke point, so a typed one is
 * refused here (electron-free, so the test can import it). Scheduled runs share promptSession.
 */
/** The red banner's Turn off — the one reserved command the UI itself sends. */
export const ALLOWED_TYPED = "/hv-dangerous off";

export function slashRefusal(text: string): string | null {
  const t = text.trim();
  if (t === ALLOWED_TYPED) return null;
  const name = /^\/(\S+)/.exec(t)?.[1];
  if (!name || !RESERVED_SLASH_COMMANDS.has(name)) return null;
  if (name === "mcp") return "/mcp is managed from the MCP page.";
  if (name === "agents") return "/agents is managed from the Agents page.";
  if (name === "hv-login" || name === "hv-logout" || name === "hv-login-cancel") return "Sign-ins are managed from Models.";
  if (name === "hv-dangerous") return "Bypass is turned on in Settings, with Bypass ALL permissions.";
  return `/${name} is internal to HappyVibe and can't be typed.`;
}
```

  In `promptSession`, right before `let client = manager.get(sessionId) as PiClient | null;`:

```ts
    // §10 round 28: a typed extension command never reaches Pi (slashGuard.ts). Before the
    // wake, so a refusal never boots a hibernated session.
    const refusal = slashRefusal(msg);
    if (refusal) throw new Error(refusal);
```

- [ ] **Step 4: Run again.** Expected: PASS. Then run `tests/usage-minor-fixes.test.ts` and `tests/usage-review-fixes.test.ts`, which scan the `hv:prompt-session` handler. Expected: PASS (the analytics regex is untouched).
- [ ] **Step 5: Confirm the renderer path.** `refused()` (`App.tsx:2887`) shows `ipcMessage(err)` and puts the words back in the composer. Check that `src/renderer/src/ipcError.ts` strips Electron's `Error invoking remote method 'hv:prompt-session': Error:` prefix. If it doesn't, the notice shows the prefix (fix it there).
- [ ] **Step 6: Commit.** `feat(permissions): a typed extension command is refused before it reaches Pi — only /hv-dangerous off passes`

### Task 3: The fork one-shot, and its wire, pinned key-free

**Files:**
- Modify: `src/main/pi/spawn.ts` (add `resolveForkSpawn` after `resolvePiSpawn`)
- Create: `src/main/sessionFork.ts` (`forkSessionFile`)
- Modify: `src/main/history.ts` (add `userEntryAt`)
- Create: `tests/session-fork-contract.test.ts`
- Create: `docs/validation/fk1.md`

**Interfaces:**
- Produces:
  - `resolveForkSpawn(cwd: string, sessionDir: string, runtimeDir: string, sourceFile: string, agentDirPath: string, plat?: Platform): { execPath: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }`
  - `forkSessionFile(spec: SpawnSpec, sessionDirPath: string, entryId?: string, make?: (s: SpawnSpec) => ClientLike): Promise<string>`. It returns the new file's absolute path. With no `entryId` it's a duplicate.
  - `userEntryAt(jsonl: string | null | undefined, piTs: number): { entryId: string; first: boolean } | null` (`history.ts`)

- [ ] **Step 1: Write the failing contract test** `tests/session-fork-contract.test.ts`. It needs no key: the faux model writes a real two-turn session.

```ts
// Key-free: a real Pi writes a two-turn session through the faux model; the bare one-shot forks it.
import { afterAll, beforeAll, expect, test } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { nodeExecPath, PI_CLI_RELPATH, resolveForkSpawn } from "../src/main/pi/spawn";
import { forkSessionFile } from "../src/main/sessionFork";
import { leafPath, parseEntries, userEntryAt } from "../src/main/history";

const runtime = path.join(process.cwd(), "pi-runtime");
let tmp: string, dir: string, agent: string, src: string;
const userTs: number[] = [];
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const texts = (file: string) =>
  leafPath(parseEntries(fs.readFileSync(file, "utf8")))
    .filter((e) => e.type === "message" && e.message?.role === "user")
    .map((e) => JSON.stringify(e.message?.content));

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-fork-"));
  dir = path.join(tmp, "sessions"); agent = path.join(tmp, "agent");
  fs.mkdirSync(dir); fs.mkdirSync(agent);
  const c = new PiClient({
    execPath: nodeExecPath(),
    args: [path.join(runtime, PI_CLI_RELPATH), "--mode", "rpc", "--session-dir", dir,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", path.join(process.cwd(), "tests/fixtures/faux-model.ts"), "--provider", "faux", "--model", "script"],
    cwd: tmp,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOME: tmp, PI_CODING_AGENT_DIR: agent, HV_TEST_RUNTIME: runtime,
      HV_FAUX_STEPS: JSON.stringify([{ text: "one" }, { text: "two" }]) },
  });
  c.on("event", (e: { type: string; message?: { role?: string; timestamp?: number } }) => {
    if (e.type === "message_end" && e.message?.role === "user" && typeof e.message.timestamp === "number") userTs.push(e.message.timestamp);
  });
  await c.start();
  for (const text of ["first", "second"]) {
    const ended = new Promise<void>((res) => { const h = (e: { type: string }) => { if (e.type === "agent_end") { c.off("event", h); res(); } }; c.on("event", h); });
    await c.send({ type: "prompt", message: text });
    await ended;
  }
  src = ((await c.send({ type: "get_state" })).data as { sessionFile: string }).sessionFile;
  c.stop();
}, 90_000);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("a live user message_end carries the file entry's own message.timestamp (the piTs key)", () => {
  expect(userTs).toHaveLength(2);
  for (const ts of userTs) expect(userEntryAt(fs.readFileSync(src, "utf8"), ts)).not.toBeNull();
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[0])?.first).toBe(true);
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[1])?.first).toBe(false);
  expect(userEntryAt(fs.readFileSync(src, "utf8"), userTs[1] + 1)).toBeNull();
});

test("fork before the 2nd message: new file, history up to it, original byte-identical, copy deleted", async () => {
  const before = sha(src);
  const filesBefore = new Set(fs.readdirSync(dir));
  const hit = userEntryAt(fs.readFileSync(src, "utf8"), userTs[1])!;
  const t0 = Date.now();
  const forked = await forkSessionFile(resolveForkSpawn(tmp, dir, runtime, src, agent), dir, hit.entryId);
  console.log(`[fk1] fork one-shot: ${Date.now() - t0} ms`);
  expect(sha(src)).toBe(before);
  expect(forked).not.toBe(src);
  expect(texts(forked)).toEqual([texts(src)[0]]);
  const header = JSON.parse(fs.readFileSync(forked, "utf8").split("\n")[0]);
  expect(header.cwd).toBe(JSON.parse(fs.readFileSync(src, "utf8").split("\n")[0]).cwd);
  // Only the fork is new — the intermediate full copy is gone.
  expect(fs.readdirSync(dir).filter((f) => !filesBefore.has(f) && f.endsWith(".jsonl"))).toEqual([path.basename(forked)]);
}, 60_000);

test("duplicate: every entry copied, original byte-identical", async () => {
  const before = sha(src);
  const t0 = Date.now();
  const copy = await forkSessionFile(resolveForkSpawn(tmp, dir, runtime, src, agent), dir);
  console.log(`[fk1] duplicate one-shot: ${Date.now() - t0} ms`);
  expect(sha(src)).toBe(before);
  const ids = (f: string) => parseEntries(fs.readFileSync(f, "utf8")).map((e) => e.id);
  expect(ids(copy).slice(0, ids(src).length)).toEqual(ids(src));
}, 60_000);
```

- [ ] **Step 2: Run it.** `L=/tmp/vitest.log; npx vitest run tests/session-fork-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -40 $L`. Expected: FAIL (imports missing).
- [ ] **Step 3: Implement.**

  `history.ts`, after `leafPath`:

```ts
/**
 * §17 round 28: the user message a fork starts BEFORE — matched by Pi's own
 * `message.timestamp`, which the renderer carries as `piTs` (live from a user-role
 * `message_end`, restored from this file). `first`: nothing conversational precedes it,
 * so Pi would write no file — main opens a fresh session instead.
 */
export function userEntryAt(jsonl: string | null | undefined, piTs: number): { entryId: string; first: boolean } | null {
  const users = leafPath(parseEntries(jsonl)).filter((e) => e.type === "message" && e.message?.role === "user");
  const i = users.findIndex((e) => e.message?.timestamp === piTs);
  return i < 0 ? null : { entryId: users[i].id, first: i === 0 };
}
```

  `spawn.ts`, after `resolvePiSpawn`:

```ts
/**
 * §17 round 28: a short-lived BARE Pi that writes a fork/duplicate file and exits — never
 * the session's own process (Pi's live `fork` aborts the turn and reloads every extension
 * in place). `cwd` must be the source session's root: `--fork` stamps the copy's header cwd
 * from the process cwd (session-manager.js forkFrom).
 */
export function resolveForkSpawn(cwd: string, sessionDir: string, runtimeDir: string, sourceFile: string, agentDirPath: string, plat: Platform = platform) {
  return {
    execPath: plat.nodeExecPath(),
    args: [path.join(runtimeDir, PI_CLI_RELPATH), "--mode", "rpc", "--fork", sourceFile, "--session-dir", sessionDir,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_CODING_AGENT_DIR: agentDirPath },
  };
}
```

  Check `Platform` has `nodeExecPath()`. `resolvePiSpawn` uses `plat.nodeExecPath()` at `spawn.ts:180`; mirror whatever that line calls.

  `src/main/sessionFork.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { PiClient } from "./pi/PiClient";

type SpawnSpec = ConstructorParameters<typeof PiClient>[0];
type ClientLike = Pick<PiClient, "start" | "stop" | "send">;

/**
 * PRD §17 round 28 — fork/duplicate through a bare one-shot Pi (resolveForkSpawn): `--fork`
 * copies the whole session (the source is only READ), then RPC `fork <entryId>` branches the
 * copy before that message. Pi's own code writes the format; we only delete the intermediate copy.
 */
export async function forkSessionFile(
  spec: SpawnSpec,
  sessionDirPath: string,
  entryId?: string,
  make: (s: SpawnSpec) => ClientLike = (s) => new PiClient(s),
): Promise<string> {
  const c = make(spec);
  await c.start();
  try {
    const fileOf = async (): Promise<string | undefined> =>
      ((await c.send({ type: "get_state" })).data as { sessionFile?: string } | undefined)?.sessionFile;
    const copy = await fileOf();
    if (!copy) throw new Error("Pi did not report the copied session.");
    if (!entryId) return copy;
    const r = await c.send({ type: "fork", entryId });
    if ((r.data as { cancelled?: boolean } | undefined)?.cancelled) throw new Error("Pi cancelled the fork.");
    const forked = await fileOf();
    if (!forked || forked === copy || !fs.existsSync(forked)) throw new Error("Pi did not write the forked session.");
    if (path.resolve(copy).startsWith(path.resolve(sessionDirPath) + path.sep)) fs.rmSync(copy, { force: true });
    return forked;
  } finally {
    c.stop();
  }
}
```

- [ ] **Step 4: Run again.** Expected: PASS, with two `[fk1]` timing lines in `$L`. If the first test fails because `userTs` is empty, Pi does NOT relay user-role `message_end` over RPC. Stop and report: the live `piTs` design (Task 6) needs another key.
- [ ] **Step 5: `npm run catalog:crash-messages`** (four new literal throws), then run `tests/crash-safe-messages*.test.ts`. Expected: PASS.
- [ ] **Step 6: Record.** Create `docs/validation/fk1.md` with:
  - the two timings;
  - the wire: `get_state.sessionFile` before and after `fork`;
  - the `fork` response `{text, cancelled}`;
  - the header `parentSession` of the fork naming the deleted intermediate copy. That's harmless: it's top level, `twChildren` only scans `subagents/`, and HappyVibe's link is `SessionMeta.forkedFrom`.
  - Add the `fork` / `get_state` shapes to `docs/validation/d1.md` under a "Round 28" heading.
- [ ] **Step 7: Commit.** `feat(sessions): fork and duplicate through a bare one-shot Pi — the original's file is only read`

### Task 4: Main — `hv:session-fork` and `hv:session-duplicate`

**Files:**
- Modify: `src/main/store.ts` (`SessionMeta`: add `forkedFrom`)
- Modify: `src/main/sessionFork.ts` (add the pure `forkMeta`)
- Modify: `src/main/ipc.ts` (two handlers next to `hv:session-export-html`, ~3265)
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Create: `tests/session-fork-meta.test.ts`

**Interfaces:**
- Consumes: `forkSessionFile`, `resolveForkSpawn`, `userEntryAt` (Task 3).
- Produces:
  - `SessionMeta.forkedFrom?: { sessionId: string; at: string }` (`at` = ISO time of the fork).
  - `forkMeta(original: SessionMeta, kind: "fork" | "duplicate", at: string)`
  - `window.hv.forkSession(sessionId: string, piTs: number): Promise<{ sessionId: string }>`
  - `window.hv.duplicateSession(sessionId: string): Promise<{ sessionId: string }>`

- [ ] **Step 1: Write the failing test** `tests/session-fork-meta.test.ts`:

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import { forkMeta } from "../src/main/sessionFork";
import type { SessionMeta } from "../src/main/store";

const orig: SessionMeta = {
  id: "o1", title: "Fix login", workspaceId: "/w", createdAt: "x", updatedAt: "x", archived: false,
  titleSource: "model", model: { provider: "p", modelId: "m" }, thinking: "high", scheduleId: "sch1", hibernated: true,
};

test("a fork carries model, thinking and title source — never the schedule", () => {
  const m = forkMeta(orig, "fork", "2026-10-09T10:00:00.000Z");
  expect(m).toEqual({
    title: "Fix login (fork)", titleSource: "model", model: { provider: "p", modelId: "m" }, thinking: "high",
    forkedFrom: { sessionId: "o1", at: "2026-10-09T10:00:00.000Z" },
  });
  expect(m).not.toHaveProperty("scheduleId");
  expect(forkMeta(orig, "duplicate", "t").title).toBe("Fix login (copy)");
});

test("duplicate refuses mid-turn in MAIN too, and the fork reads the file before any spawn", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const dup = ipc.slice(ipc.indexOf('"hv:session-duplicate"'), ipc.indexOf('"hv:session-duplicate"') + 400);
  expect(dup).toContain("activity.isBusy(sessionId)");
  const fork = ipc.slice(ipc.indexOf('"hv:session-fork"'), ipc.indexOf('"hv:session-fork"') + 500);
  expect(fork).toContain("userEntryAt(");
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `store.ts` `SessionMeta`:

```ts
  /**
   * §17 round 28: this session was forked or duplicated from another. `at` is the cut:
   * entries copied from the original keep their timestamps, so anything after `at` is this
   * session's own (the cost ledger, the "Forked from" marker, pre-fork run cards). Additive.
   */
  forkedFrom?: { sessionId: string; at: string };
```

  - `sessionFork.ts`:

```ts
import type { SessionMeta } from "./store";

/** The new session's fields — pure. Never a schedule (a fork of a run is the user's now), never `hibernated`. */
export function forkMeta(o: SessionMeta, kind: "fork" | "duplicate", at: string): Partial<SessionMeta> {
  return {
    title: `${o.title} (${kind === "fork" ? "fork" : "copy"})`,
    titleSource: o.titleSource,
    ...(o.model ? { model: o.model } : {}),
    ...(o.thinking ? { thinking: o.thinking } : {}),
    forkedFrom: { sessionId: o.id, at },
  };
}
```

  - `ipc.ts`, next to `hv:session-export-html`. Imports: `forkSessionFile, forkMeta` from `./sessionFork`, `resolveForkSpawn` from `./pi/spawn`, `userEntryAt` from `./history`.

```ts
  // §17 round 28: fork / duplicate make a NEW session. The original's file is only read and its
  // process never touched; hv:open-session then paints the new one from its file and resumes it.
  const forkInto = async (meta: SessionMeta, kind: "fork" | "duplicate", entryId?: string, fresh = false): Promise<{ sessionId: string }> => {
    const src = sessionFilePath(sessionDir(), meta.piSessionFile);
    if (!src && !fresh) throw new Error("This session has nothing to copy yet.");
    const at = new Date().toISOString();
    const file = fresh || !src
      ? undefined
      : await forkSessionFile(resolveForkSpawn(meta.workspaceId, sessionDir(), piRuntimeDir(), src, agentDir()), sessionDir(), entryId);
    const next = index.create(meta.workspaceId);
    index.update(next.id, { ...forkMeta(meta, kind, at), ...(file ? { piSessionFile: file } : {}) });
    sessionsChanged();
    return { sessionId: next.id };
  };
  ipcMain.handle("hv:session-fork", async (_e, sessionId: string, piTs: number) => {
    const meta = index.get(sessionId);
    if (!meta) throw new Error("Unknown session");
    const hit = userEntryAt(readSessionFile(sessionDir(), meta.piSessionFile), Number(piTs));
    if (!hit) throw new Error("That message is no longer in this conversation.");
    return forkInto(meta, "fork", hit.entryId, hit.first);
  });
  ipcMain.handle("hv:session-duplicate", async (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    if (!meta) throw new Error("Unknown session");
    if (activity.isBusy(sessionId)) throw new Error("Wait for the turn to finish, then duplicate.");
    return forkInto(meta, "duplicate");
  });
```

  - Confirm `hv:open-session` (~3146: `await startClient(meta, !!meta.piSessionFile)`) spawns a session that has a file and no client. That is the resume. A `fresh` fork has no file, so it starts like a new session.
  - Preload: `forkSession: (sessionId: string, piTs: number) => ipcRenderer.invoke("hv:session-fork", sessionId, piTs)` and `duplicateSession: (sessionId: string) => ipcRenderer.invoke("hv:session-duplicate", sessionId)`. Add the matching types in `hv.d.ts`.
- [ ] **Step 4: Run again.** Expected: PASS. Run `npm run catalog:crash-messages` (new literal throws) and its test.
- [ ] **Step 5: Commit.** `feat(sessions): fork and duplicate IPC — a new session id, the model and thinking carried, never the schedule`

### Task 5: The cost ledger counts a fork's calls once

**Files:**
- Modify: `src/main/sessionLedger.ts` (`sessionCalls`: add `since?: string`)
- Modify: `src/main/ipc.ts`: the three `sessionCalls(` call sites (~3372, ~3917, ~4793)
- Create: `tests/session-ledger-fork.test.ts`

**Interfaces:**
- Produces: `sessionCalls(sessionDirPath, piSessionFile, plans, agentByFile?, since?: string): ApiCall[] | null`. Rows with `ts <= since` are dropped. Both are ISO strings from `toISOString()`, so a string compare is exact.

- [ ] **Step 1: Write the failing test.** Build a temp sessions dir with one session file: the fixture `tests/fixtures/pi-session.jsonl` content, plus a second assistant line with a later timestamp. Then:

```ts
const all = sessionCalls(dir, file, new Set())!;
expect(all).toHaveLength(2);
const cut = sessionCalls(dir, file, new Set(), undefined, all[0].ts)!;
expect(cut.map((c) => c.ts)).toEqual([all[1].ts]); // the inherited call is the original's, not the fork's
expect(sessionCalls(dir, file, new Set(), undefined, undefined)).toHaveLength(2); // a non-fork is unchanged
```

- [ ] **Step 2: Run it.** Expected: FAIL (the 5th argument is ignored).
- [ ] **Step 3: Implement.** In `sessionCalls`, change the return to:

```ts
  // §17 round 28: a fork's copied history keeps its timestamps — only what happened after the
  // fork is this session's, so Stats (which sums every session) counts each call once.
  return [...own, ...children].filter((c) => !since || c.ts > since).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
```

  Pass `meta.forkedFrom?.at` as the 5th argument at all three call sites (pass `undefined` for `agentByFile` where it's absent).
- [ ] **Step 4: Check `hv:get-stats`** (~3962, `get_session_stats`). Pi's totals include the copied history. Run `grep -rn "getStats(" src/renderer/src`. If any consumer shows `cost` or `tokens` as this session's spend, switch it to the ledger total. If it only feeds the context gauge (`contextUsage`), leave it, and add a one-line comment saying why.
- [ ] **Step 5: Run again.** Expected: PASS. Also run `tests/calls*.test.ts` and `tests/analytics*.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** `fix(cost): a fork's pill and Stats count only calls after the fork — the shared history stays the original's`

### Task 6: Renderer — `piTs`, the Fork button and its dialog

**Files:**
- Create: `src/renderer/src/fork.ts`
- Modify: `src/renderer/src/components/Transcript.tsx` (user item type: `piTs?`, `synthetic?`; a `ForkButton` beside `RewindButton` at ~466)
- Modify: `src/renderer/src/restoreMap.ts` (a user item's `piTs = ts`; restoreMap drops any field it doesn't NAME)
- Modify: `src/renderer/src/App.tsx`:
  - `message_end` handler ~1859: stamp `piTs`;
  - askUser summary ~2963: `synthetic: true`;
  - a new `forkFrom` next to `rewindTo` ~2970;
  - pass `onFork` to ChatView.
- Modify: `src/renderer/src/components/ChatView.tsx` (the rewind dialog ~1239 gains `mode: "rewind" | "fork"`)
- Create: `tests/fork-renderer.test.ts`

**Interfaces:**
- Consumes: `window.hv.forkSession`, `window.hv.rewindRestore`, `tailToolCallIds`, `hasRestorable`.
- Produces:
  - `stampPiTs(items: TranscriptItem[], piTs: number, text: string): TranscriptItem[]`
  - `forkScopes(preview: RewindPreview | null | undefined): RewindScope[]`
  - `FORK_DIALOG = { title: "Fork from this message?", body: "…", confirm: "Fork" }`

- [ ] **Step 1: Write the failing test** `tests/fork-renderer.test.ts`:

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import { forkScopes, stampPiTs } from "../src/renderer/src/fork";

const u = (text: string, extra = {}) => ({ kind: "user" as const, text, id: Math.random(), ...extra });

test("stampPiTs: the matching unstamped bubble gets Pi's timestamp; synthetic ones never do", () => {
  const items = [u("a", { piTs: 1 }), u("answers", { synthetic: true }), u("b"), u("c")] as never[];
  const out = stampPiTs(items, 42, "c") as Array<{ piTs?: number }>;
  expect(out[3].piTs).toBe(42);
  expect(out[2].piTs).toBeUndefined();
  // No text match (a prompt template expands): oldest unstamped real bubble.
  expect((stampPiTs(items, 7, "expanded body") as Array<{ piTs?: number }>)[2].piTs).toBe(7);
  expect((stampPiTs(items, 7, "x") as Array<{ piTs?: number }>)[1].piTs).toBeUndefined();
});

test("forkScopes: never 'files'; 'both' only when there is something to restore", () => {
  expect(forkScopes(null)).toEqual(["conversation"]);
  expect(forkScopes(undefined)).toEqual(["conversation"]);
  expect(forkScopes({ willRestore: ["a"], willDelete: [], stale: [] })).toEqual(["conversation", "both"]);
});

test("Fork shows only on a Pi-confirmed bubble inside context", () => {
  const t = fs.readFileSync("src/renderer/src/components/Transcript.tsx", "utf8");
  expect(t).toMatch(/onFork && it\.piTs != null && <ForkButton/);
  const restore = fs.readFileSync("src/renderer/src/restoreMap.ts", "utf8");
  expect(restore).toContain("piTs");
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** `src/renderer/src/fork.ts`:

```ts
import type { TranscriptItem } from "./components/Transcript";
import { hasRestorable, type RewindPreview, type RewindScope } from "./rewind";

/**
 * §17 round 28 — a live bubble learns Pi's own `message.timestamp` from the user-role
 * `message_end`; main finds the fork's entry by it (history.ts userEntryAt). Text first
 * (several may be unstamped), else the oldest unstamped one: a prompt template's bubble
 * shows what was TYPED while Pi's message holds the expansion. Synthetic bubbles (the
 * askUser answers summary) are not Pi user messages and never get a stamp.
 */
export function stampPiTs(items: TranscriptItem[], piTs: number, text: string): TranscriptItem[] {
  const open = (x: TranscriptItem): boolean => x.kind === "user" && x.piTs == null && !x.synthetic;
  let i = items.findIndex((x) => open(x) && x.kind === "user" && x.text.trim() === text.trim());
  if (i < 0) i = items.findIndex(open);
  if (i < 0) return items;
  const next = items.slice();
  next[i] = { ...items[i], piTs } as TranscriptItem;
  return next;
}

/** The Fork dialog mirrors Rewind's scopes, minus "Files only" — a fork always changes the conversation. */
export function forkScopes(preview: RewindPreview | null | undefined): RewindScope[] {
  return hasRestorable(preview) ? ["conversation", "both"] : ["conversation"];
}

export const FORK_DIALOG = {
  title: "Fork from this message?",
  body: "A new session opens in a new tab with everything before this message, and this message goes into its composer so you can edit and resend it. This session stays exactly as it is.",
  confirm: "Fork",
  bothHint: "Also roll the workspace back to before this message. This session shares those files.",
} as const;
```

  Then:
  - **Transcript.tsx.** Add `piTs?: number; synthetic?: boolean` to the user member of `TranscriptItem`. Add `ForkButton` (same shape as `RewindButton`, label "Fork from here", a branch icon from the existing icon set). Render `{onFork && it.piTs != null && <ForkButton onClick={() => onFork(it)} />}` inside the same hover span, under the same `outOfContext` guard that hides Rewind (~358).
  - **restoreMap.ts.** Map a user item's `ts` to `piTs` (restored timestamps ARE Pi's).
  - **App.tsx `message_end`.** When `m.role === "user"` and `typeof m.timestamp === "number"`: `setTranscripts((p) => ({ ...p, [sid]: stampPiTs(p[sid] ?? [], m.timestamp, stripInjectedBlocks(textOf(m.content))) }))`. `textOf` joins the `type:"text"` parts; reuse the helper App already uses for message text if there is one.
  - **App.tsx askUser summary** (~2963). Add `synthetic: true`.
  - **App.tsx `forkFrom(it, scope)`.** Find the owning `sid` exactly as `rewindTo` does. If `scope === "both"`, first `await window.hv.rewindRestore(sid, tailToolCallIds(items, idx))` and append the same "Files rewound — …" notice to the ORIGINAL. Then `const r = await window.hv.forkSession(sid, it.piTs!)`, `await openSessionRef.current?.(r.sessionId)`, and `setComposerInsert((prev) => ({ sid: r.sessionId, text: it.text, nonce: (prev?.nonce ?? 0) + 1 }))`. On error, append `ipcMessage(err)` as a notice in the original.
  - **ChatView.tsx.** Reuse the rewind dialog. A `pendingFork` state opens it in fork mode:
    - title, body and confirm button from `FORK_DIALOG`;
    - options from `forkScopes(rewindPreview)`, with the `both` hint `FORK_DIALOG.bothHint`;
    - same preview fetch, same stale list.
- [ ] **Step 4: Run again.** Expected: PASS. Run `tests/rewind*.test.ts` and `tests/restore*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(chat): Fork from a message — a new tab, the message back in the composer, files optional`

### Task 7: Renderer — Duplicate, the "Forked from" marker, pre-fork run cards

**Files:**
- Modify: `src/renderer/src/components/TabStrip.tsx`: `onDuplicate`, `canDuplicate` props; a "Duplicate" item after "Export as HTML…" (~466-477)
- Modify: `src/renderer/src/App.tsx`:
  - `duplicateSession` handler; pass the props at ~3738 and ~4040;
  - insert the marker where the reopen builds the compaction bubble (~2766).
- Modify: `src/renderer/src/fork.ts` (add `forkMarkerIndex`, `forkMarkerCopy`, `PRE_FORK_CARD_COPY`)
- Modify: `src/renderer/src/components/Transcript.tsx` (a `forkMarker` item kind)
- Modify: `src/renderer/src/components/ToolCard.tsx` (or `DelegationRunCard`, wherever a sub-agent card expands): `card.preFork`
- Create: `tests/fork-marker.test.ts`

**Interfaces:**
- Produces:
  - `forkMarkerIndex(items: Array<{ ts?: number }>, atMs: number): number` — the first item with `ts > atMs`, else `items.length`.
  - `forkMarkerCopy(originalTitle: string | null): string`
  - `PRE_FORK_CARD_COPY = "From the original session"`
  - `ToolCardData.preFork?: boolean`

- [ ] **Step 1: Write the failing test** `tests/fork-marker.test.ts`:

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import { forkMarkerCopy, forkMarkerIndex, PRE_FORK_CARD_COPY } from "../src/renderer/src/fork";

test("the marker sits before the first item newer than the fork", () => {
  expect(forkMarkerIndex([{ ts: 1 }, { ts: 5 }, { ts: 9 }], 5)).toBe(2);
  expect(forkMarkerIndex([{ ts: 1 }, {}, { ts: 3 }], 9)).toBe(3); // a duplicate: at the end
  expect(forkMarkerIndex([], 1)).toBe(0);
});

test("marker copy names the original, or says it's gone", () => {
  expect(forkMarkerCopy("Fix login")).toBe("Forked from Fix login");
  expect(forkMarkerCopy(null)).toBe("Forked from a deleted session");
});

test("a pre-fork sub-agent card never expands and names where it lives", () => {
  expect(PRE_FORK_CARD_COPY).toBe("From the original session");
  const src = fs.readFileSync("src/renderer/src/components/ToolCard.tsx", "utf8");
  expect(src).toContain("preFork");
});

test("Duplicate is disabled while the session is working", () => {
  const ts = fs.readFileSync("src/renderer/src/components/TabStrip.tsx", "utf8");
  expect(ts).toMatch(/disabled=\{!canDuplicate/);
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **fork.ts.** Add the three exports (pure; copy exactly as in the test).
  - **TabStrip.tsx.** Add `onDuplicate?: (sessionId: string) => void` and `canDuplicate?: (sessionId: string) => boolean`. Insert a "Duplicate" item after Export as HTML… with `disabled={!canDuplicate?.(sessionOf(menu.tab)!)}` and `title="Wait for the turn to finish"` when disabled. Act on `onMouseDown` + `preventDefault()`, like the other items (`.claude/rules/renderer-layers.md` "Menus").
  - **App.tsx.**
    - `canDuplicate = (sid) => !working(sid)`. Use the same "working" signal the sidebar dot uses (`sessionDot.ts`).
    - `duplicateSession = async (sid) => { const r = await window.hv.duplicateSession(sid); await openSessionRef.current?.(r.sessionId); }`. On error, show a toast/notice with `ipcMessage(err)`.
  - **Marker.** Where the reopen builds the compaction boundary bubble (~2766), when the session's meta has `forkedFrom`:
    - `const at = Date.parse(meta.forkedFrom.at); const i = forkMarkerIndex(items, at);`
    - insert `{ kind: "forkMarker", fromId: meta.forkedFrom.sessionId }` at `i`;
    - mark every `kind:"tool"` item before `i` with `card.preFork = true`.
  - **Transcript.tsx.** Render `forkMarker` like the compaction boundary bubble: `forkMarkerCopy(title)`, where `title` is the original's current title from the sessions list, or `null` if it's gone. When the original exists, the title is a button calling `openSessionRef`.
  - **ToolCard.** When `card.preFork` and the card is a delegation, render the collapsed line plus `PRE_FORK_CARD_COPY`, with no chevron and no expand.
- [ ] **Step 4: Run again.** Expected: PASS. Run `tests/tabstrip-menu.test.ts` and `tests/agents-renderer.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(sessions): Duplicate in the tab menu, a "Forked from" marker, and honest pre-fork run cards`

### Task 8: Auto-compaction — config, Pi's settings.json, live apply

**Files:**
- Modify: `src/main/subagentSettings.ts` (add the pure `withCompaction`; this file is already the home of Pi `settings.json` merges)
- Modify: `src/main/config.ts`: the `autoCompaction?: boolean` key, `getAutoCompaction()`, `setAutoCompaction()`, and `writePiCompactionSetting()` next to `writeSubagentSettings` (~861)
- Modify: `src/main/ipc.ts`: call `writePiCompactionSetting()` beside the startup `writeSubagentSettings()` (~877), plus handlers `hv:get-auto-compaction` / `hv:set-auto-compaction`
- Modify: `src/preload/index.ts`, `src/renderer/src/hv.d.ts`
- Create: `tests/auto-compaction-setting.test.ts`

**Interfaces:**
- Produces:
  - `withCompaction(settings: Record<string, unknown>, on: boolean): Record<string, unknown>`
  - `window.hv.getAutoCompaction(): Promise<boolean>`
  - `window.hv.setAutoCompaction(on: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test:**

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import { withCompaction } from "../src/main/subagentSettings";

test("withCompaction sets compaction.enabled and keeps every other key", () => {
  const s = { agentOverrides: { x: { enabled: false } }, compaction: { reserveTokens: 9000 } };
  expect(withCompaction(s, false)).toEqual({ agentOverrides: { x: { enabled: false } }, compaction: { reserveTokens: 9000, enabled: false } });
  expect(withCompaction({}, true)).toEqual({ compaction: { enabled: true } });
});

test("the switch is applied live to every running session", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const h = ipc.slice(ipc.indexOf('"hv:set-auto-compaction"'), ipc.indexOf('"hv:set-auto-compaction"') + 600);
  expect(h).toContain('type: "set_auto_compaction"');
  expect(h).toContain("writePiCompactionSetting()");
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**

```ts
// subagentSettings.ts
/**
 * §9 round 28 — Pi reads `compaction.enabled` (default true) from <agentDir>/settings.json, and its
 * own `set_auto_compaction` writes the same global key, so the switch is global by Pi's design.
 */
export function withCompaction(settings: Record<string, unknown>, on: boolean): Record<string, unknown> {
  const prev = (settings.compaction ?? {}) as Record<string, unknown>;
  return { ...settings, compaction: { ...prev, enabled: on } };
}
```

  - **config.ts.**
    - Add `autoCompaction?: boolean` to the config shape.
    - `getAutoCompaction = () => load().autoCompaction ?? true`
    - `setAutoCompaction(on)` saves the key.
    - `writePiCompactionSetting()` is the same read-merge-write as `writeSubagentSettings`, with `withCompaction(settings, getAutoCompaction())`.
  - **ipc.ts.** Call `writePiCompactionSetting()` at startup next to `writeSubagentSettings()`, then add:

```ts
  // §9 round 28: one global switch. Written to Pi's settings.json for every later spawn, and sent
  // live (Pi persists the same key itself, so the two can't disagree).
  ipcMain.handle("hv:get-auto-compaction", () => getAutoCompaction());
  ipcMain.handle("hv:set-auto-compaction", (_e, on: boolean) => {
    setAutoCompaction(!!on);
    writePiCompactionSetting();
    for (const id of manager.activeIds()) void (manager.get(id) as PiClient | null)?.send({ type: "set_auto_compaction", enabled: !!on }).catch(() => {});
  });
```

  `manager.activeIds()` is the same loop `hv:set-global-bypass` uses (~4416). Add the preload and `hv.d.ts` entries.
- [ ] **Step 4: Run again.** Expected: PASS. Add the `set_auto_compaction` wire note to `d1.md`: it persists to the GLOBAL `settings.json` (`settings-manager.js:600-607`); with it off, `_checkCompaction` returns before both the overflow and the threshold branches.
- [ ] **Step 5: Commit.** `feat(context): auto-compaction switch — global, on by default, written to Pi's settings and applied live`

### Task 9: Auto-compaction — the Models row and the overflow card

**Files:**
- Modify: `src/renderer/src/components/ModelsView.tsx` (a row after Thinking effort, ~716-740)
- Modify: `src/main/providerError.ts` (`ProviderErrorContext.autoCompaction?: boolean`; the `context_overflow` branch ~68)
- Modify: `src/renderer/src/App.tsx` (~1770: pass `autoCompaction` into `describeProviderError`; the card's "Compact now…" action)
- Create: `tests/provider-error-compaction.test.ts`

**Interfaces:**
- Consumes: `window.hv.getAutoCompaction` / `setAutoCompaction` (Task 8).
- Produces:
  - `COMPACTION_OFF_CONFIRM = { title: "Turn off automatic compaction?", body: "When the context fills up, the next message fails instead of being summarized.", confirm: "Turn off", cancel: "Keep it on" }`, exported from `ModelsView.tsx`.
  - `ProviderErrorInfo.action?: "compact"`

- [ ] **Step 1: Write the failing test:**

```ts
import { expect, test } from "vitest";
import { describeProviderError } from "../src/main/providerError";

const RAW = "400 This model's maximum context length is 131072 tokens";

test("overflow with auto-compaction OFF says so and offers Compact", () => {
  const i = describeProviderError(RAW, { autoCompaction: false });
  expect(i.kind).toBe("context_overflow");
  expect(i.hint).toBe("Automatic compaction is off. Compact now, or fork from an earlier message (hover it, then Fork).");
  expect(i.action).toBe("compact");
});

test("overflow with it ON keeps today's custom-endpoint hint and no action", () => {
  const i = describeProviderError(RAW, { autoCompaction: true });
  expect(i.hint).toMatch(/custom endpoint/);
  expect(i.action).toBeUndefined();
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **providerError.ts.** In the `context_overflow` branch, when `ctx.autoCompaction === false`:
    - return the hint above and `action: "compact"`;
    - set `doc: { slug: "first-session", anchor: "context-what-the-agent-can-see" }` (the anchor `session-view.md` already links to).
    - Add `action?: "compact"` to `ProviderErrorInfo` and `autoCompaction?: boolean` to `ProviderErrorContext`.
  - **App.tsx ~1770.** Pass `autoCompaction` (read once with `window.hv.getAutoCompaction()`, held in state, refreshed when the Models row changes it). Where the error card renders its buttons, `info.action === "compact"` adds a "Compact now…" button. It opens the same `CompactDialog` the Context panel's "Compact now…" opens (`ContextPanel.tsx:150-170`, `App.tsx:4072`).
  - **ModelsView.tsx.** Add a "Compact automatically" switch under Thinking effort, with sub-copy "When the context is nearly full, older messages are summarized so the session can keep going." Turning it OFF opens a dialog with `COMPACTION_OFF_CONFIRM`, using the `hv-overlay`/`hv-dialog` classes the Bypass confirm uses (`PermissionsView.tsx:42`). Turning it ON applies immediately.
- [ ] **Step 4: Run again.** Expected: PASS. Run `tests/provider-error*.test.ts` and `tests/modal-layer.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(context): Compact automatically on Models, and an overflow card that says compaction is off`

### Task 10: Docs, rules, wire notes — current-state

**Files:**
- Modify: `docs/guide/src/content/docs/session-view.md`: the Fork button, its two scopes, the new tab plus the composer, "Forked from …", pre-fork run cards, no Fork above a compaction boundary.
- Modify: `docs/guide/src/content/docs/workspaces-and-sessions.md`: Duplicate in the tab menu, disabled while working, both copies edit the same files.
- Modify: `docs/guide/src/content/docs/models.md`: the Compact automatically row and its confirm.
- Modify: `docs/guide/src/content/docs/first-session.md` (the Context section ~89-98): with the switch off, a full context fails the message, and what to do.
- Modify: `CLAUDE.md`: the Architecture bullet "Prompts never time out and never auto-allow, except under a full bypass (session `/hv-dangerous`, or …)". Replace it with: the persistent setting is the only way on; main's slash guard (`slashGuard.ts`) refuses a typed reserved command except `/hv-dangerous off`.
- Modify: `.claude/rules/permissions-plan.md`. Add one line: typed `/hv-dangerous on` is refused by `slashGuard.ts`; only main's `client.send` (`applyBypassLive`) and the banner's `/hv-dangerous off` reach the bridge command.
- Modify: `docs/validation/d1.md`, `docs/validation/fk1.md` (already started in Tasks 3 and 8).

- [ ] **Step 1:** Write the edits. Every quoted UI string must match the code exactly.
- [ ] **Step 2:** Run the `docs-reviewer` agent on the four guide pages and fix every finding.
- [ ] **Step 3: Commit.** `docs: fork, duplicate, the compaction switch and the slash guard in the guide, rules and wire notes`

### Task 11: Gate, live, GUI

- [ ] `L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
- [ ] Commit, then run `npm run live:why`.
  - If it prints anything: symlink `.env` (`ln -s ~/Documents/Github/HappyVibe/.env .env`), check `pgrep -fl electron-vite`, then run `npm run test:live` with `run_in_background`.
  - If it prints nothing: say the live batch isn't required. The fork contract (Task 3) is key-free and already runs in the gate.
- [ ] GUI pass with the assertions below (`/uicheck`, attach on 9333). Restart the dev server after main changes, and grep `out/main/index.js` for `hv:session-fork` before claiming it's live.

## GUI verification: what must be TRUE on screen

Run on a fresh `npm run dev` from this worktree: one workspace, one session "A" with three exchanged messages, the second of which ran a tool that edited a file. Plus one compacted session "C" (compact it from the Context panel).

**Session A's transcript**
1. Hovering any of A's three user bubbles shows **Copy**, **Rewind** and **Fork from here**.
2. **Absence:** in C, after **Load earlier messages**, the dimmed bubbles above the boundary show **no Fork button** (and no Rewind, as today).
3. **Absence:** an AskUserQuestion answer-summary bubble shows **no Fork button**.
4. Fork on A's 3rd message opens "Fork from this message?" with two options: **Conversation only** (selected) and **Conversation and files**. **Absence: no "Files only" option.**
5. Confirm **Conversation only**:
   - A new tab **"A (fork)"** opens and is focused. It shows messages 1–2 and their answers, then the marker **"Forked from A"**.
   - The composer holds message 3's text, unsent.
   - Tab A is still open and unchanged, with all three messages.
6. In "A (fork)", clicking **"Forked from A"** focuses session A.

**Cost (observed on the Stats page, not the pill)**
7. Note the Stats total. Fork A, then duplicate A, and send nothing: **the Stats total is unchanged** (no double count). "A (copy)"'s cost pill reads $0 until it sends.

**Fork mid-turn**
8. Send A a long task. While it's working, Fork from A's 1st message: the fork opens, and **A keeps working** (its spinner glyph never stops, the turn finishes).

**Duplicate (tab right-click menu)**
9. The menu lists **Duplicate** right after **Export as HTML…**. While A is working, **Duplicate is greyed out** with the tooltip "Wait for the turn to finish". Idle: it opens **"A (copy)"** with the full transcript, and the marker sits at the end.

**Pre-fork run cards**
10. In a session that ran a sub-agent, fork from a message after the delegation. In the fork, the delegation card reads **"From the original session"** and **does not expand** on click.

**Delete the original (regression sequence)**
11. Fork A → close "A (fork)" → delete A (trash → Delete permanently) → reopen "A (fork)" from the sidebar. The marker reads **"Forked from a deleted session"**, the transcript is intact, and the cost pill is unchanged from step 7.

**Tier 0 (observed on the pages that own the resources)**
12. With an MCP server signed in, type `/mcp logout <server>` in a chat. The notice **"/mcp is managed from the MCP page."** appears, and the text is back in the composer. **On the MCP page, the server is still signed in.**
13. Type `/hv-dangerous on`. The notice reads **"Bypass is turned on in Settings, with Bypass ALL permissions."** **Absence: no red banner.** The Permissions page's Bypass switch is still off.
14. Turn Bypass ALL permissions on (confirm), then click the red banner's **Turn off**. The banner disappears: the one allowed typed command still works.
15. On the Prompts page, a prompt file named `agents.md` shows **shadowed**.

**Auto-compaction (Settings → Models)**
16. **Compact automatically** sits under Thinking effort and is on. Turning it off shows "Turn off automatic compaction?" with exactly *"When the context fills up, the next message fails instead of being summarized."* **Keep it on** leaves it on. **Turn off** turns it off, and `<agentDir>/settings.json` now has `"compaction": { "enabled": false }`.
17. With it off, on a model with a small context window, push a session past its window. The error card reads **"Automatic compaction is off. Compact now, or fork from an earlier message (hover it, then Fork)."** with a **Compact now…** button that opens the compact dialog.

## Skipped (YAGNI)

- **Duplicate into a worktree.** Wait until asked; `resolveForkSpawn(cwd = worktree path)` is the whole change.
- **A project `.pi/settings.json` with `compaction.enabled`** overrides the global switch inside Pi. The app never writes there, and the UI doesn't detect it. Add detection if a user hits it.
- **Analytics events for fork/duplicate:** §39's catalog is closed. Add them in the analytics round if wanted.
- **Re-pointing the fork's header `parentSession`** (it names the deleted intermediate copy). Nothing reads it (`twChildren` scans `subagents/` only).
