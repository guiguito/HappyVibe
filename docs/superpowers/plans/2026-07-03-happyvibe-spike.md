# HappyVibe Spike (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron app that embeds a pinned Pi runtime and proves end-to-end that a UI can drive Pi over RPC and gate tool calls with user approval (validation gates V1–V7 of the Spike PRD).

**Architecture:** Three processes: Electron renderer (disposable React UI) ↔ Electron main (`PiClient` — typed JSON-lines RPC layer, built to keep) ↔ Pi subprocess (vendored, pinned, loaded with the HappyVibe bridge extension, built to keep). Pi is always spawned as a subprocess via Electron's own binary (`ELECTRON_RUN_AS_NODE=1`) so dev and packaged behavior are identical. Permission prompts flow over Pi's documented `extension_ui_request`/`extension_ui_response` RPC sub-protocol (Path A); the WebSocket sidecar (Path B) is only built if Task 3's empirical probe contradicts the docs.

**Tech Stack:** Electron + electron-vite + React + TypeScript (strict), Vitest for unit tests, electron-builder for packaging, `@earendil-works/pi-coding-agent@0.80.3` (pinned), provider: Anthropic (BYOK).

**Spec:** Notion — "HappyVibe Spike PRD — Walking Skeleton" (`391d33dfffca81afa86adf1e82360f64`). Validation results are logged in `docs/validation/RESULTS.md` and copied back to Notion in Task 15.

## Global Constraints

- Pi package pinned exactly: `@earendil-works/pi-coding-agent@0.80.3` (NOT `@mariozechner/pi-coding-agent` — that scope is stale). Never `^`/`~`.
- Node >= 20.6.0 required by Pi; develop with Node 22+.
- Pi subprocess is ALWAYS spawned as `process.execPath` with `env.ELECTRON_RUN_AS_NODE="1"` pointing at `pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` — never a system `node`, never imported as a library.
- Pi RPC start flags: `--mode rpc -e <abs path to happyvibe-bridge.ts> --session-dir <userData>/sessions`, `cwd` = the selected workspace folder.
- All RPC commands include an `id` field; responses echo it (`{"id":..,"type":"response","command":..,"success":..}`).
- Permission prompts never auto-allow and never time out. Deny is always safe.
- The renderer never touches Node APIs; all Pi traffic flows main→preload→renderer as typed IPC events.
- TypeScript `strict: true` everywhere. `pi-runtime/` is vendored and committed (including `package-lock.json`; `node_modules` is NOT committed — restored by `npm ci`).
- Commit after every green test cycle. Conventional-commit messages (`feat:`, `test:`, `chore:`, `docs:`).
- Validation gates V1–V7: when you complete a gate, append the result row to `docs/validation/RESULTS.md`. A failed gate = STOP, write down what failed, report — do not work around it silently.

## File Structure

```
/ (repo root = Electron app root)
├─ package.json / electron.vite.config.ts / tsconfig*.json   # Task 1 scaffold
├─ src/
│  ├─ main/
│  │  ├─ index.ts             # app lifecycle, window, wiring (T7)
│  │  ├─ config.ts            # API-key storage via safeStorage (T7)
│  │  ├─ ipc.ts               # IPC channel registration (T7)
│  │  └─ pi/
│  │     ├─ types.ts          # RPC protocol types (T4)
│  │     ├─ codec.ts          # NDJSON encode/decode, pure (T4)
│  │     ├─ PiClient.ts       # spawn/lifecycle/correlation/events (T5)
│  │     └─ spawn.ts          # resolvePiSpawn() dev vs packaged (T5, T14)
│  ├─ preload/index.ts        # contextBridge typed API (T7)
│  └─ renderer/src/
│     ├─ App.tsx              # setup → workspace → chat screens (T8)
│     ├─ components/Transcript.tsx      # streaming text (T8)
│     ├─ components/ToolCard.tsx        # V3 (T9)
│     ├─ components/PermissionModal.tsx # V5 (T10)
│     └─ components/StatsBadge.tsx      # tokens/cost (T11)
├─ pi-runtime/
│  ├─ package.json            # the ONE place Pi's version is pinned (T2)
│  └─ extensions/happyvibe-bridge.ts    # bridge extension (T6)
├─ scripts/
│  ├─ smoke-pi.mjs            # T2: does vendored Pi start?
│  └─ d1-probe.mjs            # T3: empirical D1 probe
├─ tests/
│  ├─ codec.test.ts           # T4
│  ├─ piclient.test.ts        # T5
│  ├─ bridge.test.ts          # T6 (gated on ANTHROPIC_API_KEY)
│  └─ fixtures/fake-pi.mjs    # scripted fake Pi for unit tests (T5)
└─ docs/validation/
   ├─ RESULTS.md              # V1–V7 log (created T1, filled throughout)
   └─ d1.md                   # T3 evidence
```

---

### Task 1: Scaffold the Electron app

**Files:**
- Create: entire electron-vite scaffold at repo root (`package.json`, `electron.vite.config.ts`, `src/main`, `src/preload`, `src/renderer`, tsconfigs)
- Create: `docs/validation/RESULTS.md`
- Modify: `package.json` (add vitest)

**Interfaces:**
- Produces: a running `npm run dev` Electron window; `npm test` runs Vitest; the directory layout later tasks assume.

- [ ] **Step 1: Scaffold electron-vite (repo root is non-empty, so scaffold via temp dir)**

```bash
cd /Users/guilhemduche/.superset/worktrees/HappyVibe/initial-greeting
npm create @quick-start/electron@latest /tmp/hv-scaffold -- --template react-ts --skip
rsync -a --ignore-existing /tmp/hv-scaffold/ .
rm -rf /tmp/hv-scaffold
npm install
```

- [ ] **Step 2: Verify dev mode boots**

Run: `npm run dev` — Expected: an Electron window opens with the template page. Close it.

- [ ] **Step 3: Add Vitest and a placeholder test**

```bash
npm install -D vitest
```

Add to `package.json` scripts: `"test": "vitest run"`.

Create `tests/smoke.test.ts`:
```typescript
import { expect, test } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```

