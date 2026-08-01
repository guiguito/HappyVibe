# Compaction UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A compacted session restores to a visible boundary bubble instead of silently dropping most of its history, the pre-compaction history is loadable as explicitly out-of-context display, and a plan whose card was compacted away stays reachable.

**Architecture:** All new logic is **main-side and pure**. Pi records each compaction as a session-file entry carrying `firstKeptEntryId`, and Pi's own context rule is `[latest compaction] + entries from firstKeptEntryId onward` (`session-manager.js buildContextEntries`). A new pure module `src/main/history.ts` parses the session file (the same source `calls.ts` already uses), walks the `parentId` chain to the leaf, splits at the latest compaction, applies §9 removal marks with the bridge's own `filterMessages`, and reuses the existing `restoreItems()` to produce transcript items. **No bridge change, no new RPC, no pin bump.** The in-context half keeps coming from `get_messages` (already post-filter for removals); the file supplies only the earlier half.

**Tech Stack:** TypeScript, Electron (main + preload + React renderer), vitest, Tailwind.

## Global Constraints

- **No pin bump.** `pi-runtime` versions are untouched. No file under `pi-runtime/extensions/` is modified by this plan.
- **No respawn on any path.** None of these flows may call `startClient(meta, true)` on a live session — a `hv:session-reloading` notice would mean session grants were reset (PRD §10).
- **Streaming invariants** (CLAUDE.md): streaming text stays out of `transcripts`; tool cards update via the `toolIndex` map, never a full `.map()`. Any operation that **prepends** to `transcripts[sid]` invalidates every index in `toolIndex[sid]` and MUST rebuild that map.
- **Stable ids.** Every item pushed into `transcripts` gets `id: idCounter.current++`, or rewind (§9) and React keys break.
- **Path confinement.** Any new filesystem read goes through the existing `readSessionFile(sessionDir(), meta.piSessionFile)` helper — never a raw path from the renderer.
- **`src/main` changes need a dev-server RESTART.** A renderer reload does not rebuild main. Before claiming a main-side fix is live, grep the BUILT artifact (`out/main/index.js`), not the source.
- **Typecheck command:** `npm run typecheck` (node + web). Never hand-roll raw `tsc`.
- **Non-live test command:** `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
- **Copy, verbatim:** boundary bubble reads `Earlier messages were compacted into a summary.`; the loaded-region divider reads `earlier — not in the agent's context`; the load button reads `Load earlier messages`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/history.ts` **(new)** | Pure. Parse session JSONL → entries; leaf path via `parentId`; split at latest compaction; collect removal marks; produce the earlier-region `RestoreItem[]`. Electron-free so vitest can drive it. |
| `tests/history.test.ts` **(new)** | Unit coverage for the split, the path walk, mark filtering, and the multi-compaction case. |
| `src/main/ipc.ts` | Wire three things: log `context.compact` on `compaction_end`; return `compaction` + `planPath` from `hv:open-session`; add the `hv:load-earlier` handler. |
| `src/preload/index.ts` | Expose `loadEarlier`. |
| `src/renderer/src/hv.d.ts` | Types for the two changed/added IPC surfaces. |
| `src/renderer/src/components/Transcript.tsx` | New `boundary` transcript item; `outOfContext` dimming; the divider above the loaded region; suppress rewind on out-of-context items. |
| `src/renderer/src/App.tsx` | Consume the new `openSession` fields, prepend loaded items + rebuild `toolIndex`, hold `planPaths`. |
| `src/renderer/src/components/ChatView.tsx` | The active-plan pill + the panel it opens. |

---

### Task 1: `history.ts` — split the session file at the compaction boundary

**Files:**
- Create: `src/main/history.ts`
- Test: `tests/history.test.ts`

**Interfaces:**
- Consumes: `restoreItems`, `RestoreItem`, `RawMessage` from `./restore`; `filterMessages`, `type MarkKey`, `type AgentMessage` from `../../pi-runtime/extensions/hv-context`.
- Produces:
  - `interface FileEntry { type: string; id: string; parentId?: string | null; timestamp?: string; message?: RawMessage & { timestamp?: number }; firstKeptEntryId?: string; customType?: string; data?: unknown }`
  - `interface CompactionInfo { count: number; firstKeptEntryId: string }`
  - `parseEntries(jsonl: string | null | undefined): FileEntry[]`
  - `leafPath(entries: FileEntry[]): FileEntry[]`
  - `latestCompaction(path: FileEntry[]): CompactionInfo | null`
  - `earlierItems(jsonl: string | null | undefined): RestoreItem[]`
  - `compactionInfo(jsonl: string | null | undefined): CompactionInfo | null`

