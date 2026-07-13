# MCP Server Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP server support via the vendored pi-mcp-adapter extension — configurable from the Agents & Tools page, with every MCP call flowing through the existing bridge permission gate, unwrapped in the UI.

**Architecture:** pi-mcp-adapter (exact-pinned in pi-runtime, loaded via a third `-e` flag) registers one proxy tool named `mcp`; the bridge unwraps proxy calls (`params.tool`) into per-MCP-tool permission decisions via a new pure module `hv-mcp.ts`. Config is standard `mcpServers` JSON: global tier at `agentDir()/mcp.json` (= `PI_CODING_AGENT_DIR/mcp.json`, an adapter default location), workspace tier at `<workspace>/.mcp.json` (adapter default, community-shareable). Spec: `docs/superpowers/specs/2026-07-13-mcp-support-design.md`.

**Tech Stack:** TypeScript, Electron, vitest, pi-coding-agent 0.80.3 RPC mode, pi-mcp-adapter 2.11.0.

## Global Constraints

- pi-mcp-adapter pinned EXACT (`2.11.0`) in `pi-runtime/package.json` — pin bumps gated by the contract tests, same as pi/pi-subagents.
- Both installs required: `npm install && (cd pi-runtime && npm ci)`.
- Live tests (real DeepSeek, `DEEPSEEK_API_KEY` in `.env`, skipIf-gated) run BATCHED in one vitest invocation, never under the full parallel suite. One live failure ⇒ rerun in isolation before calling it a regression.
- Full gate = `npx tsc --noEmit -p tsconfig.node.json` + `npx tsc --noEmit -p tsconfig.web.json` + non-live suite + live files batched + `npm run build`.
- Pure modules in `pi-runtime/extensions/hv-*.ts` have ZERO runtime imports beyond node builtins and are imported by both the bridge and src/main — logic never forks (pattern: hv-rules.ts).
- New bridge⇄main wire shapes go in `docs/validation/d1.md`; new validation findings get their own `docs/validation/` file.
- Every fs writer is path-confined; workspace paths never compared as raw strings.
- Permission prompts never auto-allow and never time out.

---

### Task 1: Vendor pi-mcp-adapter and wire the spawn flag

**Files:**
- Modify: `pi-runtime/package.json`
- Modify: `src/main/pi/spawn.ts` (constants at top, args array in `resolvePiSpawn`)
- Create: `tests/mcp-spawn.test.ts`

**Interfaces:**
- Produces: `PI_MCP_ADAPTER_RELPATH = "node_modules/pi-mcp-adapter/index.ts"` exported from `src/main/pi/spawn.ts`; spawn args now load the adapter as the third `-e` extension.

- [ ] **Step 1: Install the pinned dependency**

```bash
cd pi-runtime && npm install pi-mcp-adapter@2.11.0 --save-exact && cd ..
```

Verify `pi-runtime/package.json` dependencies now contain `"pi-mcp-adapter": "2.11.0"` (no caret) and `pi-runtime/node_modules/pi-mcp-adapter/index.ts` exists. If the entry file differs, check `pi-runtime/node_modules/pi-mcp-adapter/package.json` → `pi.extensions[0]` and use that relpath in Step 3 instead.

- [ ] **Step 2: Write the failing test**

Create `tests/mcp-spawn.test.ts`:

```typescript
import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { resolvePiSpawn, PI_MCP_ADAPTER_RELPATH } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

test("spawn loads pi-mcp-adapter as an -e extension after the bridge and pi-subagents", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime);
  const extensions = spec.args.filter((_, i) => spec.args[i - 1] === "-e");
  expect(extensions).toHaveLength(3);
  expect(extensions[2]).toBe(path.join(runtime, PI_MCP_ADAPTER_RELPATH));
});

test("pinned adapter entry file exists in the vendored tree", () => {
  expect(fs.existsSync(path.join(runtime, PI_MCP_ADAPTER_RELPATH))).toBe(true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/mcp-spawn.test.ts`
Expected: FAIL — `PI_MCP_ADAPTER_RELPATH` is not exported.

- [ ] **Step 4: Wire the spawn**

In `src/main/pi/spawn.ts`, after the `PI_SUBAGENT_BIN_RELPATH` constant (line 7), add:

```typescript
/** pi-mcp-adapter extension entry (its package.json `pi.extensions`) — MCP support. */
export const PI_MCP_ADAPTER_RELPATH = "node_modules/pi-mcp-adapter/index.ts";
```

In the `args` array of `resolvePiSpawn`, directly after the pi-subagents `-e` pair (line 49), add:

```typescript
      // MCP: pi-mcp-adapter registers the `mcp` proxy tool via registerTool,
      // so the bridge's permission gate applies (docs/validation/m1.md).
      // Config: PI_CODING_AGENT_DIR/mcp.json (global) + <cwd>/.mcp.json (workspace).
      "-e", path.join(runtimeDir, PI_MCP_ADAPTER_RELPATH),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp-spawn.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json
git add pi-runtime/package.json pi-runtime/package-lock.json src/main/pi/spawn.ts tests/mcp-spawn.test.ts
git commit -m "feat(mcp): vendor pi-mcp-adapter 2.11.0, load as third -e extension"
```