Run: `npm test` — Expected: 1 passed.

- [ ] **Step 4: Create the validation log**

Create `docs/validation/RESULTS.md`:
```markdown
# HappyVibe Spike — Validation Results (V1–V7)

| Gate | Hypothesis | Result | Date | Notes |
|------|-----------|--------|------|-------|
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite app with vitest"
```

---

### Task 2: Vendor the pinned Pi runtime

**Files:**
- Create: `pi-runtime/package.json`, `pi-runtime/.gitignore`, `scripts/smoke-pi.mjs`

**Interfaces:**
- Produces: `pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` — the exact path every later task spawns. Constant exported later as `PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"`.

- [ ] **Step 1: Create the runtime package (exact pin)**

Create `pi-runtime/package.json`:
```json
{
  "name": "happyvibe-pi-runtime",
  "private": true,
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.80.3"
  }
}
```

Create `pi-runtime/.gitignore`:
```
node_modules/
```

```bash
cd pi-runtime && npm install && cd ..
```

- [ ] **Step 2: Write the smoke script (this is the V1 seed: can we execute the vendored CLI at all?)**

Create `scripts/smoke-pi.mjs`:
```javascript
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const r = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
if (r.status !== 0) { console.error("FAIL", r.stderr); process.exit(1); }
console.log("OK pi version:", r.stdout.trim());
```

- [ ] **Step 3: Run it**

Run: `node scripts/smoke-pi.mjs` — Expected: `OK pi version: 0.80.3` (exit 0). If the version differs, STOP — the pin is wrong.

- [ ] **Step 4: Commit**

```bash
git add pi-runtime scripts/smoke-pi.mjs
git commit -m "feat: vendor pinned pi runtime 0.80.3 with smoke script"
```

---

### Task 3: D1 probe — confirm `extension_ui_request` over RPC (Gate V4)

The docs say extension `ctx.ui.confirm()` surfaces over RPC as `extension_ui_request` on stdout and is answered by writing `extension_ui_response` to stdin. This task proves it empirically. **No API key needed** — the probe triggers UI at session start, before any model call.

**Files:**
- Create: `scripts/d1-probe-ext.ts`, `scripts/d1-probe.mjs`, `docs/validation/d1.md`

**Interfaces:**
- Produces: the confirmed wire shape of `extension_ui_request`/`extension_ui_response`, documented in `docs/validation/d1.md`. Task 6 and Task 10 copy the exact field names from that file.

- [ ] **Step 1: Write the probe extension**

Create `scripts/d1-probe-ext.ts`:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const ok = await ctx.ui.confirm("D1-PROBE", "Reply to prove ui-over-rpc works");
    // stderr, NOT stdout — stdout is the RPC protocol channel
    console.error(`D1-PROBE-RESULT: ${ok}`);
  });
}
```

- [ ] **Step 2: Write the probe driver**

Create `scripts/d1-probe.mjs`:
```javascript
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const ext = path.join(root, "scripts/d1-probe-ext.ts");

const child = spawn(process.execPath, [cli, "--mode", "rpc", "-e", ext, "--no-session"], {
  cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (d) => console.log("[stderr]", d.toString().trim()));
const rl = readline.createInterface({ input: child.stdout });
const timer = setTimeout(() => { console.log("VERDICT: NO ui request within 20s -> Path B"); child.kill(); }, 20000);

rl.on("line", (line) => {
  console.log("[stdout]", line);
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "extension_ui_request") {
    console.log("VERDICT: YES — extension_ui_request observed. Replying...");
    // Best-guess response shape; if Pi logs an error, adapt the field names
    // to what the request payload implies and re-run.
    child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: msg.id, value: true }) + "\n");
    clearTimeout(timer);
    setTimeout(() => child.kill(), 3000);
  }
});
child.on("exit", (c) => console.log("pi exited", c));
```

- [ ] **Step 3: Run the probe**

Run: `node scripts/d1-probe.mjs`

Expected: a `[stdout]` line containing `"type":"extension_ui_request"` with `"D1-PROBE"` in its payload, then `VERDICT: YES`, then `[stderr] D1-PROBE-RESULT: true` proving the response round-tripped. If the response shape is rejected (extension never logs its result), adjust the `extension_ui_response` fields to mirror the observed request (e.g. `confirmed`/`result` instead of `value`) and re-run until the round-trip completes.

- [ ] **Step 4: Record the evidence (Gate V4)**

Create `docs/validation/d1.md` containing: the verdict (YES → Path A / NO → Path B), the **verbatim** `extension_ui_request` JSON observed, and the **verbatim** working `extension_ui_response` JSON. Append to `docs/validation/RESULTS.md`:
```markdown
| V4 | D1: ctx.ui surfaces over RPC | PASS/FAIL | 2026-MM-DD | Path A confirmed; wire shapes in d1.md |
```

**If the verdict is NO:** STOP. Report to the user. Path B (WebSocket sidecar per the spec) must be designed into Tasks 6/10 before continuing — do not improvise it.

- [ ] **Step 5: Commit**

```bash
git add scripts/d1-probe-ext.ts scripts/d1-probe.mjs docs/validation
git commit -m "feat: D1 probe confirms extension_ui_request over RPC (V4)"
```

---

### Task 4: RPC protocol types + NDJSON codec (TDD)

**Files:**
- Create: `src/main/pi/types.ts`, `src/main/pi/codec.ts`
- Test: `tests/codec.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `PiEvent` (discriminated union on `type`), `PiCommand`, `PiResponse`, `ExtensionUiRequest`.
  - `codec.ts`: `class NdjsonDecoder { push(chunk: string): unknown[] }` (buffers partial lines, skips malformed JSON, never throws) and `encodeCommand(cmd: object): string` (JSON + `\n`).

- [ ] **Step 1: Write failing tests**