- [ ] **Step 1: Write the failing test**

Create `tests/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compactionInfo, earlierItems, latestCompaction, leafPath, parseEntries } from "../src/main/history";

/** Build a JSONL session file from a linear entry list (parentId chained). */
function jsonl(entries: Record<string, unknown>[]): string {
  let parent: string | null = null;
  return entries
    .map((e) => {
      const line = JSON.stringify({ parentId: parent, ...e });
      parent = e.id as string;
      return line;
    })
    .join("\n");
}

const userMsg = (id: string, text: string, ts: number): Record<string, unknown> => ({
  type: "message", id, timestamp: new Date(ts).toISOString(),
  message: { role: "user", content: [{ type: "text", text }], timestamp: ts },
});
const asstMsg = (id: string, text: string, ts: number): Record<string, unknown> => ({
  type: "message", id, timestamp: new Date(ts).toISOString(),
  message: { role: "assistant", content: [{ type: "text", text }], timestamp: ts },
});

describe("parseEntries", () => {
  it("skips a torn tail line instead of throwing", () => {
    const raw = `${jsonl([userMsg("a", "hi", 1)])}\n{"type":"mess`;
    expect(parseEntries(raw)).toHaveLength(1);
  });

  it("returns [] for empty or missing input", () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries("")).toEqual([]);
  });
});