---

### Task 2: `hv-mcp.ts` pure unwrap module

**Files:**
- Create: `pi-runtime/extensions/hv-mcp.ts`
- Create: `tests/hv-mcp.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface McpCallInfo {
    kind: "invoke" | "discovery";
    /** Prefixed MCP tool name for invoke calls (e.g. "github_create_issue"). */
    mcpTool?: string;
    /** Tool name for rules/grants: "mcp:<mcpTool>" for invoke, "mcp" for discovery. */
    ruleTool: string;
    /** Human summary for the permission prompt / audit. */
    display: string;
  }
  function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/hv-mcp.test.ts`:

```typescript
import { expect, test } from "vitest";
import { unwrapMcpCall } from "../pi-runtime/extensions/hv-mcp";

test("invoke: params.tool present → per-tool ruleTool and display", () => {
  const r = unwrapMcpCall({ tool: "github_create_issue", args: '{"title":"x"}' });
  expect(r.kind).toBe("invoke");
  expect(r.mcpTool).toBe("github_create_issue");
  expect(r.ruleTool).toBe("mcp:github_create_issue");
  expect(r.display).toBe("MCP → github_create_issue");
});

test("discovery: search", () => {
  const r = unwrapMcpCall({ search: "screenshot" });
  expect(r.kind).toBe("discovery");
  expect(r.ruleTool).toBe("mcp");
  expect(r.display).toBe('MCP discovery: search "screenshot"');
});

test("discovery: describe / connect / action", () => {
  expect(unwrapMcpCall({ describe: "t" }).kind).toBe("discovery");
  expect(unwrapMcpCall({ connect: "srv" }).kind).toBe("discovery");
  expect(unwrapMcpCall({ action: "ui-messages" }).kind).toBe("discovery");
});

test("empty / unknown params default to discovery on the bare mcp tool", () => {
  const r = unwrapMcpCall({});
  expect(r.kind).toBe("discovery");
  expect(r.ruleTool).toBe("mcp");
});

test("non-string tool param is not an invoke", () => {
  expect(unwrapMcpCall({ tool: 42 }).kind).toBe("discovery");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hv-mcp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `pi-runtime/extensions/hv-mcp.ts`:

```typescript
/**
 * HappyVibe MCP proxy-call unwrapping — PURE module, zero imports.
 *
 * pi-mcp-adapter registers ONE proxy tool named `mcp`; the real MCP tool a
 * call targets is buried in its params ({tool, args}). This module maps a
 * proxy call to (a) a virtual tool name the hv-rules engine evaluates —
 * "mcp:<tool>" — so rules can target individual MCP tools (pattern
 * `mcp:github_*` etc.), and (b) a human display string, so the permission
 * prompt and tool cards never show a bare "mcp". Same discipline as
 * hv-rules.ts: imported by the bridge, src/renderer, and vitest.
 */

export interface McpCallInfo {
  kind: "invoke" | "discovery";
  mcpTool?: string;
  ruleTool: string;
  display: string;
}