Create `tests/codec.test.ts`:
```typescript
import { describe, expect, test } from "vitest";
import { NdjsonDecoder, encodeCommand } from "../src/main/pi/codec";

describe("NdjsonDecoder", () => {
  test("parses complete lines", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"agent_start"}\n{"type":"agent_end"}\n'))
      .toEqual([{ type: "agent_start" }, { type: "agent_end" }]);
  });
  test("buffers partial lines across chunks", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"agent')).toEqual([]);
    expect(d.push('_start"}\n')).toEqual([{ type: "agent_start" }]);
  });
  test("skips malformed lines without throwing", () => {
    const d = new NdjsonDecoder();
    expect(d.push('not json\n{"type":"ok"}\n')).toEqual([{ type: "ok" }]);
  });
});

test("encodeCommand appends newline", () => {
  expect(encodeCommand({ id: "1", type: "prompt", message: "hi" }))
    .toBe('{"id":"1","type":"prompt","message":"hi"}\n');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — Expected: FAIL, cannot resolve `../src/main/pi/codec`.

- [ ] **Step 3: Implement types and codec**

Create `src/main/pi/types.ts`:
```typescript
// Deliberately loose: Pi's payloads are richer than we type. Unknown fields flow through.
export interface PiMessageBase { type: string; [k: string]: unknown }

export interface PiResponse extends PiMessageBase {
  type: "response"; id?: string; command: string; success: boolean; data?: unknown; error?: string;
}
export interface ExtensionUiRequest extends PiMessageBase {
  type: "extension_ui_request"; id: string; method: string; title?: string; options?: string[];
}
export type PiEvent = PiMessageBase; // message_update, tool_execution_*, agent_*, etc.

export type PiCommand =
  | { id: string; type: "prompt"; message: string }
  | { id: string; type: "abort" }
  | { id: string; type: "new_session" }
  | { id: string; type: "get_session_stats" };
```

Create `src/main/pi/codec.ts`:
```typescript
export class NdjsonDecoder {
  private buf = "";
  push(chunk: string): unknown[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    const out: unknown[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); }
      catch { console.error("[codec] skipped malformed line:", line.slice(0, 200)); }
    }
    return out;
  }
}
export function encodeCommand(cmd: object): string { return JSON.stringify(cmd) + "\n"; }
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: all codec tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pi/types.ts src/main/pi/codec.ts tests/codec.test.ts
git commit -m "feat: RPC protocol types and NDJSON codec"
```

---

### Task 5: PiClient — spawn, correlation, events, crash handling (TDD against fake Pi)

**Files:**
- Create: `src/main/pi/spawn.ts`, `src/main/pi/PiClient.ts`, `tests/fixtures/fake-pi.mjs`
- Test: `tests/piclient.test.ts`

**Interfaces:**
- Consumes: `NdjsonDecoder`, `encodeCommand`, types from Task 4.
- Produces:
  - `resolvePiSpawn(workspace: string): { execPath: string; args: string[]; env: Record<string,string>; cwd: string }` from `spawn.ts`.
  - `class PiClient extends EventEmitter` with: `start(): Promise<void>`, `stop(): void`, `send(cmd: Omit<PiCommand,"id">): Promise<PiResponse>` (auto-generates `id`, resolves on matching response), `respondUi(id: string, payload: object): void`, events `"event"` (every non-response message), `"ui-request"` (`extension_ui_request` messages), `"exit"` (`{code}`).
  - Constructor: `new PiClient(spawnSpec: ReturnType<typeof resolvePiSpawn>)` — tests inject a spec pointing at `fake-pi.mjs`.

- [ ] **Step 1: Write the fake Pi fixture**

Create `tests/fixtures/fake-pi.mjs`:
```javascript
// Scripted stand-in for `pi --mode rpc`: reads NDJSON commands on stdin,
// answers like Pi would. Also emits one garbage line to test resilience.
import readline from "node:readline";
process.stdout.write("GARBAGE NOT JSON\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const cmd = JSON.parse(line);
  if (cmd.type === "prompt") {
    process.stdout.write(JSON.stringify({ id: cmd.id, type: "response", command: "prompt", success: true }) + "\n");
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } }) + "\n");
    process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "fake" }) + "\n");
    process.stdout.write(JSON.stringify({ type: "agent_end", messages: [] }) + "\n");
  } else if (cmd.type === "extension_ui_response") {
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ui-ack" } }) + "\n");
  } else if (cmd.type === "crash_now") {
    process.exit(7);
  } else {
    process.stdout.write(JSON.stringify({ id: cmd.id, type: "response", command: cmd.type, success: true, data: {} }) + "\n");
  }
});
```

- [ ] **Step 2: Write failing tests**

Create `tests/piclient.test.ts`:
```typescript
import { afterEach, expect, test } from "vitest";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";

const fakeSpec = {
  execPath: process.execPath,
  args: [path.join(__dirname, "fixtures/fake-pi.mjs")],
  env: { ...process.env } as Record<string, string>,
  cwd: process.cwd(),
};
let client: PiClient;
afterEach(() => client?.stop());

test("send() correlates response by id and survives garbage lines", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const res = await client.send({ type: "get_session_stats" });
  expect(res.success).toBe(true);
});

test("emits events and ui-requests during a prompt", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const events: string[] = [];
  const uiReq = new Promise<string>((r) => client.on("ui-request", (m) => r(m.id)));
  client.on("event", (e) => events.push(e.type));
  await client.send({ type: "prompt", message: "hello" });
  expect(await uiReq).toBe("ui-1");
  await new Promise((r) => setTimeout(r, 200));
  expect(events).toContain("message_update");
  expect(events).toContain("agent_end");
});

test("emits exit on crash", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const exited = new Promise<number>((r) => client.on("exit", ({ code }) => r(code)));
  client.send({ type: "crash_now" } as never).catch(() => {});
  expect(await exited).toBe(7);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test` — Expected: FAIL, cannot resolve `../src/main/pi/PiClient`.

- [ ] **Step 4: Implement spawn.ts and PiClient**

Create `src/main/pi/spawn.ts`:
```typescript
import path from "node:path";

export const PI_CLI_RELPATH = "node_modules/@earendil-works/pi-coding-agent/dist/cli.js";

// Dev: <repo>/pi-runtime. Packaged: <resources>/pi-runtime (wired in Task 14).
export function piRuntimeDir(): string {
  const packaged = process.env.NODE_ENV === "production" && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return packaged ? path.join(packaged as string, "pi-runtime") : path.join(process.cwd(), "pi-runtime");
}

export function resolvePiSpawn(workspace: string, sessionDir: string, apiKey: string) {
  const runtime = piRuntimeDir();
  return {
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--session-dir", sessionDir,
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ANTHROPIC_API_KEY: apiKey } as Record<string, string>,
    cwd: workspace,
  };
}
```

Create `src/main/pi/PiClient.ts`:
```typescript
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { NdjsonDecoder, encodeCommand } from "./codec";
import type { PiResponse } from "./types";