describe("leafPath", () => {
  it("walks the parentId chain from the last entry back to the root", () => {
    const entries = parseEntries(jsonl([userMsg("a", "1", 1), asstMsg("b", "2", 2), userMsg("c", "3", 3)]));
    expect(leafPath(entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores entries that are not on the leaf's chain", () => {
    // "orphan" has no child; the leaf is "c", whose chain is a→b→c.
    const raw = [
      JSON.stringify({ type: "message", id: "a", parentId: null, message: { role: "user", content: "1", timestamp: 1 } }),
      JSON.stringify({ type: "message", id: "orphan", parentId: "a", message: { role: "user", content: "x", timestamp: 9 } }),
      JSON.stringify({ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: "2", timestamp: 2 } }),
      JSON.stringify({ type: "message", id: "c", parentId: "b", message: { role: "user", content: "3", timestamp: 3 } }),
    ].join("\n");
    expect(leafPath(parseEntries(raw)).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("latestCompaction", () => {
  it("is null when the session was never compacted", () => {
    expect(latestCompaction(leafPath(parseEntries(jsonl([userMsg("a", "1", 1)]))))).toBeNull();
  });

  it("reports the LAST compaction and counts them all", () => {
    const raw = jsonl([
      userMsg("a", "1", 1), asstMsg("b", "2", 2), userMsg("c", "3", 3),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "b" },
      userMsg("d", "4", 4),
      { type: "compaction", id: "k2", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(latestCompaction(leafPath(parseEntries(raw)))).toEqual({ count: 2, firstKeptEntryId: "c" });
  });
});

describe("earlierItems", () => {
  const compacted = jsonl([
    userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3), asstMsg("d", "four", 4),
    { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    userMsg("e", "five", 5),
  ]);

  it("returns only what is BEFORE firstKeptEntryId", () => {
    expect(earlierItems(compacted)).toEqual([
      { kind: "user", text: "one" },
      { kind: "assistant", text: "two" },
    ]);
  });

  it("is empty when the session was never compacted", () => {
    expect(earlierItems(jsonl([userMsg("a", "one", 1)]))).toEqual([]);
  });

  it("applies §9 removal marks — removed means removed in the earlier region too", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3),
      { type: "custom", id: "m1", customType: "hv-context-marks", data: { marks: ["msg:1"] } },
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([{ kind: "assistant", text: "two" }]);
  });

  it("takes the NEWEST marks entry (it is a full snapshot)", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3),
      { type: "custom", id: "m1", customType: "hv-context-marks", data: { marks: ["msg:1", "msg:2"] } },
      { type: "custom", id: "m2", customType: "hv-context-marks", data: { marks: ["msg:2"] } },
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([{ kind: "user", text: "one" }]);
  });

  it("drops plan cards — the pill is the route to a compacted-away plan", () => {
    const raw = jsonl([
      {
        type: "message", id: "a",
        message: {
          role: "assistant", timestamp: 1,
          content: [{ type: "toolCall", id: "tc1", name: "plan_complete", arguments: {} }],
        },
      },
      {
        type: "message", id: "b",
        message: { role: "toolResult", toolCallId: "tc1", toolName: "plan_complete", timestamp: 2,
          content: [{ type: "text", text: "Plan saved to .agents/plans/001-x.md. It is ready." }] },
      },
      userMsg("c", "three", 3),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([]);
  });
});

describe("compactionInfo", () => {
  it("matches latestCompaction without a full parse", () => {
    const raw = jsonl([
      userMsg("a", "1", 1), userMsg("b", "2", 2),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "b" },
    ]);
    expect(compactionInfo(raw)).toEqual({ count: 1, firstKeptEntryId: "b" });
    expect(compactionInfo(jsonl([userMsg("a", "1", 1)]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/history.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/history"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/history.ts`:

```ts
/**
 * Pre-compaction history, read from Pi's own session file. PURE + electron-free
 * so vitest can drive it (tests/history.test.ts).
 *
 * WHY the file and not an RPC: `get_messages` returns the LIVE context, so
 * everything compaction dropped is gone from it — the same reason the cost
 * ledger reads the file (calls.ts). The file keeps every entry.
 *
 * WHERE the boundary is: Pi writes a `compaction` entry carrying
 * `firstKeptEntryId`, and its own context rule (session-manager.js
 * buildContextEntries) is `[latest compaction] + entries from firstKeptEntryId
 * onward`. So the "earlier" region is exactly the leaf-path entries BEFORE
 * firstKeptEntryId of the LAST compaction. That is Pi's rule read back, not a
 * heuristic — and only the last compaction matters, because Pi ignores the
 * others.
 *
 * The in-context half is NOT rebuilt here: ipc.ts keeps taking it from
 * `get_messages`, which is already post-filter for §9 removals.
 */

import { restoreItems, type RawMessage, type RestoreItem } from "./restore";
import { filterMessages, type AgentMessage, type MarkKey } from "../../pi-runtime/extensions/hv-context";

/** The bridge's marks entry type (happyvibe-bridge.ts CONTEXT_MARKS_TYPE). */
const CONTEXT_MARKS_TYPE = "hv-context-marks";

export interface FileEntry {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: RawMessage & { timestamp?: number };
  /** compaction only — the first entry Pi KEPT in live context. */
  firstKeptEntryId?: string;
  /** custom only. */
  customType?: string;
  data?: unknown;
}

export interface CompactionInfo {
  /** How many compactions are on the leaf path (only the last one bounds context). */
  count: number;
  firstKeptEntryId: string;
}

/**
 * Parse the session JSONL. Tolerant by design: the file is appended live, so the
 * last line can be torn mid-write — a bad line is skipped, never thrown (same
 * contract as EventLog.read and parseCalls).
 */
export function parseEntries(jsonl: string | null | undefined): FileEntry[] {
  if (!jsonl) return [];
  const out: FileEntry[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const e = JSON.parse(raw) as FileEntry;
      if (e && typeof e.id === "string" && typeof e.type === "string") out.push(e);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The active branch: walk `parentId` from the last entry back to the root, then
 * reverse. HappyVibe never forks (§9 removal is mark-based, non-destructive), so
 * in practice the file is linear — but the walk is the same few lines and stays
 * correct if a branch ever appears.
 */
export function leafPath(entries: FileEntry[]): FileEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path: FileEntry[] = [];
  const seen = new Set<string>(); // cycle guard — a malformed file must not hang
  let cur: FileEntry | undefined = entries[entries.length - 1];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

/** The LAST compaction on the path (the only one that bounds context), + a count. */
export function latestCompaction(path: FileEntry[]): CompactionInfo | null {
  let count = 0;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type !== "compaction") continue;
    count += 1;
    if (typeof e.firstKeptEntryId === "string") firstKeptEntryId = e.firstKeptEntryId;
  }
  return count > 0 && firstKeptEntryId ? { count, firstKeptEntryId } : null;
}

/** Newest `hv-context-marks` entry wins — it is a full snapshot of the kill-set. */
function marksOn(path: FileEntry[]): Set<MarkKey> {
  let marks = new Set<MarkKey>();
  for (const e of path) {
    if ((e.type === "custom" || e.type === "custom_message") && e.customType === CONTEXT_MARKS_TYPE) {
      const m = (e.data as { marks?: MarkKey[] } | undefined)?.marks;
      if (Array.isArray(m)) marks = new Set(m);
    }
  }
  return marks;
}

/**
 * The pre-compaction transcript, for DISPLAY only. Empty when the session was
 * never compacted (nothing is missing, so there is nothing to load).
 *
 * Plan cards are dropped: the loaded region is explicitly marked as outside the
 * agent's context, and a PlanCard carries a live Implement button — a plan
 * that lands here is reached from the active-plan pill instead (§23).
 */
export function earlierItems(jsonl: string | null | undefined): RestoreItem[] {
  const path = leafPath(parseEntries(jsonl));
  const compaction = latestCompaction(path);
  if (!compaction) return [];
  const cut = path.findIndex((e) => e.id === compaction.firstKeptEntryId);
  if (cut < 0) return []; // firstKeptEntryId off-path — show nothing rather than guess
  const messages = path
    .slice(0, cut)
    .filter((e) => e.type === "message" && e.message)
    .map((e) => e.message as AgentMessage);
  const kept = filterMessages(messages, marksOn(path)) as unknown as RawMessage[];
  return restoreItems(kept).filter((it) => it.kind !== "plan");
}

/**
 * Is this session compacted, and how often? Scans lines rather than parsing all
 * of them — this runs on every session open, while earlierItems runs only when
 * the user asks for the history.
 */
export function compactionInfo(jsonl: string | null | undefined): CompactionInfo | null {
  if (!jsonl) return null;
  const lines = jsonl.split("\n").filter((l) => l.includes('"type":"compaction"'));
  if (lines.length === 0) return null;
  return latestCompaction(parseEntries(lines.join("\n")));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Verify against a REAL compacted session**

Run:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const f = process.env.HOME + "/Library/Application Support/HappyVibe/sessions/2026-07-05T19-53-04-458Z_019f33d7-6ec9-71ed-9944-f13616f0a6ed.jsonl";
const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const comps = lines.filter((e) => e.type === "compaction");
const byIdx = lines.findIndex((e) => e.id === comps[comps.length - 1].firstKeptEntryId);
console.log("entries", lines.length, "compactions", comps.length, "firstKept idx", byIdx);
'
```

Expected: `entries 517 compactions 2 firstKept idx 418` — the same numbers quoted in the PRD decision. If they differ, the split logic is reading the wrong field; stop and re-check before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/main/history.ts tests/history.test.ts
git commit -m "feat(history): split the session file at the compaction boundary"
```

---

### Task 2: audit `context.compact` so the bubble can name the reason

**Files:**
- Modify: `src/main/ipc.ts` (the `hv:pi-event` forwarding block, near the `compaction_end` / plan-notify handling around `ipc.ts:560-610`)
- Test: `tests/history.test.ts` (extend — the join helper is pure)

**Interfaces:**
- Consumes: `EventLog.append` (`src/main/log.ts`), the existing per-session pi-event stream in main.
- Produces: `compactionReason(logJsonl: string | null | undefined, sessionId: string, firstKeptEntryId: string): string | null` exported from `src/main/history.ts`.

**Why this task exists:** the compaction **file entry carries no `reason`** — only the live `compaction_end` event does (`result.firstKeptEntryId`, `reason: manual|threshold|overflow`). Verified by inspecting three real session files: keys are `type,id,parentId,timestamp,summary,firstKeptEntryId,tokensBefore,details,fromHook`. So main must record the reason when it sees the event, and join it back by `firstKeptEntryId`. This also closes a standing PRD §11 gap — the audit log is documented as recording "context compactions" and currently does not.

- [ ] **Step 1: Write the failing test**

Append to `tests/history.test.ts`:

```ts
import { compactionReason } from "../src/main/history";

describe("compactionReason", () => {
  const log = [
    JSON.stringify({ ts: "2026-08-01T10:00:00Z", type: "session.start", sessionId: "s1" }),
    JSON.stringify({ ts: "2026-08-01T10:01:00Z", type: "context.compact", sessionId: "s1", data: { reason: "threshold", firstKeptEntryId: "b" } }),
    JSON.stringify({ ts: "2026-08-01T10:02:00Z", type: "context.compact", sessionId: "other", data: { reason: "manual", firstKeptEntryId: "b" } }),
  ].join("\n");

  it("joins on sessionId + firstKeptEntryId", () => {
    expect(compactionReason(log, "s1", "b")).toBe("threshold");
  });

  it("is null for an unlogged (pre-feature) compaction", () => {
    expect(compactionReason(log, "s1", "zzz")).toBeNull();
    expect(compactionReason(null, "s1", "b")).toBeNull();
  });

  it("takes the LAST match when two compactions share a firstKeptEntryId", () => {
    const dup = `${log}\n${JSON.stringify({ ts: "2026-08-01T10:03:00Z", type: "context.compact", sessionId: "s1", data: { reason: "overflow", firstKeptEntryId: "b" } })}`;
    expect(compactionReason(dup, "s1", "b")).toBe("overflow");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/history.test.ts -t compactionReason`
Expected: FAIL — `compactionReason is not a function`.

- [ ] **Step 3: Add `compactionReason` to `src/main/history.ts`**

```ts
/**
 * The reason a compaction happened, from our own audit log. NOT in the session
 * file: Pi's `compaction` entry has no `reason` field — only the live
 * `compaction_end` event does, so main logs it (`context.compact`) and we join
 * back on `firstKeptEntryId`.
 *
 * ponytail: last match wins. Two compactions CAN share a firstKeptEntryId (seen
 * in a real session: entries 491 and 492 both pointed at 418), which makes the
 * join ambiguous; the newer reason is the better answer and the case is
 * cosmetic. Upgrade path = log the compaction entry id, once Pi exposes it on
 * the event.
 *
 * Null for any session compacted before this shipped — the bubble then simply
 * omits the reason rather than inventing one.
 */
export function compactionReason(
  logJsonl: string | null | undefined,
  sessionId: string,
  firstKeptEntryId: string,
): string | null {
  if (!logJsonl) return null;
  let reason: string | null = null;
  for (const raw of logJsonl.split("\n")) {
    if (!raw.trim() || !raw.includes('"context.compact"')) continue;
    try {
      const e = JSON.parse(raw) as { type?: string; sessionId?: string; data?: { reason?: string; firstKeptEntryId?: string } };
      if (e.type !== "context.compact" || e.sessionId !== sessionId) continue;
      if (e.data?.firstKeptEntryId !== firstKeptEntryId) continue;
      if (typeof e.data?.reason === "string") reason = e.data.reason;
    } catch {
      continue;
    }
  }
  return reason;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/history.test.ts -t compactionReason`
Expected: PASS, 3 tests.

- [ ] **Step 5: Log the event in `ipc.ts`**

Find the `compaction_end` handling in main's pi-event path. Main forwards pi-events to the renderer; add the audit append next to that forward — **not** in the renderer, which cannot write the log. If main has no `compaction_end` branch yet, add one in the same block that already inspects `e.type` for other event types:

```ts
// The compaction file entry carries no reason — only this event does. Log it
// so a restored boundary bubble can say WHY the history is gone (auto-compaction
// is on by Pi default, so "you didn't ask for this" is the honest label). Also
// closes the §11 promise that the audit log records context compactions.
if (e.type === "compaction_end") {
  const r = e as { reason?: string; result?: { firstKeptEntryId?: string; tokensBefore?: number } };
  void log.append({
    type: "context.compact",
    sessionId,
    workspaceId: index.get(sessionId)?.workspaceId,
    data: {
      reason: r.reason ?? "unknown",
      firstKeptEntryId: r.result?.firstKeptEntryId ?? null,
      tokensBefore: r.result?.tokensBefore ?? null,
    },
  });
}
```

- [ ] **Step 6: Typecheck and run the non-live suite**

Run: `npm run typecheck`
Run: `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/history.ts tests/history.test.ts src/main/ipc.ts
git commit -m "feat(audit): record context.compact with its reason (closes a §11 gap)"
```

---

### Task 3: main serves the boundary and the earlier region

**Files:**
- Modify: `src/main/ipc.ts:812-857` (`hv:open-session`), plus a new handler beside it
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/hv.d.ts`

**Interfaces:**
- Consumes: `compactionInfo`, `earlierItems`, `compactionReason` (Task 1 + 2); the existing `readSessionFile(sessionDir(), meta.piSessionFile)`, `planState`, `readPlan`.
- Produces:
  - `hv:open-session` now resolves `{ meta, messages, compaction, plan }` where
    `compaction: { count: number; reason: string | null } | null` and
    `plan: { path: string; status: string; done: number; total: number } | null`.
  - `hv:load-earlier(sessionId)` → `RestoreItem[]`.

- [ ] **Step 1: Extend `hv:open-session`**

In `src/main/ipc.ts`, change the handler's return type and body. The `loadMessages` closure is unchanged; add the two new fields at both return sites (the live-client path at `:850` and the resumed path at `:855`):

```ts
// The boundary the transcript must stop at. Derived, never persisted: the
// `compaction` entry IS the record, and Pi's own rule is
// [latest compaction] + entries from firstKeptEntryId onward. A line scan, not
// a full parse — this runs on every open.
const compactionFor = (m: SessionMeta): { count: number; reason: string | null } | null => {
  const info = compactionInfo(readSessionFile(sessionDir(), m.piSessionFile));
  if (!info) return null;
  return { count: info.count, reason: compactionReason(readLog(), sessionId, info.firstKeptEntryId) };
};

// §23: the active plan, so the pill survives a renderer reload (which gets no
// session_start replay). planState is main's, and outlives the renderer.
const planFor = (m: SessionMeta): { path: string; status: string; done: number; total: number } | null => {
  const p = planState.get(sessionId)?.planPath;
  if (!p) return null;
  const parsed = readPlan(workspaces.list(), m.workspaceId, p);
  return parsed ? { path: p, status: parsed.status, done: parsed.done, total: parsed.total } : null;
};
```

Then both returns become `{ meta, messages, compaction: compactionFor(meta), plan: planFor(meta) }`.

`readLog()` reads the EventLog file as a string — if `EventLog` has no sync read helper, use its existing async `read` and make `compactionFor` async, awaiting it at the two call sites (the handler is already `async`).

- [ ] **Step 2: Add the `hv:load-earlier` handler**

Place it directly after `hv:open-session`:

```ts
// Display-only pre-compaction history. Reads the session file (which keeps
// everything) rather than any RPC (which returns live context only). No client
// call, so no respawn and no session-grant reset — this works on a hibernated
// session too.
ipcMain.handle("hv:load-earlier", (_e, sessionId: string): RestoreItem[] => {
  const meta = index.get(sessionId);
  if (!meta) throw new Error("Unknown session");
  return earlierItems(readSessionFile(sessionDir(), meta.piSessionFile));
});
```

- [ ] **Step 3: Expose it in preload**

In `src/preload/index.ts`, beside the existing `openSession`:

```ts
loadEarlier: (sessionId: string) => ipcRenderer.invoke("hv:load-earlier", sessionId),
```

- [ ] **Step 4: Update the renderer types**

In `src/renderer/src/hv.d.ts`, change `openSession`'s return type to include the two new fields and add `loadEarlier`. Match the exact shapes from Step 1/2.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean once `App.tsx` destructures the new fields (it may need `const { meta, messages } = ...` left as-is — extra fields are structurally fine, so this should pass before Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(session): serve the compaction boundary and the earlier region"
```

---

### Task 4: the boundary bubble and the dimmed region

**Files:**
- Modify: `src/renderer/src/components/Transcript.tsx`
- Modify: `src/renderer/src/App.tsx:876-940` (the `selectSession` restore block) and the `TranscriptItem` consumers
- Test: `tests/transcript-boundary.test.ts` (new)

**Interfaces:**
- Consumes: `hv.loadEarlier`, the `compaction` field from `openSession` (Task 3).
- Produces: `TranscriptItem` gains `| { kind: "boundary"; id: number; compactions: number; reason: string | null; loaded: boolean }`, and every other variant gains an optional `outOfContext?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/transcript-boundary.test.ts` — the label logic is pure and testable without React:

```ts
import { describe, expect, it } from "vitest";
import { boundaryLabel } from "../src/renderer/src/components/Transcript";

describe("boundaryLabel", () => {
  it("states the plain fact when the reason is unknown", () => {
    expect(boundaryLabel(1, null)).toBe("Earlier messages were compacted into a summary.");
  });

  it("names an automatic compaction so it reads as not-your-doing", () => {
    expect(boundaryLabel(1, "threshold")).toBe(
      "Earlier messages were compacted into a summary — automatically, when the context filled up.",
    );
    expect(boundaryLabel(1, "overflow")).toBe(
      "Earlier messages were compacted into a summary — automatically, when the context overflowed.",
    );
  });

  it("names a manual compaction", () => {
    expect(boundaryLabel(1, "manual")).toBe("Earlier messages were compacted into a summary — you asked for this one.");
  });

  it("counts multiple compactions (only the last one bounds context)", () => {
    expect(boundaryLabel(3, null)).toBe("Earlier messages were compacted into a summary. 3 compactions in this session.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/transcript-boundary.test.ts`
Expected: FAIL — `boundaryLabel is not exported`.

- [ ] **Step 3: Implement the boundary in `Transcript.tsx`**

Add to the `TranscriptItem` union:

```ts
  | { kind: "boundary"; id: number; compactions: number; reason: string | null; loaded: boolean }
```

and add `outOfContext?: boolean` to the `user` / `assistant` / `tool` / `plan` variants.

Export the label helper:

```ts
/**
 * What the boundary bubble says. The reason matters because Pi's
 * auto-compaction is ON by default: a compaction the user never asked for has
 * to read as not-their-doing. Unknown reason (any session compacted before we
 * started logging it) states the plain fact instead of inventing one.
 */
export function boundaryLabel(compactions: number, reason: string | null): string {
  const base = "Earlier messages were compacted into a summary";
  const why =
    reason === "manual" ? `${base} — you asked for this one.`
    : reason === "threshold" ? `${base} — automatically, when the context filled up.`
    : reason === "overflow" ? `${base} — automatically, when the context overflowed.`
    : `${base}.`;
  return compactions > 1 ? `${why} ${compactions} compactions in this session.` : why;
}
```

Render the boundary item as a centered info bubble (reuse the existing `notice` styling — do NOT invent a new visual language), with a `Load earlier messages` button when `!loaded`. The button calls an `onLoadEarlier` prop threaded from `App.tsx`.

Render the divider: when the FIRST item in the list has `outOfContext`, emit a sticky header above it reading `earlier — not in the agent's context`. Out-of-context items render at reduced opacity (`opacity-60`) and **must not** show the rewind button — rewind targets Pi's live context, and these are not in it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/transcript-boundary.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it in `App.tsx`**

In `selectSession`, after building `items` from `messages`, prepend the boundary when `compaction` is non-null:

```ts
const withBoundary: TranscriptItem[] = compaction
  ? [{ kind: "boundary" as const, id: idCounter.current++, compactions: compaction.count, reason: compaction.reason, loaded: false }, ...items]
  : items;
```

Use `withBoundary` where `items` was used in the `setTranscripts` merge. The existing tool-index rebuild at the end of that block already recomputes positions, so it stays correct.

Add the loader:

```ts
// Display only — this never touches Pi's context. Prepends above the boundary,
// so EVERY toolIndex position for this session shifts: the map must be rebuilt
// or a late tool_execution_end would patch the wrong card.
const loadEarlier = async (sid: string): Promise<void> => {
  const earlier = await window.hv.loadEarlier(sid);
  setTranscripts((p) => {
    const items = p[sid] ?? [];
    if (items[0]?.kind !== "boundary" || items[0].loaded) return p;
    const restored: TranscriptItem[] = earlier.map((m) =>
      m.kind === "tool"
        ? { kind: "tool" as const, id: idCounter.current++, outOfContext: true,
            card: { toolCallId: m.toolCallId, toolName: m.toolName, args: m.args, status: m.error ? ("error" as const) : ("done" as const), result: m.result } }
        : { kind: m.kind, text: m.text, id: idCounter.current++, outOfContext: true },
    );
    const next = [...restored, { ...items[0], loaded: true }, ...items.slice(1)];
    const map = new Map<string, number>();
    next.forEach((it, i) => { if (it.kind === "tool") map.set(it.card.toolCallId, i); });
    toolIndex.current[sid] = map;
    return { ...p, [sid]: next };
  });
};
```

Thread `onLoadEarlier={() => void loadEarlier(sid)}` down to `Transcript`.

Note: `earlierItems` never returns `kind:"plan"`, so the map above needs no plan branch — but keep the `restoreItems` union exhaustive by letting TypeScript narrow on `m.kind === "tool"` vs the text kinds.

- [ ] **Step 6: Typecheck and run the non-live suite**

Run: `npm run typecheck`
Run: `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
Expected: both clean. Existing transcript/plan renderer tests must still pass — if one breaks on the widened union, fix the test's fixture, not the union.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Transcript.tsx src/renderer/src/App.tsx tests/transcript-boundary.test.ts
git commit -m "feat(transcript): compaction boundary bubble + display-only earlier history"
```

---

### Task 5: the active-plan pill

**Files:**
- Modify: `src/renderer/src/App.tsx` (hold the plan from `openSession`, pass it down)
- Modify: `src/renderer/src/components/ChatView.tsx:426-460` (the chip row beside the context bubble)

**Interfaces:**
- Consumes: the `plan` field from `openSession` (Task 3); the existing `hv:plan-changed` push; the existing self-contained `PlanCard`.
- Produces: no new exports — a UI affordance only.

- [ ] **Step 1: Hold the plan in `App.tsx`**

Add state beside the other per-session maps:

```ts
// §23: the session's active plan, so a plan whose card was compacted away stays
// reachable. Seeded from openSession (survives a renderer reload, which gets no
// session_start replay) and kept live by hv:plan-changed.
const [activePlan, setActivePlan] = useState<Record<string, PlanCardData>>({});
```

In `selectSession`, after `openSession` resolves:

```ts
if (plan) {
  setActivePlan((p) => ({ ...p, [id]: { sessionId: id, workspaceId: meta.workspaceId, path: plan.path, status: plan.status, done: plan.done, total: plan.total } }));
}
```

In the existing `hv.plan` notify branch (`App.tsx:379-391`), also record a restored plan — this is the respawn path, and it must NOT append a card (that was the bug fixed in `833a966`); it only feeds the pill:

```ts
if (pl.planPath && wsId) {
  setActivePlan((p) => ({ ...p, [sid]: p[sid]?.path === pl.planPath ? p[sid] : { sessionId: sid, workspaceId: wsId, path: pl.planPath!, status: "draft", done: 0, total: 0 } }));
}
```

The existing `hv:plan-changed` handler already patches transcript cards by path (`updatePlanCardByPath`); extend it to patch `activePlan` for the same path so the pill's status stays live.

- [ ] **Step 2: Render the pill in `ChatView.tsx`**

In the chip row that already renders the skills chip and the plan-mode badge, add — shown only for `draft` / `implementing`:

```tsx
{activePlan && (activePlan.status === "draft" || activePlan.status === "implementing") && (
  <button
    type="button"
    onClick={() => setPlanOpen((o) => !o)}
    title="The plan for this session — open it to implement, discard, or check progress"
    className="rounded-full border-2 border-line bg-card px-2 py-0.5 text-xs text-ink-soft hover:text-ink cursor-pointer shadow-sticker"
  >
    {activePlan.status === "draft" ? "plan ready" : `implementing ${activePlan.done}/${activePlan.total}`}
  </button>
)}
```

and below the top bar, when `planOpen`, render the existing card: `<PlanCard card={activePlan} onOpenFile={onOpenFile} />`. `PlanCard` is self-contained (it reads the file, drives Implement / Discard / Reopen through `window.hv` directly), so nothing else is needed.

- [ ] **Step 3: Typecheck and run the non-live suite**

Run: `npm run typecheck`
Run: `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/ChatView.tsx
git commit -m "feat(plan): active-plan pill keeps a compacted-away plan reachable"
```

---

### Task 6: full gate + GUI verification

**Files:** none (verification only).

- [ ] **Step 1: Full non-live gate**

Run: `npm run typecheck`
Run: `npx vitest run --exclude '**/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-bridge,agents-md-bridge,context-bridge,skills-bridge,subagent-context,subagent-async-bridge,subagent-discovery-bridge,permission-coexistence,mcp-bridge,plan-bridge}.test.ts'`
Run: `npm run build`
Expected: all clean.

- [ ] **Step 2: Live-Pi batch**

Re-derive the file list rather than trusting any hardcoded one:

Run: `grep -rl 'skipIf(!KEY' tests/ | xargs npx vitest run`
Expected: pass. One failure ⇒ rerun that file in isolation before calling it a regression.

**Note:** no bridge file was touched by this plan, so a live failure here is almost certainly contention, not a regression.

- [ ] **Step 3: Restart the dev server and confirm main is actually rebuilt**

`src/main` changed, so a renderer reload is not enough.

Run: `grep -c 'hv:load-earlier' out/main/index.js`
Expected: ≥1. If 0, the running main is stale — restart before believing any GUI result.

- [ ] **Step 4: GUI pass — the reproduction from the proposal**

Open the compacted session (`Neon Arkanoid Landing`, or any session whose file contains `"type":"compaction"`). Confirm, with a screenshot for each:

1. The transcript ends at the top with the boundary bubble, not with a silent truncation.
2. The bubble names the reason — or omits it cleanly for a pre-feature compaction (this session predates the logging, so expect the plain sentence).
3. `Load earlier messages` reveals the rest, dimmed, under the `earlier — not in the agent's context` divider.
4. Loaded messages show no rewind button.
5. No plan card appears in the loaded region; the plan is reachable from the pill and reports its real status (**not** "draft" if it was implemented).
6. Renderer reload (⌘R): the pill survives, the boundary is rebuilt, the loaded region collapses back (loading is per-view, not persisted).
7. **No `hv:session-reloading` notice appears on any of these paths** — one would mean a respawn reset the session's grants.

- [ ] **Step 5: Commit any GUI-pass corrections**

```bash
git add -A
git commit -m "fix(compaction): GUI-pass corrections"
```

---

## Self-Review

**Spec coverage** — each settled decision from the proposal maps to a task:

| Decision | Task |
|---|---|
| 1. Boundary bubble, derived not persisted | 1, 4 |
| 2. Bubble names the reason | 2, 4 |
| 3. Restore stops at the bubble | 3, 4 |
| 4. One bubble at the latest compaction, counting the rest | 1 (`latestCompaction`), 4 (`boundaryLabel`) |
| 5. "Load earlier" is display-only, dimmed | 3, 4 |
| 6. Removals apply to the loaded region too | 1 (`marksOn` + `filterMessages`) |
| 7. Restore-side parity only (live unchanged) | — deliberately no task; live behaviour is untouched |
| 8. Active-plan pill | 3 (`plan` field), 5 |

**Deferred, per the PRD:** disabling Pi's auto-compaction, live-session parity, a workspace Plans surface. No task implements these.

**Known risk to watch during Task 4:** prepending to `transcripts[sid]` invalidates `toolIndex[sid]`. The rebuild is written into the step; if it is dropped, a late `tool_execution_end` silently patches the wrong card — a class of bug the codebase has hit before.