export function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo {
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    return { kind: "invoke", mcpTool: tool, ruleTool: `mcp:${tool}`, display: `MCP → ${tool}` };
  }
  const str = (k: string): string | null =>
    typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : null;
  const search = str("search") ?? str("regex");
  if (search) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: search "${search}"` };
  const describe = str("describe");
  if (describe) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: describe ${describe}` };
  const connect = str("connect");
  if (connect) return { kind: "discovery", ruleTool: "mcp", display: `MCP: connect to ${connect}` };
  const action = str("action");
  if (action) return { kind: "discovery", ruleTool: "mcp", display: `MCP: ${action}` };
  return { kind: "discovery", ruleTool: "mcp", display: "MCP discovery" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hv-mcp.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add pi-runtime/extensions/hv-mcp.ts tests/hv-mcp.test.ts
git commit -m "feat(mcp): hv-mcp pure unwrap module — proxy call → per-tool rule name + display"
```

---

### Task 3: Bridge integration — permission gate unwraps MCP calls

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (the `pi.on("tool_call", …)` handler, ~line 250)

**Interfaces:**
- Consumes: `unwrapMcpCall` from `./hv-mcp` (Task 2).
- Produces: permission prompts for MCP invokes carry `tool: "mcp:<mcpTool>"` in the `hv.permission` title JSON; discovery calls are auto-allowed unless a rule matches; session grants for MCP are per-`mcp:<tool>`, not per-`mcp`.

- [ ] **Step 1: Add the import**

At the top of `pi-runtime/extensions/happyvibe-bridge.ts`, next to the existing `./hv-rules` import, add:

```typescript
import { unwrapMcpCall } from "./hv-mcp";
```

- [ ] **Step 2: Unwrap in the tool_call handler**

In the `pi.on("tool_call", …)` handler, replace the two lines

```typescript
    const tool = event.toolName as string;
    const input = (event.input ?? {}) as Record<string, unknown>;
    const summary = summarize(tool, input);
```

with

```typescript
    const tool = event.toolName as string;
    const input = (event.input ?? {}) as Record<string, unknown>;
    // MCP proxy unwrapping: rules, grants, prompts and audit all operate on
    // the real MCP tool ("mcp:<tool>"), never the bare proxy.
    const mcp = tool === "mcp" ? unwrapMcpCall(input) : null;
    const permTool = mcp?.ruleTool ?? tool;
    const summary = mcp?.display ?? summarize(tool, input);
```

Then, in the same handler, apply `permTool` everywhere the decision identity matters (leave the FILE_TOOLS / AGENTS.md discovery block using `tool` — MCP calls carry no file paths):

1. The rules evaluation becomes `evaluate(rules, { tool: permTool, input, workspace: process.cwd() })`.
2. Immediately AFTER the deny/allow rule branches and BEFORE the session-grant check, insert the discovery default-allow:

```typescript
    // MCP discovery (search/describe/connect) is read-only against servers the
    // user configured — allow by default; an explicit ask/deny rule still wins
    // (handled above), matching the SAFE_TOOLS safe-default semantics.
    if (mcp?.kind === "discovery" && v.source === "default") {
      audit(ctx.ui, { tool: permTool, summary, decision: "allow", source: "safe-default" });
      return;
    }
```

3. The session-grant check `sessionGrants.has(tool)` becomes `sessionGrants.has(permTool)`; the `sessionGrants.add(tool)` on "Allow for session" becomes `sessionGrants.add(permTool)`.
4. Every `audit(ctx.ui, { tool, … })` call in the handler passes `tool: permTool`.
5. The prompt title becomes `JSON.stringify({ kind: "hv.permission", tool: permTool, summary })`.

Match the audit-call argument shapes already present in the surrounding branches exactly — only the `tool` value changes.

- [ ] **Step 3: Typecheck + run the pure suites**

```bash
npx tsc --noEmit -p tsconfig.node.json
npx vitest run tests/hv-mcp.test.ts tests/hv-rules.test.ts
```

Expected: clean typecheck, PASS. (End-to-end verification of this wiring is Task 4's live test.)

- [ ] **Step 4: Commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts
git commit -m "feat(mcp): bridge unwraps mcp proxy calls — per-tool rules/grants/prompts, discovery safe-default"
```

---

### Task 4: Fixture MCP server + live contract test (the validation spike)

**Files:**
- Create: `tests/fixtures/mcp-echo-server.mjs`
- Create: `tests/mcp-bridge.test.ts`
- Create: `docs/validation/m1.md`
- Modify: `docs/validation/d1.md` (add the extended `hv.permission` tool-name convention)

**Interfaces:**
- Consumes: Task 1 spawn wiring, Task 3 bridge behavior.
- Produces: the Pi-upgrade contract test for the MCP path; `docs/validation/m1.md` recording RPC-mode findings.

- [ ] **Step 1: Write the fixture server**

Create `tests/fixtures/mcp-echo-server.mjs` — a dependency-free MCP stdio server (newline-delimited JSON-RPC; deterministic, no SDK so the wire shape is pinned):

```javascript
// Minimal MCP stdio server: one tool `echo`. Zero deps — the MCP stdio
// transport is newline-delimited JSON-RPC, so a hand-rolled server keeps the
// contract test hermetic and pins the wire shape.
import readline from "node:readline";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const TOOL = {
  name: "echo",
  description: "Echoes back the provided text.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") {
    send({ jsonrpc: "2.0", id: m.id, result: {
      protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "echo-fixture", version: "1.0.0" },
    }});
  } else if (m.method === "tools/list") {
    send({ jsonrpc: "2.0", id: m.id, result: { tools: [TOOL] } });
  } else if (m.method === "tools/call") {
    const text = m.params?.arguments?.text ?? "";
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } });
  } else if (m.method === "ping") {
    send({ jsonrpc: "2.0", id: m.id, result: {} });
  } else if (m.id !== undefined) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  } // notifications (initialized etc.) are ignored
});
```

Smoke-check it by hand:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node tests/fixtures/mcp-echo-server.mjs
```

Expected: two JSON lines — an initialize result, then a tools list containing `echo`.

- [ ] **Step 2: Write the live contract test**

Create `tests/mcp-bridge.test.ts` (mirrors the `tests/bridge.test.ts` harness):

```typescript
import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_MCP_ADAPTER_RELPATH } from "../src/main/pi/spawn";

// Tiny .env loader — keeps tests dependency-free
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