interface SpawnSpec { execPath: string; args: string[]; env: Record<string, string>; cwd: string }
type Pending = { resolve: (r: PiResponse) => void; reject: (e: Error) => void };

export class PiClient extends EventEmitter {
  private child?: ChildProcess;
  private decoder = new NdjsonDecoder();
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private spec: SpawnSpec) { super(); }

  async start(): Promise<void> {
    this.child = spawn(this.spec.execPath, this.spec.args, {
      cwd: this.spec.cwd, env: this.spec.env, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => {
      for (const msg of this.decoder.push(chunk)) this.route(msg as Record<string, unknown>);
    });
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (d: string) => console.error("[pi:stderr]", d.trim()));
    this.child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error("pi exited"));
      this.pending.clear();
      this.emit("exit", { code });
    });
  }

  private route(msg: Record<string, unknown>): void {
    if (msg.type === "response" && typeof msg.id === "string" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      p.resolve(msg as unknown as PiResponse);
    } else if (msg.type === "extension_ui_request") {
      this.emit("ui-request", msg);
    } else {
      this.emit("event", msg);
    }
  }

  send(cmd: { type: string; [k: string]: unknown }): Promise<PiResponse> {
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(encodeCommand({ id, ...cmd }));
    });
  }

  // Field names must match docs/validation/d1.md (observed wire shape).
  respondUi(id: string, payload: object): void {
    this.child!.stdin!.write(encodeCommand({ type: "extension_ui_response", id, ...payload }));
  }

  stop(): void { this.child?.kill(); }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test` — Expected: all PASS (codec + piclient).

- [ ] **Step 6: Real-Pi handshake integration test (Gate V1 seed)**

Append to `tests/piclient.test.ts`:
```typescript
import fs from "node:fs";
import os from "node:os";

test("real vendored pi answers get_session_stats over RPC", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--mode", "rpc", "--no-session"],
    env: { ...process.env } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();
  const res = await client.send({ type: "get_session_stats" });
  expect(res.success).toBe(true);
}, 30_000);
```

Run: `npm test` — Expected: PASS. Append to `docs/validation/RESULTS.md`:
```markdown
| V1 | Spawn & handshake | PASS | 2026-MM-DD | Real pinned Pi answers RPC from tests |
```

- [ ] **Step 7: Commit**

```bash
git add src/main/pi tests
git commit -m "feat: PiClient RPC layer with fake-pi unit tests and real-pi handshake (V1)"
```

---

### Task 6: HappyVibe bridge extension (Path A)

**Files:**
- Create: `pi-runtime/extensions/happyvibe-bridge.ts`
- Test: `tests/bridge.test.ts` (gated on `ANTHROPIC_API_KEY`)

**Interfaces:**
- Consumes: the exact `extension_ui_request`/`extension_ui_response` wire shapes recorded in `docs/validation/d1.md` — read that file first and adjust the response payload in the test if it differs from `{ value }`.
- Produces: permission prompt with structured JSON title. The renderer (Task 10) parses `title` as JSON: `{ kind: "hv.permission", tool: string, summary: string }`. Options are exactly `["Allow", "Allow for session", "Deny"]` (indices 0/1/2). Session grants keyed by tool name.

- [ ] **Step 1: Write the bridge extension**

Create `pi-runtime/extensions/happyvibe-bridge.ts`:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Tools that never need approval in the spike.
const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls"]);
const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string") return input.command.slice(0, 300);
  return JSON.stringify(input).slice(0, 300);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName as string;
    if (SAFE_TOOLS.has(tool) || sessionGrants.has(tool)) return;

    const title = JSON.stringify({
      kind: "hv.permission",
      tool,
      summary: summarize(tool, (event.input ?? {}) as Record<string, unknown>),
    });
    // Surfaces as extension_ui_request over RPC (verified by D1 probe).
    // NO timeout: permission prompts wait indefinitely by design.
    const choice = await ctx.ui.select(title, ["Allow", "Allow for session", "Deny"]);

    if (choice === "Allow for session") { sessionGrants.add(tool); return; }
    if (choice === "Allow") return;
    return { block: true, reason: "User denied this action in HappyVibe" };
  });
}
```

- [ ] **Step 2: Write the gated end-to-end test (real Pi + real model)**

Create `tests/bridge.test.ts`:
```typescript
import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

const KEY = process.env.ANTHROPIC_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

test.skipIf(!KEY)("bridge intercepts bash; deny blocks and agent continues", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-bridge-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "anthropic", "--model", "haiku",
    ],
    env: { ...process.env, ANTHROPIC_API_KEY: KEY! } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();

  const gotPrompt = new Promise<{ id: string; title: string }>((resolve) =>
    client.on("ui-request", (m) => resolve(m as { id: string; title: string })));
  const done = new Promise<void>((resolve) =>
    client.on("event", (e) => { if (e.type === "agent_end") resolve(); }));

  await client.send({ type: "prompt", message: "Run exactly this shell command: touch forbidden.txt" });
  const req = await gotPrompt;
  expect(JSON.parse(req.title).kind).toBe("hv.permission");

  // Deny (index 2 / value "Deny") — adjust payload field to match docs/validation/d1.md
  client.respondUi(req.id, { value: "Deny" });
  await done;
  expect(fs.existsSync(path.join(tmp, "forbidden.txt"))).toBe(false);
}, 120_000);
```

- [ ] **Step 3: Run gated test**