test.skipIf(!KEY)("mcp proxy call surfaces an unwrapped hv.permission prompt; Allow executes the tool", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcp-"));
  const fixture = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");
  // Workspace-tier config — exactly what the Agents & Tools page will write.
  fs.writeFileSync(
    path.join(tmp, ".mcp.json"),
    JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [fixture] } } }),
  );

  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "-e", path.join(runtime, PI_MCP_ADAPTER_RELPATH),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    // HOME/XDG redirected into tmp: the adapter also reads ~/.config/mcp/mcp.json
    // and ~/.pi/agent/mcp.json — the developer's real servers must not leak in.
    env: {
      ...process.env, DEEPSEEK_API_KEY: KEY!,
      HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"),
    } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();

  const prompts: Array<Record<string, unknown>> = [];
  let resolveInvokePrompt: (r: Record<string, unknown>) => void;
  const invokePrompt = new Promise<Record<string, unknown>>((r) => (resolveInvokePrompt = r));
  client.on("ui-request", (m) => {
    const req = m as Record<string, unknown>;
    if (req.method !== "select") return;
    try {
      const t = JSON.parse(req.title as string);
      if (t.kind !== "hv.permission") return;
      console.log("[mcp-bridge.test] hv.permission:", t);
      prompts.push(t);
      if (typeof t.tool === "string" && t.tool.startsWith("mcp:")) resolveInvokePrompt(req);
      else client.respondUi(req.id as string, { value: "Allow" }); // discovery etc. — let it through
    } catch { /* not ours */ }
  });
  const done = new Promise<void>((resolve) =>
    client.on("event", (e) => { if (e.type === "agent_end") resolve(); }));

  await client.send({
    type: "prompt",
    message:
      "You MUST use the mcp tool. First discover the exact tool name of the echo tool " +
      "on the echo server (use mcp with search or describe), then invoke it with text 'hello'. " +
      "Do not ask questions.",
  });

  const req = await invokePrompt;
  const title = JSON.parse((req as { title: string }).title);
  // The unwrapped per-tool identity — NEVER a bare "mcp" for an invoke.
  expect(title.tool).toMatch(/^mcp:/);
  expect(title.tool).toContain("echo");
  expect(String(title.summary)).toContain("MCP");
  client.respondUi((req as { id: string }).id, { value: "Allow" });

  await done;
  // Discovery calls must not have prompted: every recorded prompt except the
  // invoke is unexpected (discovery is safe-defaulted in the bridge).
  const nonInvoke = prompts.filter((p) => !(typeof p.tool === "string" && (p.tool as string).startsWith("mcp:")));
  expect(nonInvoke).toEqual([]);
}, 180_000);
```

- [ ] **Step 3: Run the live test**

Run: `npx vitest run tests/mcp-bridge.test.ts`
Expected: PASS (or SKIP without a key). Read the logged `hv.permission` objects — they are the empirical evidence for m1.md. If the model flakes on discovery-then-invoke, rerun in isolation once before changing the prompt.

- [ ] **Step 4: Record findings**

Create `docs/validation/m1.md` documenting what the run proved, in the style of the existing `docs/validation/*.md` files:

- pi-mcp-adapter 2.11.0 loads as a `-e` extension in `--mode rpc`; the `mcp` proxy tool registers via `registerTool` and its calls hit the bridge's `tool_call` gate (evidence: the logged prompt).
- Proxy invokes carry `{tool, args}`; the observed prefixed tool name for the fixture (record the actual `mcp:<name>` seen).
- Discovery calls (`search`/`describe`/`connect`) reach the gate and are safe-defaulted.
- Adapter config resolution observed: workspace `.mcp.json` honored; note that `~/.config/mcp/mcp.json` and `PI_CODING_AGENT_DIR/mcp.json` are also merged (why the test redirects HOME/XDG; the app accepts the user-global read — community-friendly, documented).
- `ctx.hasUI` findings: note whatever the run shows about the adapter's TUI-only paths (`/mcp` panel, elicitation/sampling dialogs) under RPC — anything broken goes here as an open item with the hv-envelope fallback from the spec.
- Open distribution item: stdio servers configured with `command: "node"`/npx need a runtime in the packaged app — same class as the pi-subagents shebang item in CLAUDE.md.

Also append to `docs/validation/d1.md`, next to the existing `hv.permission` shape: the `tool` field may now be a virtual name `mcp:<mcpTool>` for MCP proxy invokes (bare `mcp` for discovery).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/mcp-echo-server.mjs tests/mcp-bridge.test.ts docs/validation/m1.md docs/validation/d1.md
git commit -m "test(mcp): live contract test — proxy call gated + unwrapped; validation findings in m1.md"
```

---

### Task 5: Config plumbing — `src/main/mcp.ts` + IPC + preload

**Files:**
- Create: `src/main/mcp.ts`
- Create: `tests/mcp-config.test.ts`
- Modify: `src/main/ipc.ts` (new handlers next to the B6 agents/tools handlers, ~line 624)
- Modify: `src/preload/index.ts` (new bridge methods after the B6 block, ~line 97) and `src/preload/index.d.ts`
- Modify: `src/renderer/src/hv.d.ts` (mirror the preload surface — check which of the two d.ts files declares `window.hv` and edit that one; keep both in sync if both do)

**Interfaces:**
- Produces (from `src/main/mcp.ts`, electron-free — takes explicit paths, vitest-importable like spawn.ts):
  ```typescript
  interface McpServerConfig {
    command?: string; args?: string[]; env?: Record<string, string>;
    url?: string; headers?: Record<string, string>;
    directTools?: boolean | string[];
    [k: string]: unknown;
  }
  interface McpFile { mcpServers: Record<string, McpServerConfig>; [k: string]: unknown }
  function readMcpFile(file: string): McpFile
  function writeMcpServer(file: string, name: string, cfg: McpServerConfig | null): McpFile  // null = remove
  function isValidServerName(name: string): boolean  // /^[\w-]+$/
  ```
- Produces (preload): `window.hv.mcpGet(workspaceId?: string)` → `{ global: McpFile; workspace: McpFile | null }`; `window.hv.mcpSetServer(scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: McpServerConfig | null)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mcp-config.test.ts`:

```typescript
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMcpFile, writeMcpServer, isValidServerName } from "../src/main/mcp";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcpcfg-")), "mcp.json");

test("missing / invalid file reads as empty mcpServers", () => {
  expect(readMcpFile("/nonexistent/mcp.json")).toEqual({ mcpServers: {} });
  const f = tmpFile();
  fs.writeFileSync(f, "not json");
  expect(readMcpFile(f)).toEqual({ mcpServers: {} });
});

test("write → read round-trip; null removes", () => {
  const f = tmpFile();
  writeMcpServer(f, "echo", { command: "node", args: ["server.mjs"] });
  expect(readMcpFile(f).mcpServers.echo).toEqual({ command: "node", args: ["server.mjs"] });
  writeMcpServer(f, "echo", null);
  expect(readMcpFile(f).mcpServers).toEqual({});
});

test("unknown top-level keys survive (hand-edited imports/settings)", () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ imports: ["cursor"], mcpServers: {} }));
  writeMcpServer(f, "gh", { url: "https://example.com/mcp" });
  const out = readMcpFile(f);
  expect(out.imports).toEqual(["cursor"]);
  expect(out.mcpServers.gh.url).toBe("https://example.com/mcp");
});

test("server name validation", () => {
  expect(isValidServerName("github-mcp_2")).toBe(true);
  expect(isValidServerName("")).toBe(false);
  expect(isValidServerName("../evil")).toBe(false);
  expect(isValidServerName("a b")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/mcp.ts`**

```typescript
/**
 * MCP server config files (standard `mcpServers` JSON, the shape
 * pi-mcp-adapter and the wider ecosystem read). Electron-free — callers
 * (ipc.ts) supply the absolute file path: agentDir()/mcp.json for the global
 * tier, <workspace>/.mcp.json for the workspace tier. Unknown keys are
 * preserved so hand-edited files (imports, settings, lifecycle…) survive a
 * round-trip through the UI.
 */
import fs from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  directTools?: boolean | string[];
  [k: string]: unknown;
}

export interface McpFile {
  mcpServers: Record<string, McpServerConfig>;
  [k: string]: unknown;
}

export function isValidServerName(name: string): boolean {
  return /^[\w-]+$/.test(name);
}

export function readMcpFile(file: string): McpFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as McpFile;
    if (!raw || typeof raw !== "object") return { mcpServers: {} };
    if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) {
      return { ...raw, mcpServers: {} };
    }
    return raw;
  } catch {
    return { mcpServers: {} };
  }
}

/** Upsert (or remove, when cfg is null) one server. Returns the new file content. */
export function writeMcpServer(file: string, name: string, cfg: McpServerConfig | null): McpFile {
  if (!isValidServerName(name)) throw new Error(`invalid MCP server name: ${JSON.stringify(name)}`);
  const cur = readMcpFile(file);
  if (cfg) cur.mcpServers[name] = cfg;
  else delete cur.mcpServers[name];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n");
  return cur;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp-config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: IPC handlers**

In `src/main/ipc.ts`, import at the top: `import { readMcpFile, writeMcpServer, type McpServerConfig } from "./mcp";`. Next to the B6 `hv:list-agents`/`hv:list-tools` handlers add:

```typescript
  // ── MCP server config (adapter reads agentDir()/mcp.json + <ws>/.mcp.json;
  //    changes apply to NEW sessions — the adapter loads config at startup) ──
  const globalMcpFile = () => path.join(agentDir(), "mcp.json");
  // Workspace tier: fixed filename at the workspace root. Guard: only paths
  // registered in the WorkspaceRegistry are writable (same trust boundary as
  // the workspace-append handlers — mirror their guard exactly).
  const workspaceMcpFile = (workspaceId: string): string => {
    const known = workspaces.list().some(
      (p) => p.replace(/\/+$/, "") === workspaceId.replace(/\/+$/, ""),
    );
    if (!known) throw new Error("unknown workspace");
    return path.join(workspaceId, ".mcp.json");
  };

  ipcMain.handle("hv:mcp-get", (_e, workspaceId?: string) => ({
    global: readMcpFile(globalMcpFile()),
    workspace: workspaceId ? readMcpFile(workspaceMcpFile(workspaceId)) : null,
  }));

  ipcMain.handle(
    "hv:mcp-set-server",
    (_e, scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: McpServerConfig | null) => {
      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      writeMcpServer(file, name, cfg);
      void log.append({ type: "mcp.config", workspaceId: workspaceId ?? undefined,
        data: { scope, name, removed: cfg === null } });
      return readMcpFile(file);
    },
  );
```

Adjust to local reality: if the existing workspace-append handlers use a different registry guard, copy that guard verbatim instead of the inline `known` check; if `log.append` events use a different shape here, match it (frozen envelope `{ts,type,sessionId?,workspaceId?,data?}`).

- [ ] **Step 6: Preload + types**

In `src/preload/index.ts`, after the B6 block:

```typescript
  // ── MCP server config (additive). Changes apply to new sessions. ──
  mcpGet: (workspaceId?: string) => ipcRenderer.invoke("hv:mcp-get", workspaceId),
  mcpSetServer: (scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: unknown) =>
    ipcRenderer.invoke("hv:mcp-set-server", scope, workspaceId, name, cfg),
```

Mirror the two signatures in `src/preload/index.d.ts` and the renderer's `window.hv` declaration (`src/renderer/src/hv.d.ts`), typed as:

```typescript
  mcpGet(workspaceId?: string): Promise<{ global: McpFileLike; workspace: McpFileLike | null }>;
  mcpSetServer(
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
    cfg: Record<string, unknown> | null,
  ): Promise<McpFileLike>;
```

where `McpFileLike` is `{ mcpServers: Record<string, Record<string, unknown>> }` declared locally in the d.ts (renderer must not import from src/main).

- [ ] **Step 7: Full non-live gate + commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/mcp-config.test.ts tests/mcp-spawn.test.ts tests/hv-mcp.test.ts
git add src/main/mcp.ts src/main/ipc.ts src/preload/ src/renderer/src/hv.d.ts tests/mcp-config.test.ts
git commit -m "feat(mcp): mcp.json config plumbing — global + workspace tiers, IPC, preload"
```

---

### Task 6: Renderer — MCP tool labels + Agents & Tools page section

**Files:**
- Modify: `src/renderer/src/toolLabel.ts` (new `mcp` case in the switch)
- Modify: `tests/tool-label.test.ts` (new cases)
- Create: `src/renderer/src/components/McpServersSection.tsx`
- Modify: `src/renderer/src/components/AgentsView.tsx` (render the section after the Tools list)

**Interfaces:**
- Consumes: `window.hv.mcpGet` / `window.hv.mcpSetServer` (Task 5); `unwrapMcpCall` from `../../pi-runtime/extensions/hv-mcp` (Task 2 — pure module, same import discipline the renderer uses for hv-agents).
- Produces: tool cards / permission modal never show a bare "mcp"; MCP Servers CRUD UI.

- [ ] **Step 1: Failing toolLabel tests**

Append to `tests/tool-label.test.ts` (match the file's existing test style):

```typescript
test("mcp proxy invoke → unwrapped label, never bare 'mcp'", () => {
  const l = toolLabel("mcp", { tool: "github_create_issue", args: "{}" });
  expect(l.label).toBe("MCP → github_create_issue");
  expect(l.icon).toBe("wrench");
});

test("mcp discovery → discovery label", () => {
  expect(toolLabel("mcp", { search: "screenshot" }).label).toBe('MCP discovery: search "screenshot"');
});
```

Run: `npx vitest run tests/tool-label.test.ts` — expected: FAIL (falls through to `default:` → "Mcp").

- [ ] **Step 2: Implement the toolLabel case**

In `src/renderer/src/toolLabel.ts`, import `unwrapMcpCall` from the pure module (same relative-path style the renderer uses for other `pi-runtime/extensions/hv-*` imports — check how `agents.ts` imports `joinToolPermissions` and mirror it), then add before `default:`:

```typescript
    case "mcp": {
      // pi-mcp-adapter proxy — unwrap so cards show the real MCP tool.
      return { icon: "wrench", label: unwrapMcpCall(a).display };
    }
```

Run: `npx vitest run tests/tool-label.test.ts` — expected: PASS.

- [ ] **Step 3: MCP Servers section component**

Create `src/renderer/src/components/McpServersSection.tsx`:

```tsx
import { useEffect, useState } from "react";

interface McpServer { name: string; scope: "global" | "workspace"; cfg: Record<string, unknown> }

const flatten = (
  file: { mcpServers: Record<string, Record<string, unknown>> } | null,
  scope: "global" | "workspace",
): McpServer[] => Object.entries(file?.mcpServers ?? {}).map(([name, cfg]) => ({ name, scope, cfg }));

/**
 * MCP servers CRUD (Agents & Tools page). Writes the standard mcpServers JSON
 * the vendored pi-mcp-adapter reads: global → app agent dir mcp.json,
 * workspace → <workspace>/.mcp.json (shareable with other MCP hosts).
 * Config is read at session start — changes apply to NEW sessions.
 */
export function McpServersSection({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const r = await window.hv.mcpGet(workspaceId ?? undefined);
    setServers([...flatten(r.global, "global"), ...flatten(r.workspace, "workspace")]);
  };
  useEffect(() => { void refresh().catch((e) => setError(String(e))); }, [workspaceId]);

  const remove = async (s: McpServer): Promise<void> => {
    await window.hv.mcpSetServer(s.scope, s.scope === "workspace" ? workspaceId : null, s.name, null);
    await refresh();
  };

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-bold text-lg">MCP servers</h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
        >
          Add server
        </button>
      </div>
      <p className="text-xs text-ink-soft mb-3">
        Model Context Protocol servers add external tools. Changes apply to new sessions.
        Every MCP call still goes through your permission rules.
      </p>
      {error && <div className="mb-2 text-sm font-semibold text-berry">{error}</div>}
      {servers === null ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : servers.length === 0 ? (
        <p className="text-sm text-ink-soft">No MCP servers configured.</p>
      ) : (
        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden">
          {servers.map((s) => (
            <div key={`${s.scope}:${s.name}`} className="px-4 py-2.5 border-b border-line last:border-b-0 flex items-center gap-2">
              <span className="font-bold shrink-0">{s.name}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 bg-paper-deep text-ink-soft border-line shrink-0">
                {s.scope}
              </span>
              <span className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
                {typeof s.cfg.url === "string" ? s.cfg.url
                  : [s.cfg.command, ...((s.cfg.args as string[]) ?? [])].filter(Boolean).join(" ")}
              </span>
              {s.cfg.directTools ? (
                <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 bg-honey-soft text-tangerine-deep border-honey/60 shrink-0">
                  direct
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setEditing(s)}
                className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer shrink-0"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void remove(s).catch((e) => setError(String(e)))}
                className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 text-berry hover:bg-berry-soft/40 cursor-pointer shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <McpServerEditor
          server={editing === "new" ? null : editing}
          workspaceId={workspaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
    </div>
  );
}

function McpServerEditor({
  server, workspaceId, onClose, onSaved,
}: {
  server: McpServer | null;
  workspaceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const cfg = server?.cfg ?? {};
  const [name, setName] = useState(server?.name ?? "");
  const [scope, setScope] = useState<"global" | "workspace">(server?.scope ?? "global");
  const [kind, setKind] = useState<"stdio" | "http">(typeof cfg.url === "string" ? "http" : "stdio");
  const [command, setCommand] = useState(
    [cfg.command, ...((cfg.args as string[]) ?? [])].filter(Boolean).join(" "),
  );
  const [url, setUrl] = useState(typeof cfg.url === "string" ? cfg.url : "");
  const [env, setEnv] = useState(
    Object.entries((cfg.env as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
  );
  const [direct, setDirect] = useState(Boolean(cfg.directTools));
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    try {
      if (!/^[\w-]+$/.test(name)) throw new Error("Name: letters, digits, - and _ only");
      const envObj: Record<string, string> = {};
      for (const line of env.split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) envObj[m[1]] = m[2];
      }
      const [cmd, ...args] = command.trim().split(/\s+/);
      const next: Record<string, unknown> = {
        ...cfg, // preserve advanced hand-edited keys (lifecycle, auth, …)
        ...(kind === "stdio"
          ? { command: cmd, args: args.length ? args : undefined, url: undefined, headers: undefined }
          : { url, command: undefined, args: undefined, env: undefined }),
        ...(kind === "stdio" && Object.keys(envObj).length ? { env: envObj } : {}),
        ...(direct ? { directTools: true } : { directTools: undefined }),
      };
      for (const k of Object.keys(next)) next[k] === undefined && delete next[k];
      if (kind === "stdio" && !cmd) throw new Error("Command is required");
      if (kind === "http" && !url) throw new Error("URL is required");
      // Scope change on an existing server = write to new scope, remove from old.
      await window.hv.mcpSetServer(scope, scope === "workspace" ? workspaceId : null, name, next);
      if (server && (server.scope !== scope || server.name !== name)) {
        await window.hv.mcpSetServer(server.scope, server.scope === "workspace" ? workspaceId : null, server.name, null);
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    }
  };

  const inputCls =
    "rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-tangerine w-full";
  const labelCls = "text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1 mt-3 block";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-black text-xl leading-tight mb-1">{server ? `Edit ${server.name}` : "Add MCP server"}</h2>
        <p className="text-sm text-ink-soft">Applies to new sessions.</p>
        {error && <div className="mt-2 text-sm font-semibold text-berry">{error}</div>}

        <label className={labelCls}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="github" spellCheck={false} />

        <label className={labelCls}>Scope</label>
        <select value={scope} onChange={(e) => setScope(e.target.value as "global" | "workspace")} className={inputCls}>
          <option value="global">Global (all workspaces)</option>
          <option value="workspace" disabled={!workspaceId}>This workspace (.mcp.json — shareable)</option>
        </select>

        <label className={labelCls}>Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as "stdio" | "http")} className={inputCls}>
          <option value="stdio">Local command (stdio)</option>
          <option value="http">Remote URL (HTTP)</option>
        </select>

        {kind === "stdio" ? (
          <>
            <label className={labelCls}>Command</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)} className={inputCls}
              placeholder="npx -y @modelcontextprotocol/server-github" spellCheck={false} />
            <label className={labelCls}>Environment (KEY=value per line)</label>
            <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} className={inputCls} spellCheck={false} />
          </>
        ) : (
          <>
            <label className={labelCls}>URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls}
              placeholder="https://example.com/mcp" spellCheck={false} />
          </>
        )}

        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
          <span className="text-sm font-bold">Expose tools directly</span>
          <span className="text-xs text-ink-soft">— each tool becomes first-class (costs context tokens per tool)</span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border-2 border-line px-4 py-2 text-sm font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer">
            Cancel
          </button>
          <button type="button" onClick={() => void save()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render it in AgentsView**

In `src/renderer/src/components/AgentsView.tsx`: `import { McpServersSection } from "./McpServersSection";` and add `<McpServersSection workspaceId={workspaceId} />` directly after the Tools list `</div>` (inside the `max-w-3xl` container, before the closing tag).

- [ ] **Step 5: Gate + commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run tests/tool-label.test.ts
npm run build
git add src/renderer/src/toolLabel.ts src/renderer/src/components/McpServersSection.tsx src/renderer/src/components/AgentsView.tsx tests/tool-label.test.ts
git commit -m "feat(mcp): Agents & Tools MCP servers section + unwrapped tool-card labels"
```

---

### Task 7: Docs — CLAUDE.md, PRD fold, full gate

**Files:**
- Modify: `CLAUDE.md` (Tests + Architecture + Gotchas lines)
- Modify: `docs/prd.md` (fold the locked decision in place — NEVER rewrite wholesale)

- [ ] **Step 1: CLAUDE.md**

- Tests bullet: add `mcp-bridge` to the live-Pi test file list.
- Architecture bullet (pi-runtime line): mention `pi-mcp-adapter` (pinned exact) alongside pi-subagents.
- Gotchas: add one line — "MCP: the adapter's proxy tool is `mcp`; the bridge unwraps to `mcp:<tool>` for rules/grants/prompts (hv-mcp.ts). Config read at session start — changes need a new session. stdio servers need a runtime in the packaged app (same class as the pi-subagents shebang item)."

- [ ] **Step 2: PRD fold**

In `docs/prd.md`, find the MCP mention (README line 74 references "MCP via pi-mcp-adapter" as a build item) and fold in place using the "Decision (…)" convention:

> Decision (2026-07-13): MCP support ships via the vendored pi-mcp-adapter (exact-pinned), not a native client. Proxy mode by default (single low-token `mcp` tool; UI unwraps to the real server/tool everywhere), per-server "expose tools directly" toggle. Config = standard mcpServers JSON: global tier in the app agent dir, workspace tier in `.mcp.json` (shareable). Every MCP call flows through the existing permission gate as `mcp:<tool>`. Spec: docs/superpowers/specs/2026-07-13-mcp-support-design.md, validation: docs/validation/m1.md.

(The Notion PRD gets the same fold — done by the coordinating session, not this task.)

- [ ] **Step 3: Full gate**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
npx vitest run --exclude 'tests/{bridge,rules-bridge,intent-bridge,ask-user-bridge,agents-md-bridge,subagent-context,permission-coexistence,mcp-bridge}.test.ts'
npx vitest run tests/bridge.test.ts tests/rules-bridge.test.ts tests/intent-bridge.test.ts tests/ask-user-bridge.test.ts tests/agents-md-bridge.test.ts tests/subagent-context.test.ts tests/permission-coexistence.test.ts tests/mcp-bridge.test.ts
npm run build
```

(Use the repo's actual non-live/live invocation commands if they differ — the split rule is what matters: live files batched together, excluded from the parallel suite.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/prd.md
git commit -m "docs(mcp): CLAUDE.md + PRD fold — pi-mcp-adapter decision and gotchas"
```

---

## Deliberately out of scope (spec-locked)

- Roots / MCP prompts / live `tools/list_changed` — adapter doesn't support them; revisit on adapter upgrades.
- Live connection status in the UI, sampling/elicitation hv-envelope UI — only if the Task 4 spike shows the adapter's `ctx.hasUI`-guarded paths break under RPC (record in m1.md; separate plan).
- Session-tier MCP config — workspace + global only for v1.