Run: `ANTHROPIC_API_KEY=<your key> npm test -- bridge` — Expected: PASS — the ui-request arrives with parseable JSON title, deny prevents file creation, `agent_end` still arrives (agent continued gracefully). Without a key: test reports skipped.

- [ ] **Step 4: Commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts tests/bridge.test.ts
git commit -m "feat: happyvibe bridge extension gates tool calls via ui-over-rpc"
```

---

### Task 7: Electron main wiring — config, IPC, session lifecycle

**Files:**
- Create: `src/main/config.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts` (replace template content), `src/preload/index.ts` (replace template content)

**Interfaces:**
- Consumes: `PiClient`, `resolvePiSpawn` (Task 5).
- Produces the renderer-facing API (`window.hv`), the single contract Tasks 8–12 build against:
```typescript
interface HvApi {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  startSession(workspace: string): Promise<void>;
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  getStats(): Promise<unknown>;
  respondPermission(id: string, choice: "Allow" | "Allow for session" | "Deny"): void;
  restartPi(): Promise<void>;
  onPiEvent(cb: (e: Record<string, unknown>) => void): void;
  onUiRequest(cb: (r: { id: string; title: string; options: string[] }) => void): void;
  onPiExit(cb: (info: { code: number | null }) => void): void;
}
```

- [ ] **Step 1: Implement config storage (safeStorage)**

Create `src/main/config.ts`:
```typescript
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const file = () => path.join(app.getPath("userData"), "config.json");

export function getApiKey(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return safeStorage.decryptString(Buffer.from(raw.apiKey, "base64"));
  } catch { return null; }
}
export function setApiKey(key: string): void {
  const enc = safeStorage.encryptString(key).toString("base64");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ apiKey: enc }));
}
export function sessionDir(): string {
  const d = path.join(app.getPath("userData"), "sessions");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
```

- [ ] **Step 2: Implement IPC registration**

Create `src/main/ipc.ts`:
```typescript
import { BrowserWindow, dialog, ipcMain } from "electron";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { getApiKey, setApiKey, sessionDir } from "./config";

let client: PiClient | null = null;
let lastWorkspace: string | null = null;

function attach(win: BrowserWindow, c: PiClient): void {
  c.on("event", (e) => win.webContents.send("hv:pi-event", e));
  c.on("ui-request", (r) => win.webContents.send("hv:ui-request", r));
  c.on("exit", (info) => win.webContents.send("hv:pi-exit", info));
}

async function startSession(win: BrowserWindow, workspace: string): Promise<void> {
  client?.stop();
  lastWorkspace = workspace;
  client = new PiClient(resolvePiSpawn(workspace, sessionDir(), getApiKey() ?? ""));
  attach(win, client);
  await client.start();
}

export function registerIpc(win: BrowserWindow): void {
  ipcMain.handle("hv:get-api-key", () => getApiKey());
  ipcMain.handle("hv:set-api-key", (_e, key: string) => setApiKey(key));
  ipcMain.handle("hv:pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("hv:start-session", (_e, ws: string) => startSession(win, ws));
  ipcMain.handle("hv:restart-pi", () => lastWorkspace ? startSession(win, lastWorkspace) : Promise.resolve());
  ipcMain.handle("hv:prompt", async (_e, msg: string) => { await client?.send({ type: "prompt", message: msg }); });
  ipcMain.handle("hv:abort", async () => { await client?.send({ type: "abort" }); });
  ipcMain.handle("hv:get-stats", async () => (await client?.send({ type: "get_session_stats" }))?.data ?? null);
  // Payload field must match docs/validation/d1.md
  ipcMain.on("hv:respond-permission", (_e, id: string, choice: string) => client?.respondUi(id, { value: choice }));
}
```

- [ ] **Step 3: Replace `src/main/index.ts` window setup**

Keep the scaffold's window creation, add after window creation: `registerIpc(mainWindow)` (import from `./ipc`). Delete template demo IPC.

- [ ] **Step 4: Replace `src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hv", {
  getApiKey: () => ipcRenderer.invoke("hv:get-api-key"),
  setApiKey: (k: string) => ipcRenderer.invoke("hv:set-api-key", k),
  pickFolder: () => ipcRenderer.invoke("hv:pick-folder"),
  startSession: (ws: string) => ipcRenderer.invoke("hv:start-session", ws),
  prompt: (m: string) => ipcRenderer.invoke("hv:prompt", m),
  abort: () => ipcRenderer.invoke("hv:abort"),
  getStats: () => ipcRenderer.invoke("hv:get-stats"),
  restartPi: () => ipcRenderer.invoke("hv:restart-pi"),
  respondPermission: (id: string, choice: string) => ipcRenderer.send("hv:respond-permission", id, choice),
  onPiEvent: (cb: (e: never) => void) => ipcRenderer.on("hv:pi-event", (_e, p) => cb(p)),
  onUiRequest: (cb: (r: never) => void) => ipcRenderer.on("hv:ui-request", (_e, p) => cb(p)),
  onPiExit: (cb: (i: never) => void) => ipcRenderer.on("hv:pi-exit", (_e, p) => cb(p)),
});
```

- [ ] **Step 5: Verify boot**

Run: `npm run dev` — Expected: window opens, no main-process errors in terminal. In DevTools console: `window.hv` is defined.

- [ ] **Step 6: Commit**

```bash
git add src/main src/preload
git commit -m "feat: main-process wiring - config, IPC, pi session lifecycle"
```

---

### Task 8: Renderer — setup screen, folder picker, streaming chat (Gate V2)

**Files:**
- Create: `src/renderer/src/components/Transcript.tsx`
- Modify: `src/renderer/src/App.tsx` (replace template entirely)

**Interfaces:**
- Consumes: `window.hv` (Task 7). Declare it: create `src/renderer/src/hv.d.ts` with the `HvApi` interface from Task 7 and `declare global { interface Window { hv: HvApi } }`.
- Produces: `TranscriptItem` type used by Tasks 9–10: `{ kind: "user" | "assistant"; text: string } | { kind: "tool"; card: ToolCardData }`.

- [ ] **Step 1: Implement App.tsx state machine (setup → workspace → chat)**

Replace `src/renderer/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { Transcript, type TranscriptItem } from "./components/Transcript";

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<"loading" | "setup" | "folder" | "chat">("loading");
  const [keyInput, setKeyInput] = useState("");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState("");
  const streaming = useRef(false);

  useEffect(() => {
    window.hv.getApiKey().then((k) => setScreen(k ? "folder" : "setup"));
    window.hv.onPiEvent((e) => {
      const ame = (e as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (e.type === "message_update" && ame?.type === "text_delta" && ame.delta) {
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (streaming.current && last?.kind === "assistant") {
            return [...prev.slice(0, -1), { kind: "assistant", text: last.text + ame.delta }];
          }
          streaming.current = true;
          return [...prev, { kind: "assistant", text: ame.delta! }];
        });
      }
      if (e.type === "agent_end") streaming.current = false;
    });
  }, []);

  if (screen === "loading") return <p>…</p>;
  if (screen === "setup") return (
    <div className="screen">
      <h1>HappyVibe Spike</h1>
      <input placeholder="Anthropic API key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
      <button disabled={!keyInput.startsWith("sk-")} onClick={async () => { await window.hv.setApiKey(keyInput); setScreen("folder"); }}>Save</button>
    </div>
  );
  if (screen === "folder") return (
    <div className="screen">
      <button onClick={async () => {
        const ws = await window.hv.pickFolder();
        if (ws) { await window.hv.startSession(ws); setScreen("chat"); }
      }}>Open a project folder…</button>
    </div>
  );
  return (
    <div className="chat">
      <Transcript items={items} />
      <form onSubmit={async (ev) => {
        ev.preventDefault();
        setItems((p) => [...p, { kind: "user", text: input }]);
        streaming.current = false;
        const msg = input; setInput("");
        await window.hv.prompt(msg);
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask for a change…" />
        <button type="submit">Send</button>
        <button type="button" onClick={() => window.hv.abort()}>Abort</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Implement Transcript**

Create `src/renderer/src/components/Transcript.tsx`:
```tsx
export type TranscriptItem = { kind: "user" | "assistant"; text: string };

export function Transcript({ items }: { items: TranscriptItem[] }): JSX.Element {
  return (
    <div className="transcript">
      {items.map((it, i) => (
        <div key={i} className={`msg msg-${it.kind}`}>
          <b>{it.kind === "user" ? "You" : "Agent"}:</b> <pre>{it.text}</pre>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Manual gate V2**

Run: `npm run dev`. Enter your API key → pick any small project folder → send "What files are in this project? Answer in one sentence." Expected: assistant text streams in token-by-token (visibly incremental, not one blob).

Append to `docs/validation/RESULTS.md`:
```markdown
| V2 | Streaming chat | PASS | 2026-MM-DD | text_delta renders live in renderer |
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer docs/validation/RESULTS.md
git commit -m "feat: setup/folder/chat screens with live streaming (V2)"
```

---

### Task 9: Tool-call cards (Gate V3)

**Files:**
- Create: `src/renderer/src/components/ToolCard.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Transcript.tsx`

**Interfaces:**
- Produces: `ToolCardData = { toolCallId: string; toolName: string; args: unknown; status: "running" | "done" | "error"; result?: unknown }`. Transcript items become `{ kind: "user"|"assistant"; text: string } | { kind: "tool"; card: ToolCardData }`.

- [ ] **Step 1: Implement ToolCard**

Create `src/renderer/src/components/ToolCard.tsx`:
```tsx
import { useState } from "react";

export interface ToolCardData {
  toolCallId: string; toolName: string; args: unknown;
  status: "running" | "done" | "error"; result?: unknown;
}

export function ToolCard({ card }: { card: ToolCardData }): JSX.Element {
  const [open, setOpen] = useState(false);
  const icon = card.status === "running" ? "⏳" : card.status === "done" ? "✅" : "❌";
  return (
    <div className="tool-card">
      <div onClick={() => setOpen(!open)}>
        {icon} <b>{card.toolName}</b> <code>{JSON.stringify(card.args).slice(0, 120)}</code>
      </div>
      {open && <pre className="tool-raw">{JSON.stringify(card.result ?? card.args, null, 2)}</pre>}
    </div>
  );
}
```

- [ ] **Step 2: Wire tool events in App.tsx**

In the `onPiEvent` handler add (before the `message_update` branch):
```tsx
if (e.type === "tool_execution_start") {
  const t = e as { toolCallId: string; toolName: string; args?: unknown; input?: unknown };
  streaming.current = false;
  setItems((p) => [...p, { kind: "tool", card: { toolCallId: t.toolCallId, toolName: t.toolName, args: t.args ?? t.input, status: "running" } }]);
}
if (e.type === "tool_execution_end") {
  const t = e as { toolCallId: string; result?: unknown; isError?: boolean };
  setItems((p) => p.map((it) => it.kind === "tool" && it.card.toolCallId === t.toolCallId
    ? { ...it, card: { ...it.card, status: t.isError ? "error" : "done", result: t.result } } : it));
}
```
Update `Transcript.tsx` to render `{ kind: "tool" }` items with `<ToolCard card={it.card} />`, and widen `TranscriptItem` accordingly. Note: log the first real `tool_execution_start` event to the console and adjust field names (`args` vs `input`, `result` shape) to what Pi actually sends — then delete the log.

- [ ] **Step 3: Manual gate V3**

Run: `npm run dev`, prompt: "Read the README file and then create a file named hello.txt containing 'hi'". Expected: a card per tool call — name, args summary, ⏳→✅ transition, expandable raw result. The write/edit card's raw payload shows the change content (raw diff text is sufficient per spec).

Append to `RESULTS.md`:
```markdown
| V3 | Tool visibility | PASS | 2026-MM-DD | tool_execution_* renders as cards with status+payload |
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer docs/validation/RESULTS.md
git commit -m "feat: tool-call cards with status and expandable raw payload (V3)"
```

---

### Task 10: Permission modal + verdict round-trip (Gate V5)

**Files:**
- Create: `src/renderer/src/components/PermissionModal.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `hv:ui-request` events `{ id, title, options }` where `title` is the bridge's JSON (`{ kind: "hv.permission", tool, summary }`) — parse defensively: non-JSON titles render as plain text (that path is exercised in Task 13 by pi-permission-system prompts).
- Consumes: `window.hv.respondPermission(id, choice)` — choice is the exact option string.

- [ ] **Step 1: Implement PermissionModal**

Create `src/renderer/src/components/PermissionModal.tsx`:
```tsx
export interface UiRequest { id: string; title: string; options: string[] }

export function PermissionModal({ req, onChoice }: { req: UiRequest; onChoice: (c: string) => void }): JSX.Element {
  let tool = "", summary = req.title;
  try {
    const p = JSON.parse(req.title);
    if (p.kind === "hv.permission") { tool = p.tool; summary = p.summary; }
  } catch { /* plain-title prompt from another extension: render as-is */ }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>🔐 Permission required{tool && `: ${tool}`}</h2>
        <pre>{summary}</pre>
        {req.options.map((o) => (
          <button key={o} className={o === "Deny" ? "danger" : ""} onClick={() => onChoice(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App.tsx**

Add state `const [uiReq, setUiReq] = useState<UiRequest | null>(null);`, subscribe in the effect:
```tsx
window.hv.onUiRequest((r) => setUiReq(r));
```
Render at the end of the chat screen:
```tsx
{uiReq && <PermissionModal req={uiReq} onChoice={(c) => { window.hv.respondPermission(uiReq.id, c); setUiReq(null); }} />}
```

- [ ] **Step 3: Manual gate V5 (the heart of the spike)**

Run: `npm run dev`, then:
1. Prompt: "Run this exact shell command: rm -rf ./node_modules" → modal appears with the command → **Deny** → agent's next message acknowledges denial and continues (no crash, no hang); `node_modules` untouched.
2. Prompt: "Run 'echo hello' in the shell" → modal → **Allow** → command runs, card shows output.
3. Prompt it again after choosing **Allow for session** → no modal on the repeat.

Append to `RESULTS.md`:
```markdown
| V5 | Permission round-trip | PASS | 2026-MM-DD | Deny returns reason, agent continues; session grants persist |
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer docs/validation/RESULTS.md
git commit -m "feat: permission modal with allow/allow-session/deny round-trip (V5)"
```

---

### Task 11: Session stats badge (tokens + cost)

**Files:**
- Create: `src/renderer/src/components/StatsBadge.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.hv.getStats()` → Pi's `get_session_stats` data (`tokens.{input,output,cacheRead,cacheWrite,total}`, `cost`, context usage — log the first real payload and bind to actual field names).

- [ ] **Step 1: Implement StatsBadge**

Create `src/renderer/src/components/StatsBadge.tsx`:
```tsx
import { useEffect, useState } from "react";

export function StatsBadge({ refreshKey }: { refreshKey: number }): JSX.Element {
  const [stats, setStats] = useState<{ tokens?: { total?: number }; cost?: { total?: number } } | null>(null);
  useEffect(() => { window.hv.getStats().then((s) => setStats(s as never)); }, [refreshKey]);
  if (!stats) return <span className="stats">tokens: –</span>;
  return <span className="stats">tokens: {stats.tokens?.total ?? "?"} · cost: ${Number(stats.cost?.total ?? 0).toFixed(4)}</span>;
}
```

- [ ] **Step 2: Wire refresh on agent_end**

In App.tsx add `const [turns, setTurns] = useState(0);` — increment in the `agent_end` branch (`setTurns((t) => t + 1)`), render `<StatsBadge refreshKey={turns} />` in a corner of the chat screen. Adjust field bindings to the real `get_session_stats` payload observed in the console.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, send a prompt, after the turn ends the badge shows a nonzero token total.

- [ ] **Step 4: Commit**

```bash
git add src/renderer
git commit -m "feat: token/cost stats badge from get_session_stats"
```

---

### Task 12: Error handling — crash banner, restart, malformed input resilience

**Files:**
- Modify: `src/renderer/src/App.tsx`

(Malformed-line resilience already lives in `NdjsonDecoder` — tested in Task 4. Restart plumbing already exists as `hv:restart-pi` — Task 7.)

- [ ] **Step 1: Crash banner + restart button**

In App.tsx add `const [crashed, setCrashed] = useState<number | null>(null);` and subscribe:
```tsx
window.hv.onPiExit(({ code }) => setCrashed(code ?? -1));
```
Render above the transcript when `crashed !== null`:
```tsx
<div className="banner-error">
  ⚠️ The agent process stopped (code {crashed}).
  <button onClick={async () => { setCrashed(null); await window.hv.restartPi(); }}>Restart agent</button>
</div>
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, start a session, then from a terminal: `pkill -f "pi-coding-agent/dist/cli.js"`. Expected: banner appears, app does not crash; Restart brings a working session back (send a prompt to confirm).

- [ ] **Step 3: Commit**

```bash
git add src/renderer
git commit -m "feat: pi crash banner with one-click restart"
```

---

### Task 13: `pi-permission-system` coexistence (Gate V6)

**Files:**
- Modify: `pi-runtime/package.json` (add `@gotgenes/pi-permission-system`)
- Modify: `src/main/pi/spawn.ts` (second `-e` flag)
- Create: `docs/validation/v6.md`

**Interfaces:**
- Consumes: the plain-title prompt rendering path of `PermissionModal` (Task 10 Step 1's `catch` branch).

- [ ] **Step 1: Install and locate the extension entry**

```bash
cd pi-runtime && npm install @gotgenes/pi-permission-system@latest && cd ..
node -e "console.log(JSON.stringify(require('./pi-runtime/node_modules/@gotgenes/pi-permission-system/package.json').exports ?? require('./pi-runtime/node_modules/@gotgenes/pi-permission-system/package.json').main))"
```

Note the entry file path it prints — call it `<ENTRY>` below. Record the installed version in `docs/validation/v6.md`.

- [ ] **Step 2: Load it alongside the bridge**

In `src/main/pi/spawn.ts`, after the existing `-e` pair, add:
```typescript
      "-e", path.join(runtime, "node_modules/@gotgenes/pi-permission-system/<ENTRY>"),
```

- [ ] **Step 3: Configure an ask rule in the test workspace**

In a scratch workspace folder, create `.pi/extensions/pi-permission-system/config.json` (per the package README — check `pi-runtime/node_modules/@gotgenes/pi-permission-system/README.md` for the exact project-scope path and schema; adjust if it differs):
```json
{
  "bash": { "*": "allow", "git push*": "ask" },
  "tools": { "write": "ask" }
}
```

- [ ] **Step 4: Manual gate V6**

Run: `npm run dev`, open the scratch workspace:
1. Prompt: "Create a file called v6.txt containing 'test'" → a prompt from pi-permission-system surfaces in the HappyVibe modal (plain-title path) → Allow → file created.
2. Deny the same action on a second file → file NOT created; agent continues.
3. Most-restrictive-wins: with the config's `write: ask`, verify the HappyVibe bridge ALSO prompting for the same call does not let an allow from one layer bypass the ask/deny of the other (deny in either → blocked).

Record what actually happened (prompt shapes, ordering of the two extensions' prompts, any surprises) in `docs/validation/v6.md`. Append to `RESULTS.md`:
```markdown
| V6 | Enforcement coexistence | PASS/FAIL | 2026-MM-DD | see v6.md |
```

If pi-permission-system's prompts do NOT surface over RPC or the two extensions conflict: record FAIL with evidence and STOP — this changes the main PRD's permission architecture and the user must decide.

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json src/main/pi/spawn.ts docs/validation
git commit -m "feat: pi-permission-system coexistence validated (V6)"
```

---

### Task 14: Packaged build (Gate V7)

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (build script), `src/main/pi/spawn.ts` (packaged path already handled — verify)

**Interfaces:**
- Consumes: `piRuntimeDir()` from Task 5 — packaged mode resolves `<resources>/pi-runtime`.

- [ ] **Step 1: electron-builder config**

Create `electron-builder.yml`:
```yaml
appId: dev.happyvibe.spike
productName: HappyVibe Spike
directories:
  output: release
files:
  - out/**
extraResources:
  - from: pi-runtime
    to: pi-runtime
    filter: ["**/*", "!.gitignore"]
mac:
  target: dir        # unsigned .app in a folder; no dmg, no notarization
  identity: null
```

Add to `package.json` scripts: `"package": "electron-vite build && electron-builder --dir"`.

- [ ] **Step 2: Fix packaged-mode runtime resolution**

In `src/main/pi/spawn.ts`, replace the `piRuntimeDir` body with an Electron-native check (NODE_ENV is unreliable in packaged apps):
```typescript
import { app } from "electron";

export function piRuntimeDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "pi-runtime")
    : path.join(process.cwd(), "pi-runtime");
}
```
Note: `PiClient` unit tests inject their own spawn spec, so importing `electron` here must not break Vitest — keep `resolvePiSpawn`/`piRuntimeDir` in `spawn.ts` (imported only by `ipc.ts`, which tests never load). If Vitest complains about the `electron` import, split `piRuntimeDir` into `src/main/pi/runtimeDir.ts` and keep `spawn.ts` electron-free.

- [ ] **Step 3: Build and run the packaged app**

```bash
npm run package
open "release/mac-arm64/HappyVibe Spike.app"
```

Expected: the app launches from the bundle. Run the full scripted demo from the Spike PRD success criteria: key → folder → change request → streaming + tool cards → dangerous command modal → Deny (graceful) → Allow an edit → file lands on disk. All against the BUNDLED runtime (verify: `ps aux | grep pi-runtime` shows the path inside `…/Resources/pi-runtime/…`).

Append to `RESULTS.md`:
```markdown
| V7 | True embedding | PASS | 2026-MM-DD | packaged .app runs full demo on bundled runtime |
```

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml package.json src/main/pi docs/validation/RESULTS.md
git commit -m "feat: packaged unsigned macOS app with bundled pi runtime (V7)"
```

---

### Task 15: Validation report + PRD feedback loop

**Files:**
- Modify: `docs/validation/RESULTS.md` (final review)
- External: Notion Spike PRD (`391d33dfffca81afa86adf1e82360f64`) and main HappyVibe PRD (`391d33dfffca80a0a383e50792d51c0a`)

- [ ] **Step 1: Finalize RESULTS.md** — every gate V1–V7 has a row with result + date + note. V4's row links to `d1.md`, V6's to `v6.md`.

- [ ] **Step 2: Copy results to Notion** — fill the Result column of the validation table in the Spike PRD page; update the main PRD's "Reality Check" section: mark open items #2 (ctx.ui over RPC) and #3 (diff payload) with their empirical answers.

- [ ] **Step 3: Commit and report**

```bash
git add docs/validation
git commit -m "docs: final V1-V7 validation report"
```

Report to the user: gates passed/failed, surprises found, and whether the HappyVibe V1 architecture is confirmed feasible.

---

## Self-Review Notes

- **Spec coverage:** V1 (T5 step 6), V2 (T8), V3 (T9), V4 (T3), V5 (T10), V6 (T13), V7 (T14); error handling (T4 malformed lines, T12 crash/restart, permission prompts never time out — bridge passes no timeout); testing strategy (fixtures T5, gated headless T6, manual demo); BYOK/Anthropic-only (T7/T8); walking-skeleton split (PiClient + bridge tested, renderer manual-only) — all covered.
- **Known empiricism, by design:** exact `extension_ui_response` field name (T3 discovers, T5/T6/T7 carry a note to match `d1.md`), `tool_execution_*` field names (T9 logs once), `get_session_stats` payload shape (T11 logs once), pi-permission-system entry path + config schema (T13 inspects README). These are validation targets of the spike itself, not plan gaps.
- **Type consistency check:** `PiClient.send/respondUi/events` signatures match usage in T6 tests, T7 ipc, and fixtures; `TranscriptItem` widening in T9 matches T8's export; `respondPermission` choice strings match the bridge's option array exactly.
