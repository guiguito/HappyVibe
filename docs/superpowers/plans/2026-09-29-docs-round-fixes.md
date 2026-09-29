# Docs-round fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the app bugs the user-guide writers found (`docs/validation/docs-round.md`, 34 items, verified against `728debf` and decided 2026-09-29), and update each guide page that routes readers around a bug in the same commit.

**Architecture:** No new subsystem; each task is a root-cause fix in the flow that already owns the behaviour. Four tasks touch the bridge (`pi-runtime/extensions/`), so the live batch is required: Task 1 (#34, MCP management calls ask), Task 3 (#1, approval title), Task 4 (#2, bypass banner) and Task 10a (#7, sub-agent rows record bypass). The rest is renderer and main. Pure logic goes into small exported functions or data, so the no-DOM vitest suite can pin it, plus source scans for what must not render.

**Tech Stack:** Electron + React 19 renderer, TypeScript 7, vitest (no DOM), vendored Pi 0.86.1 / pi-mcp-adapter 2.35.0 / tintinweb 0.19.0, xterm 6, Astro Starlight guide in `docs/guide/`.

**Spec:** `docs/validation/docs-round.md`, the decided spec (item numbers below are its numbers). PRD folds are already done on both sides (`docs/prd.md` §5, §10, §11 ×2, §13 ×2, §25, §35 and the Notion mirror). Re-edit the PRD only if implementation has to diverge from it, and then on both sides.

## Global Constraints

- Every commit: `git commit -s` (DCO) with the trailer block shown in each task's commit step.
- A change to a screen's behaviour or copy updates its guide page (`docs/guide/src/content/docs/<slug>.md`) in the **same commit**. Quoted UI strings match the code character for character. Voice: `docs/guide/VOICE.md`.
- Test command, always (never pipe a test run): `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
- Gate = `npm run gate` (build → non-live suite). Never run `npm run typecheck` before it. Never run `npm run lint` or `npm run format`.
- Tests are `tests/*.test.ts`, no DOM. A UI contract is pinned as exported data or a pure function, plus a source scan for what must not render.
- Anything the renderer imports must not reach Node. Anything vitest imports must not reach `electron`: `ipc.ts` is tested by source scan or through an extracted import-free module.
- `process.platform` in `src/main` outside `platform.ts` is a review red. Use the seam.
- Key hints go through `formatBinding` (`src/renderer/src/shortcuts.ts`). OS-specific copy goes through `platformCopy.ts` (`MOD`, `IS_WINDOWS`, `REVEAL_IN_FILE_MANAGER`, …). No `⌘` or "your Mac" in shared copy.
- Copy that describes a gate is derived from the gate (the `tests/how-it-works.test.ts` pattern).
- New bridge wire shapes, and removed ones, go in `docs/validation/d1.md`.
- No `.env` in the worktree until Task 21 (see Task 0). Single-file vitest runs of bridge tests would otherwise hit the paid provider.
- `src/main` changes need a dev-server restart before a GUI check (⌘R reloads only the renderer). Grep `out/main/index.js` before claiming a main-side fix is live.
- Before any restart or GUI click: check that no agent turn is running in the user's app (`pgrep -fl "npm run dev"`; see memory *running-session-is-sacred*). Scope every `pkill` to this worktree's path, because another HappyVibe may hold :9222 or :5173.

## Review Focus

Inputs the spec implies but no single test naturally exercises. Each line has its test in the owning task.

1. **An `mcp` call that mixes keys**, such as `{tool:"x", action:"install"}`, `{connect:"s", action:"auth-start"}` or `{search:"a", action:"install"}`, or an action a future adapter adds (`{action:"uninstall"}`): it must ask, and it must never be auto-allowed as discovery or gated as `mcp:x` (Task 1).
2. **Reinstalling or updating a plugin whose server you already connected:** the install must not switch that server back off. The install already refuses an existing server name (`writeMcpServer(..., { failIfExists: true })`, `ipc.ts:6960-6964`), so only a newly written entry carries `disabled: true`. Task 2's test pins that the option stays.
3. **A settings file saved by an older build with `Shift-a` or `Alt-x` bindings:** it loads without a crash, and those actions fall back to their defaults instead of becoming dead keys (Task 7). Accepted edge case: a restored default that another override already holds shows the same keys on two rows until either is re-recorded.
4. **Forgetting a workspace while a session in it is mid-turn with a permission prompt open:** the prompt goes away with the session (no orphan modal for a session nobody can open), and re-adding the folder shows the session again, resumable (Task 15).
5. **Pasting Windows text (`\r\n` line endings), or a single line ending in a newline:** the warning counts lines correctly ("1 line", which still executes, so it still asks), and a right-click paste with the warning switched off still goes through xterm's bracketed paste, never raw input (Task 6).

## Execution order

Task 0 first, then the trust tasks (1–7), then broken flows (8–18), then copy (19–20), then Task 21. Tasks are independent except where **Interfaces** says otherwise. Several tasks touch `ChatView.tsx`, `App.tsx` and `ipc.ts`, so run them one at a time, not in parallel worktrees.

---

### Task 0: Worktree setup and baseline

**Files:** none (environment only)

- [ ] **Step 1: Install both trees.** `pi-runtime/` is a separate vendored install; without it the bridge and contract tests fail.

```bash
npm install && (cd pi-runtime && npm ci)
```

- [ ] **Step 2: Do NOT link `.env` yet.** A single-file run such as `npx vitest run tests/rules-bridge.test.ts` doesn't blank the API keys the way `npm test` does. With `.env` present it would also run that file's paid live tests on every red/green cycle. Task 21 links it right before the live batch.

- [ ] **Step 3: Baseline the non-live suite.** It must be green before any change, so a later red is ours.

```bash
L=/tmp/vitest.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

Expected: `EXIT=0`, ~50 s. If it is red, stop and report. Do not start the fixes on a red baseline.

- [ ] **Step 4: Note the guide's baseline build.**

```bash
(cd docs/guide && npm install && npm run build) > /tmp/guide.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/guide.log
```

Expected: `EXIT=0`. Guide edits in later tasks are re-checked by this same build in Task 21.

---

### Task 1: The agent can't add or sign in to an MCP server without asking (docs-round #34)

**Spec note:** "any unknown action → manage" doesn't match the adapter. Its dispatch only acts on the four known actions (`pi-mcp-adapter/index.ts:1815-1849`); any other `action` is ignored and dispatch moves on to `params.tool` (`:1850`). So `{action:"bogus", tool:"github_x"}` RUNS `github_x`, and gating it as manage would ask one question and do another. Plan: an unknown action falls through to the next key, the way the adapter does. Only an unknown action with no other key asks, as `manage`.

**Spec note:** the spec names no rule name for the new kind. Plan: `mcp-manage:install:<url>`, `mcp-manage:auth:<server>`, `mcp-manage:<action>`. These are deliberately OUTSIDE `mcp:`, so an `mcp:*` allow rule, a bare `mcp` rule or an MCP tool grant never covers an install. Per URL / per server, so "Allow for session" covers that one address only (the `browser:<host>` precedent, `happyvibe-bridge.ts:986-989`).

**Spec note:** the permission modal heads a prompt with `toolLabel(info.tool, …)` (`PermissionModal.tsx:112`). For an unknown rule name that is `prettify(...)` (`toolLabel.ts:420-424`), which would hide the URL behind **details**. So the modal heads a manage call with the bridge's factual summary instead (one line).

**Spec note:** a key-free bridge test can't reach `tool_call`: Pi RPC has no tool-exec verb (`.claude/rules/mcp.md`), and `tests/rules-bridge.test.ts`'s key-free tests only drive slash commands. The bridge path is covered live by `tests/mcp-bridge.test.ts` (extended below), plus a key-free source scan of the bridge's auto-allow branch.

**Files:**
- Modify: `pi-runtime/extensions/hv-mcp.ts:13-21, 51-76`
- Modify: `pi-runtime/extensions/hv-plan.ts:222-223, 311-313`
- Modify: `src/renderer/src/components/PermissionModal.tsx:1-9 (imports), 112`
- Modify: `.claude/rules/mcp.md:10-12`
- Test: `tests/hv-mcp.test.ts` (existing), `tests/mcp-adapter-actions.test.ts` (new, contract), `tests/mcp-bridge.test.ts` (existing, live)
- Guide: `docs/guide/src/content/docs/permissions.md:48`, `docs/guide/src/content/docs/mcp.md:97`

**Interfaces:** Produces, from `pi-runtime/extensions/hv-mcp.ts`:
- `McpCallInfo.kind: "invoke" | "discovery" | "manage"`
- `MCP_READ_ACTIONS: ReadonlySet<string>` (= `{"ui-messages"}`)
- `MCP_MANAGE_ACTIONS: ReadonlySet<string>` (= `{"install","auth-start","auth-complete"}`)
- `MCP_MANAGE_PREFIX = "mcp-manage:"`
- `isMcpManageRule(tool: string): boolean`

`gatePlanCall("mcp", manageInput)` now returns `{kind:"block"}`. Consumes nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hv-mcp.test.ts` (the existing imports on lines 1-2 are replaced by the block at the top):

```ts
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isMcpManageRule, MCP_MANAGE_ACTIONS, MCP_MANAGE_PREFIX, MCP_READ_ACTIONS, unwrapMcpCall,
} from "../pi-runtime/extensions/hv-mcp";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { gateReadonlyCall } from "../pi-runtime/extensions/hv-readonly";

// … existing tests stay as they are …

test("#34 install is a manage call that names the URL and where it is written", () => {
  const g = unwrapMcpCall({ action: "install", url: "https://evil.example/mcp" });
  expect(g.kind).toBe("manage");
  expect(g.ruleTool).toBe("mcp-manage:install:https://evil.example/mcp");
  expect(g.display).toBe("MCP: install https://evil.example/mcp into your global MCP config");
  expect(unwrapMcpCall({ action: "install", url: "https://x.example/mcp", target: "project" }).display)
    .toBe("MCP: install https://x.example/mcp into this project's MCP config");
  expect(unwrapMcpCall({ action: "install" }).display).toBe("MCP: install (no URL given) into your global MCP config");
});

test("#34 both sign-in actions are manage calls that name the server", () => {
  for (const action of ["auth-start", "auth-complete"]) {
    const g = unwrapMcpCall({ action, server: "linear" });
    expect(g.kind, action).toBe("manage");
    expect(g.ruleTool, action).toBe("mcp-manage:auth:linear");
    expect(g.display, action).toBe("MCP: sign in to linear");
    expect(g.server, action).toBe("linear");
  }
});

test("#34 action is read FIRST, exactly as the adapter dispatches it", () => {
  // The adapter runs the install here, not the tool call and not the search.
  expect(unwrapMcpCall({ tool: "x", action: "install", url: "https://a.example/mcp" }).kind).toBe("manage");
  expect(unwrapMcpCall({ search: "a", action: "install", url: "https://a.example/mcp" }).kind).toBe("manage");
  expect(unwrapMcpCall({ connect: "srv", action: "auth-start", server: "srv" }).kind).toBe("manage");
  // ui-messages is a read, and it too wins over a tool beside it.
  const ui = unwrapMcpCall({ tool: "x", action: "ui-messages" });
  expect(ui.kind).toBe("discovery");
  expect(ui.ruleTool).toBe("mcp");
});

test("#34 an action the adapter doesn't know falls through to the next key, like the adapter; alone, it asks", () => {
  expect(unwrapMcpCall({ action: "bogus", tool: "github_x" }).ruleTool).toBe("mcp:github_x");
  expect(unwrapMcpCall({ action: "bogus", connect: "srv" }).kind).toBe("discovery");
  const alone = unwrapMcpCall({ action: "bogus" });
  expect(alone.kind).toBe("manage");
  expect(alone.ruleTool).toBe("mcp-manage:bogus");
  expect(alone.display).toBe("MCP: bogus");
});

test("#34 connect beats describe beats instructions beats search, like the adapter", () => {
  expect(unwrapMcpCall({ describe: "t", connect: "srv" }).display).toBe("MCP: connect to srv");
  expect(unwrapMcpCall({ instructions: "srv", describe: "t" }).display).toBe("MCP discovery: describe t");
  expect(unwrapMcpCall({ search: "q", instructions: "srv" }).display).toBe("MCP discovery: instructions srv");
  expect(unwrapMcpCall({ instructions: "srv" }).kind).toBe("discovery");
});

test("#34 no manage call has a rule name that an MCP tool rule or grant covers", () => {
  expect(MCP_MANAGE_PREFIX.startsWith("mcp:")).toBe(false);
  for (const input of [{ action: "install", url: "https://a.example/mcp" }, { action: "auth-start", server: "s" }, { action: "bogus" }]) {
    const r = unwrapMcpCall(input).ruleTool;
    expect(isMcpManageRule(r), r).toBe(true);
    expect(r.startsWith("mcp:"), r).toBe(false);
  }
  expect(isMcpManageRule("mcp:github_x")).toBe(false);
  expect([...MCP_READ_ACTIONS, ...MCP_MANAGE_ACTIONS].sort()).toEqual(["auth-complete", "auth-start", "install", "ui-messages"]);
});

test("#34 plan mode and read-only runs block a manage call; discovery and invoke keep floor-ask", () => {
  const install = { action: "install", url: "https://a.example/mcp" };
  const plan = gatePlanCall("mcp", install);
  expect(plan.kind).toBe("block");
  expect(plan.kind === "block" && plan.reason).toMatch(/^Plan mode is read-only — adding an MCP server or signing in to one is blocked\./);
  expect(gatePlanCall("mcp", { action: "auth-start", server: "s" }).kind).toBe("block");
  const ro = gateReadonlyCall("mcp", install);
  expect(ro.kind).toBe("block");
  expect(ro.kind === "block" && ro.reason).toBe("This is a read-only run — adding an MCP server or signing in to one is blocked. Read, search and report what you find.");
  expect(gatePlanCall("mcp", { search: "q" }).kind).toBe("floor-ask");
  expect(gatePlanCall("mcp", { tool: "srv_do" }).kind).toBe("floor-ask");
  expect(gatePlanCall("mcp", {}).kind).toBe("floor-ask");
});

test("#34 the bridge auto-allows discovery ONLY, and prompts with the factual display", () => {
  const bridge = fs.readFileSync(path.join(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  expect(bridge).toContain('if (mcp?.kind === "discovery" && v.source === "default" && !planFloorAsk) {');
  expect(bridge).not.toMatch(/mcp\?\.kind !== "invoke"/); // the regression: "anything not an invoke is safe"
  expect(bridge).toContain("const summary = mcp?.display ?? summarize(tool, input);");
});

test("#34 the permission prompt heads a manage call with that factual display", () => {
  const modal = fs.readFileSync(path.join(__dirname, "../src/renderer/src/components/PermissionModal.tsx"), "utf8");
  expect(modal).toMatch(/isMcpManageRule\(info\.tool\)\s*\?\s*\{ icon: "wrench" as const, label: info\.summary \}\s*:\s*toolLabel\(info\.tool, args\)/);
});
```

New `tests/mcp-adapter-actions.test.ts`:

```ts
/**
 * CONTRACT test (adapter-pin-bump gate) — docs-round #34.
 *
 * The bridge gates an `mcp` call by what `unwrapMcpCall` says it is, so the
 * classifier has to read the params in the SAME order the adapter dispatches
 * them, and it has to know every `action` the adapter runs. Before #34 it read
 * tool → search → describe → connect → action, and `{tool:"x", action:"install"}`
 * was asked as `mcp:x` while the adapter installed a server. A bump that adds an
 * action or reorders the dispatch fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_MANAGE_ACTIONS, MCP_READ_ACTIONS } from "../pi-runtime/extensions/hv-mcp";

const INDEX = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter", "index.ts");
const src = fs.readFileSync(INDEX, "utf8");
// The proxy tool: from its registration to the status fallback at the end of `execute`.
const start = src.indexOf('name: "mcp",');
const end = src.indexOf("return proxyModes.executeStatus(proxyState);", start);
const body = src.slice(start, end);
const ours = new Set([...MCP_READ_ACTIONS, ...MCP_MANAGE_ACTIONS]);

describe("pi-mcp-adapter proxy dispatch contract", () => {
  it("finds the proxy's execute body (guards against a vacuous pass)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("dispatches exactly the actions HappyVibe classifies", () => {
    const dispatched = [...body.matchAll(/params\.action === "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dispatched)).toEqual(ours);
  });

  it("the schema's own action list agrees", () => {
    const m = body.match(/action: Type\.Optional\(Type\.String\(\{ description: "Action: ([^"]+)" \}\)\)/);
    expect(m, "the action param's description moved or changed shape").not.toBeNull();
    expect(new Set([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]))).toEqual(ours);
  });

  it("checks action, then tool, connect, describe, instructions, search — unwrapMcpCall's order", () => {
    const at = (needle: string): number => {
      const i = body.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at('if (params.action === "install")'),
      at("if (params.tool)"),
      at("if (params.connect)"),
      at("if (params.describe)"),
      at("if (params.instructions)"),
      at("if (params.search !== undefined)"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const lastAction = Math.max(...[...body.matchAll(/params\.action === "/g)].map((m) => m.index ?? -1));
    expect(lastAction, "every action branch must come before the tool branch").toBeLessThan(at("if (params.tool)"));
  });
});
```

Append to `tests/mcp-bridge.test.ts` (live; add `import { askUntil } from "./reask";` to the imports):

```ts
test.skipIf(!KEY)("docs-round #34: an MCP install asks with the URL, and Deny writes nothing", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-mcp-install-"));
  const agentDir = path.join(tmp, ".pi", "agent");
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, PI_MCP_ADAPTER_RELPATH),
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: {
      ...process.env, ...PROVIDER_ENV,
      HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"), PI_CODING_AGENT_DIR: agentDir,
    } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();

  const prompts: Array<Record<string, unknown>> = [];
  client.on("ui-request", (m) => {
    const req = m as Record<string, unknown>;
    if (req.method !== "select") return;
    try {
      const t = JSON.parse(req.title as string);
      if (t.kind !== "hv.permission") return;
      prompts.push(t);
      client.respondUi(req.id as string, { value: "Deny" });
    } catch { /* not ours */ }
  });

  // Loopback http is the one non-https URL the adapter accepts; nothing listens on port 9.
  const url = "http://127.0.0.1:9/mcp";
  const isInstall = (p: Record<string, unknown>): boolean => String(p.tool).startsWith("mcp-manage:install:");
  const asked = await askUntil(
    () => client.send({
      type: "prompt",
      message: `Call the \`mcp\` tool right now with exactly these arguments: {"action":"install","url":"${url}"}. `
        + "Do not explain, do not ask questions, do not reply in prose: make the tool call.",
    }),
    () => prompts.some(isInstall),
  );
  expect(asked, "model never called mcp install across 3 attempts").toBe(true);
  const p = prompts.find(isInstall)!;
  expect(p.tool).toBe(`mcp-manage:install:${url}`);
  expect(p.summary).toBe(`MCP: install ${url} into your global MCP config`);
  // Denied: neither config the adapter can write to exists.
  expect(fs.existsSync(path.join(agentDir, "mcp.json"))).toBe(false);
  expect(fs.existsSync(path.join(tmp, ".pi", "mcp.json"))).toBe(false);
}, 180_000);
```

- [ ] **Step 2: Run it, expect FAIL.** It needs `pi-runtime/node_modules`, so run `(cd pi-runtime && npm ci)` first if the worktree has none.
  `L=/tmp/vitest.log; npx vitest run tests/hv-mcp.test.ts tests/mcp-adapter-actions.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `hv-mcp.test.ts` fails on the new tests (`isMcpManageRule is not a function`, `expected 'discovery' to be 'manage'`). `mcp-adapter-actions.test.ts` fails at import (`MCP_READ_ACTIONS` is undefined, `new Set([...undefined])` throws).

- [ ] **Step 3: Implement**

`pi-runtime/extensions/hv-mcp.ts:13-21`. Current:
```ts
export interface McpCallInfo {
  kind: "invoke" | "discovery";
  mcpTool?: string;
  ruleTool: string;
  display: string;
  /** Round 4 #4: server key for brand-icon lookup — the explicit `server`
      param when present, else the prefix before the first "_" of the tool. */
  server?: string;
}
```
Replacement:
```ts
export interface McpCallInfo {
  /** invoke = a server's tool; discovery = a read the bridge safe-defaults;
      manage = changes MCP config or sign-in state (docs-round #34), asked by default. */
  kind: "invoke" | "discovery" | "manage";
  mcpTool?: string;
  ruleTool: string;
  display: string;
  /** Round 4 #4: server key for brand-icon lookup — the explicit `server`
      param when present, else the prefix before the first "_" of the tool. */
  server?: string;
}

/** Every `action` pi-mcp-adapter's proxy dispatches (index.ts `execute`), by what it does.
    Pinned against the adapter source by tests/mcp-adapter-actions.test.ts. */
export const MCP_READ_ACTIONS: ReadonlySet<string> = new Set(["ui-messages"]);
export const MCP_MANAGE_ACTIONS: ReadonlySet<string> = new Set(["install", "auth-start", "auth-complete"]);

/** Rule names of manage calls. Outside `mcp:` on purpose, so no `mcp:*` rule and no
    MCP tool grant ever covers an install or a sign-in. */
export const MCP_MANAGE_PREFIX = "mcp-manage:";
export const isMcpManageRule = (tool: string): boolean => tool.startsWith(MCP_MANAGE_PREFIX);
```

`pi-runtime/extensions/hv-mcp.ts:51-76`. Current:
```ts
export function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo {
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    const detail = keyArg(input.args);
    const explicitServer = typeof input.server === "string" && input.server.trim() ? input.server.trim() : undefined;
    const server = explicitServer ?? (tool.includes("_") ? tool.slice(0, tool.indexOf("_")) : undefined);
    return {
      kind: "invoke",
      mcpTool: tool,
      ruleTool: `mcp:${tool}`,
      display: detail ? `MCP → ${tool}: ${detail}` : `MCP → ${tool}`,
      server,
    };
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
Replacement:
```ts
export function unwrapMcpCall(input: Record<string, unknown>): McpCallInfo {
  const str = (k: string): string | null =>
    typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string) : null;
  // docs-round #34: keys are read in the ADAPTER's dispatch order (index.ts `execute`):
  // action, tool, connect, describe, instructions, search. Any other order asks about one
  // call while the adapter runs another: `{tool:"x", action:"install"}` ran an install.
  const action = str("action");
  if (action === "install") {
    const url = str("url") ?? "(no URL given)";
    const where = input.target === "project" ? "this project's MCP config" : "your global MCP config";
    return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}install:${url}`, display: `MCP: install ${url} into ${where}` };
  }
  if (action === "auth-start" || action === "auth-complete") {
    const server = str("server") ?? "(no server given)";
    return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}auth:${server}`, display: `MCP: sign in to ${server}`, server };
  }
  if (action && MCP_READ_ACTIONS.has(action)) return { kind: "discovery", ruleTool: "mcp", display: `MCP: ${action}` };
  // Any other action is ignored by the adapter's dispatch, which moves on to the keys
  // below, so this does too.
  const tool = input.tool;
  if (typeof tool === "string" && tool.trim()) {
    const detail = keyArg(input.args);
    const explicitServer = typeof input.server === "string" && input.server.trim() ? input.server.trim() : undefined;
    const server = explicitServer ?? (tool.includes("_") ? tool.slice(0, tool.indexOf("_")) : undefined);
    return {
      kind: "invoke",
      mcpTool: tool,
      ruleTool: `mcp:${tool}`,
      display: detail ? `MCP → ${tool}: ${detail}` : `MCP → ${tool}`,
      server,
    };
  }
  const connect = str("connect");
  if (connect) return { kind: "discovery", ruleTool: "mcp", display: `MCP: connect to ${connect}` };
  const describe = str("describe");
  if (describe) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: describe ${describe}` };
  const instructions = str("instructions");
  if (instructions) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: instructions ${instructions}` };
  const search = str("search") ?? str("regex");
  if (search) return { kind: "discovery", ruleTool: "mcp", display: `MCP discovery: search "${search}"` };
  // Alone, an unknown action asks: an action a future adapter adds must never ride in as discovery.
  if (action) return { kind: "manage", ruleTool: `${MCP_MANAGE_PREFIX}${action}`, display: `MCP: ${action}` };
  return { kind: "discovery", ruleTool: "mcp", display: "MCP discovery" };
}
```

`pi-runtime/extensions/hv-plan.ts:222-223`. Current:
```ts
import { isReadOnlyBoundary, writeCapableIn } from "./hv-subagent-boundary";
import { isDelegationTool, isShellTool } from "./hv-rules";
```
Replacement:
```ts
import { isReadOnlyBoundary, writeCapableIn } from "./hv-subagent-boundary";
import { isDelegationTool, isShellTool } from "./hv-rules";
import { unwrapMcpCall } from "./hv-mcp";
```

`pi-runtime/extensions/hv-plan.ts:311-313`. Current:
```ts
  if (BLOCKED_PLAN_TOOLS.has(toolName)) {
    return { kind: "block", reason: `Plan mode is read-only — '${toolName}' is blocked. Explore and draft a plan; the user implements it later.` };
  }
```
Replacement. `gateReadonlyCall` (`hv-readonly.ts:54-66`) inherits this and re-voices the reason, so it needs no edit:
```ts
  if (BLOCKED_PLAN_TOOLS.has(toolName)) {
    return { kind: "block", reason: `Plan mode is read-only — '${toolName}' is blocked. Explore and draft a plan; the user implements it later.` };
  }
  // docs-round #34: installing an MCP server or signing in to one writes config, so both
  // read-only modes block it. Every other proxy call keeps the floor-ask below.
  if (toolName === "mcp" && unwrapMcpCall(typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}).kind === "manage") {
    return { kind: "block", reason: "Plan mode is read-only — adding an MCP server or signing in to one is blocked. Explore and draft a plan; the user implements it later." };
  }
```

`src/renderer/src/components/PermissionModal.tsx`: add to the imports (after line 5):
```ts
import { isMcpManageRule } from "../../../../pi-runtime/extensions/hv-mcp";
```
`PermissionModal.tsx:112`. Current:
```ts
  const { icon, label } = toolLabel(info.tool, args);
```
Replacement:
```ts
  // docs-round #34: an MCP install or sign-in is headed by the bridge's factual display (the
  // URL and which config it lands in); toolLabel only knows the rule name.
  const { icon, label } = isMcpManageRule(info.tool) ? { icon: "wrench" as const, label: info.summary } : toolLabel(info.tool, args);
```

`happyvibe-bridge.ts` needs NO edit. A `manage` call isn't `discovery`, so it skips the auto-allow at `:1280` and falls through to the default ask (`:1293-1318`) with `summary = mcp.display` (`:1015`).

`.claude/rules/mcp.md:10-12`. Current:
```
  `mcp:<serverKey>_<toolName>` for rules/grants/prompts/audit. Discovery calls
  (search/describe/connect) are safe-default-allowed. `unwrapMcpCall` is the ONE source of the
  factual display (gate + renderer), enriched with a key arg (url/query).
```
Replacement:
```
  `mcp:<serverKey>_<toolName>` for rules/grants/prompts/audit. Discovery calls
  (search/describe/connect/instructions, `action:"ui-messages"`) are safe-default-allowed.
  `install`, `auth-start`/`auth-complete` and a lone unknown action are the `manage` kind
  (`mcp-manage:install:<url>`, `mcp-manage:auth:<server>` — outside `mcp:` so no MCP tool rule
  covers them): asked by default, blocked in plan mode and read-only runs. `unwrapMcpCall` reads
  keys in the ADAPTER's dispatch order (action → tool → connect → describe → instructions →
  search), pinned with its action list by `tests/mcp-adapter-actions.test.ts`. It is the ONE
  source of the factual display (gate + renderer), enriched with a key arg (url/query).
```

- [ ] **Step 4: Run it, expect PASS** (same command as Step 2). Also re-run the plan and read-only suites the gate now reaches:
  `L=/tmp/vitest.log; npx vitest run tests/hv-plan.test.ts tests/hv-readonly.test.ts tests/extension-imports.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 5: Guide**
  - `permissions.md:48`. Old: "- MCP tools: `mcp:` and the tool's name, or `mcp:*` for all of them. For a server with **Expose tools directly** ticked, use each tool's own name, as it's listed on [Agent tools](/docs/agent-tools/)."
    New: that same line, followed by a new bullet: "- Adding an MCP server or signing in to one: `mcp-manage:install:` and the server's address, or `mcp-manage:auth:` and the server's name. `mcp:*` doesn't cover these. With no rule they ask you, and in plan mode or a read-only run they're blocked."
  - `mcp.md:97`. Old: "When the agent wants to use a server's tool, the call goes through your [permission rules](/docs/permissions/), the same as every other tool call."
    New: "When the agent wants to use a server's tool, the call goes through your [permission rules](/docs/permissions/), the same as every other tool call. If the agent tries to add a server itself, or to sign in to one, it asks you first and names the address and where it would be saved."

- [ ] **Step 6: Commit**
  ```bash
  git add pi-runtime/extensions/hv-mcp.ts pi-runtime/extensions/hv-plan.ts src/renderer/src/components/PermissionModal.tsx .claude/rules/mcp.md tests/hv-mcp.test.ts tests/mcp-adapter-actions.test.ts tests/mcp-bridge.test.ts docs/guide/src/content/docs/permissions.md docs/guide/src/content/docs/mcp.md
  git commit -s -F - <<'MSG'
  fix(docs-round #34): the agent asks before it adds or signs in to an MCP server

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```
  Then `npm run live:why`. It will name `tests/mcp-bridge.test.ts`: symlink `.env` and run `npm run test:live` in the background.

**Bridge coverage:** live `tests/mcp-bridge.test.ts` has the existing invoke test plus the new install case. It asserts the `mcp-manage:install:` prompt, the exact summary, and no `mcp.json` after Deny. Key-free: the bridge source scan in `tests/hv-mcp.test.ts`. A key-free test that fires `tool_call` isn't possible (no tool-exec verb in RPC).

**GUI assertions**
- **Session view:** ask "Use the mcp tool's install action to add https://mcp.example.com/mcp". A permission dialog opens titled "The agent wants to run something". Its headline reads **MCP: install https://mcp.example.com/mcp into your global MCP config** (the URL, not "Mcp manage:…"). It has the usual five buttons.
- **Absence, MCP page:** after **Deny**, no new row appears under Your servers, and the session doesn't restart.
- **Audit log page:** the row shows tool `mcp-manage:install:https://mcp.example.com/mcp`, decision deny, source user.
- **Session view, plan mode on:** the same request shows the quiet "Skipped" card with "Plan mode is read-only — adding an MCP server or signing in to one is blocked." No dialog appears (absence).
- **Regression to check** (discovery must stay silent): in a session with one server configured, ask "search your MCP tools for echo". No permission dialog appears, and the Audit log shows the `mcp` row with source safe-default.

---

---

### Task 2: A plugin's MCP servers stay off until you click Connect (docs-round #25)

**Spec note:** the MCP page's **Edit** (`McpServersSection.tsx:522-546`) rebuilds the config from its form fields, so saving would drop `disabled: true`. That makes Edit a hidden "turn on". Saving an http server also runs sign-in (`:546` → `handleSaved` → `mcpAuthenticate`), whose success modal would say "Connected" while the row still says off. Plan: Edit keeps the flag, and an off server skips the save-time sign-in. The row's **Connect** is the one switch. (Edit already drops `origin`, so an edited plugin server stops being removed with its plugin. That's pre-existing and not fixed here.)

**Spec note:** the install also schedules a reload (`ipc.ts:6978`, `if (servers.length > 0) scheduleMcpReload(...)`). With the servers off, that restart changes nothing a session can do, yet it resets every session's "Allow for session" grants. Plan: delete that line. Connect reloads when it actually turns a server on.

**Spec note:** once a server is off, the **Authenticate** button (`:354`) must hide too. A failed Connect can leave a `needs-auth` status on an off server, and `hv:mcp-authenticate` doesn't clear the flag.

**Files:**
- Modify: `src/main/mcp.ts:12-20` (+ two exports after `:30`)
- Modify: `src/main/plugins/install.ts:1-6 (imports), 23-25`
- Modify: `src/main/ipc.ts:74-76, 132, 1414-1419, 1509-1512, 5887-5891, 6960-6965, 6978`
- Modify: `src/renderer/src/components/McpServersSection.tsx:239-265, 309, 327-328, 354, 371-378, 433-450, 536, 546`
- Modify: `src/renderer/src/components/PluginsSection.tsx:451`
- Modify: `.claude/rules/mcp.md` (Live reload section, one bullet)
- Test: `tests/plugin-install.test.ts` (existing), `tests/mcp-adapter-disabled.test.ts` (new, contract)
- Guide: `docs/guide/src/content/docs/mcp.md:35, 43`, `docs/guide/src/content/docs/plugins.md:58`

**Interfaces:** Produces:
- `isMcpServerOff(cfg: McpServerConfig | undefined): boolean` in `src/main/mcp.ts`. Same truth table as the adapter's `isServerDisabled`: only literal `true`.
- `withoutOffFlag(cfg: McpServerConfig): McpServerConfig` in `src/main/mcp.ts`.
- `pluginServerEntry(cfg: McpServerConfig, plugin: string, marketplace: string): McpServerConfig` in `src/main/plugins/install.ts`.
- `MCP_OFF_PILL: { label: string; title: string }` in `McpServersSection.tsx`.

Task 20c also edits `McpServersSection.tsx` (`remove`, lines 226-230); the two don't overlap.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plugin-install.test.ts`. Change its import block to add `pluginServerEntry` to the `../src/main/plugins/install` import and `isMcpServerOff, withoutOffFlag` to the `../src/main/mcp` import, and add:
```ts
import { MCP_OFF_PILL } from "../src/renderer/src/components/McpServersSection";
```
Then:
```ts
describe("docs-round #25: a plugin's MCP servers arrive switched off", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const between = (src: string, a: string, b: string): string => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i);
    expect(i, a).toBeGreaterThan(-1);
    expect(j, b).toBeGreaterThan(i);
    return src.slice(i, j);
  };

  it("the entry the install writes is off, attributed, and still normalised", () => {
    const e = pluginServerEntry({ url: "https://mcp.miro.com/", headers: { "X-AI-Source": "claude-code-plugin" } }, "miro", "official");
    expect(e.disabled).toBe(true);
    expect(isMcpServerOff(e)).toBe(true);
    expect(e.origin).toEqual({ plugin: "miro", marketplace: "official" });
    expect(e.auth).toBe("oauth"); // normalizePluginMcpServer still ran
  });

  it("a plugin that ships disabled:false still arrives off", () => {
    expect(pluginServerEntry({ command: "npx", args: ["x"], disabled: false }, "p", "m").disabled).toBe(true);
  });

  it("the flag survives mcp.json, and withoutOffFlag turns it on without touching the rest", () => {
    const f = path.join(tmp, "mcp.json");
    writeMcpServer(f, "s", pluginServerEntry({ command: "npx", args: ["x"] }, "demo", "official"));
    const cfg = readMcpFile(f).mcpServers.s;
    expect(isMcpServerOff(cfg)).toBe(true);
    const on = withoutOffFlag(cfg);
    expect("disabled" in on).toBe(false);
    expect(on).toMatchObject({ command: "npx", args: ["x"], origin: { plugin: "demo", marketplace: "official" } });
    expect(isMcpServerOff(on)).toBe(false);
    expect(findPluginServers(f, "demo")).toEqual(["s"]); // Remove still finds it
  });

  it("main: install writes the off entry and restarts nothing; Connect is the switch; probes skip off servers", () => {
    const ipc = read("src/main/ipc.ts");
    const install = between(ipc, '"hv:plugins-install"', 'ipcMain.handle("hv:plugins-installed"');
    expect(install).toMatch(/pluginServerEntry\(cfg, scan\.name, marketplaceId\), \{ failIfExists: true \}/); // Review Focus 2: a reinstall never rewrites (so never re-disables) a server you already connected
    expect(install).not.toMatch(/scheduleMcpReload\(/);
    const flow = between(ipc, '"hv:mcp-connect-flow"', 'ipcMain.handle("hv:mcp-status"');
    expect(flow).toMatch(/if \(result\.state === "connected"\) \{/);
    expect(flow).toMatch(/if \(now && isMcpServerOff\(now\)\) \{\s*writeMcpServer\(file, name, withoutOffFlag\(now\)\);\s*scheduleMcpReload\(scope, workspaceId\);/);
    expect(between(ipc, "const checkServer = async", "// Startup connectivity sweep")).toMatch(/if \(!cfg \|\| isMcpServerOff\(cfg\)\) \{/);
    expect(between(ipc, "const httpByName", "const wanted").match(/isMcpServerOff\(cfg\)/g)).toHaveLength(2);
  });

  it("the MCP page shows an off server as off, with Connect in place of Reconnect and no Authenticate", () => {
    expect(MCP_OFF_PILL.label).toBe("off");
    expect(MCP_OFF_PILL.title).toBe("Installed by a plugin and switched off. Sessions can't use it until you click Connect.");
    const src = read("src/renderer/src/components/McpServersSection.tsx");
    expect(src).toMatch(/const off = s\.cfg\.disabled === true;/);
    expect(src).toMatch(/status=\{status\}\s*off=\{off\}/);
    expect(src).toMatch(/onClick=\{\(\) => \(off \? authenticate\(s\.scope, s\.name, "connect"\) : reconnect\(s\)\)\}/);
    expect(src).toMatch(/\{off \? "Connect" : "Reconnect"\}/);
    expect(src).toMatch(/\{!off && status\?\.state === "needs-auth" && \(/);
    expect(src).toMatch(/via === "connect" \? window\.hv\.mcpConnectFlow : window\.hv\.mcpAuthenticate/);
    // Edit keeps it off, and saving an off server does not sign in behind the row's back.
    expect(src).toMatch(/\.\.\.\(cfg\.disabled === true \? \{ disabled: true \} : \{\}\),/);
    expect(src).toMatch(/onSaved\(scope, name, kind === "http" && cfg\.disabled !== true\);/);
  });

  it("the install dialog still tells the truth about servers", () => {
    const src = read("src/renderer/src/components/PluginsSection.tsx");
    expect(src).not.toContain("but NOT connected");
    expect(src).toContain("Added to your global mcp.json, switched off: sessions can't use them until you click Connect, here once installed or on the MCP page. Removed with the plugin.");
    expect(src).toMatch(/MCP servers arrive unconnected<\/strong> — so nothing the agent can do changes yet/);
  });
});
```

New `tests/mcp-adapter-disabled.test.ts`:
```ts
/**
 * CONTRACT test (adapter-pin-bump gate) — docs-round #25.
 *
 * A plugin's MCP servers are written with `disabled: true` and HappyVibe relies
 * on the ADAPTER to keep them unusable: no lazy connect, no explicit connect, and
 * no name in the `mcp` tool's server list. Main reads the same flag through
 * `isMcpServerOff`, and the two must agree on every value, or the MCP page says
 * "off" about a server a session can call.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMcpServerOff } from "../src/main/mcp";

const ADAPTER = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-mcp-adapter");
const src = (f: string): string => fs.readFileSync(path.join(ADAPTER, f), "utf8");

describe("pi-mcp-adapter disabled-flag contract", () => {
  it("only the literal true disables a server, and isMcpServerOff agrees on every value", async () => {
    const { isServerDisabled } = await import("../pi-runtime/node_modules/pi-mcp-adapter/types.ts");
    for (const v of [true, false, "true", 1, 0, null, undefined, {}]) {
      expect(isMcpServerOff({ disabled: v } as never), String(v)).toBe(isServerDisabled({ disabled: v }));
    }
    expect(isServerDisabled({ disabled: true })).toBe(true);
    expect(isServerDisabled({})).toBe(false);
  });

  it("a disabled server never lazy-connects, refuses an explicit connect, and is left out of the tool's server list", () => {
    expect(src("init.ts")).toContain("if (!definition || isServerDisabled(definition)) return false;");
    expect(src("proxy-modes.ts")).toContain('if (isServerDisabled(definition)) return disabledResult("connect", serverName);');
    expect(src("direct-tool-surface.ts")).toMatch(
      /const serverNames = Object\.keys\(config\.mcpServers\)\s*\.filter\(\(serverName\) => !isServerDisabled\(config\.mcpServers\[serverName\]\)\);/,
    );
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** It needs `pi-runtime/node_modules`, so run `(cd pi-runtime && npm ci)` if absent.
  `L=/tmp/vitest.log; npx vitest run tests/plugin-install.test.ts tests/mcp-adapter-disabled.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `pluginServerEntry is not a function` / `isMcpServerOff is not a function`, and `MCP_OFF_PILL` undefined (TypeError reading `label`).

- [ ] **Step 3: Implement**

`src/main/mcp.ts:12-20`. Current:
```ts
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  directTools?: boolean | string[];
  [k: string]: unknown;
}
```
Replacement:
```ts
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  directTools?: boolean | string[];
  /** The adapter's own off switch (`isServerDisabled`: only literal true). docs-round #25. */
  disabled?: boolean;
  [k: string]: unknown;
}
```
Add after `isValidServerName` (`:28-30`):
```ts
/** docs-round #25: main's reading of the adapter's `disabled` flag — the same truth table
    (tests/mcp-adapter-disabled.test.ts). An off server is never probed and never swept. */
export function isMcpServerOff(cfg: McpServerConfig | undefined): boolean {
  return cfg?.disabled === true;
}

/** The same config, switched on: what a successful Connect writes back. */
export function withoutOffFlag(cfg: McpServerConfig): McpServerConfig {
  const on = { ...cfg };
  delete on.disabled;
  return on;
}
```

`src/main/plugins/install.ts:1-6`. Current:
```ts
import fs from "node:fs";
import path from "node:path";
import { readSkillDir, type DiscoveredSkill } from "../skills/discovery";
import { countPluginRootRefs, substitutePluginRoot } from "./screen";
import { readMcpFile } from "../mcp";
import type { PluginScan } from "./scan";
```
Replacement:
```ts
import fs from "node:fs";
import path from "node:path";
import { readSkillDir, type DiscoveredSkill } from "../skills/discovery";
import { countPluginRootRefs, substitutePluginRoot } from "./screen";
import { readMcpFile, type McpServerConfig } from "../mcp";
import { normalizePluginMcpServer } from "./mcpImport";
import type { PluginScan } from "./scan";
```
`install.ts:23-25`. Current:
```ts
export function pluginOrigin(plugin: string, marketplace: string): PluginOrigin {
  return { plugin, marketplace };
}
```
Replacement:
```ts
export function pluginOrigin(plugin: string, marketplace: string): PluginOrigin {
  return { plugin, marketplace };
}

/**
 * What the install writes for one of a plugin's MCP servers (§25, docs-round #25):
 * normalised for the adapter's OAuth detection (mcpImport.ts), attributed so Remove can
 * find it, and OFF — the adapter neither lists nor connects a disabled server, so the
 * install changes nothing the agent can do until the user clicks Connect.
 */
export function pluginServerEntry(cfg: McpServerConfig, plugin: string, marketplace: string): McpServerConfig {
  return { ...normalizePluginMcpServer(cfg), origin: pluginOrigin(plugin, marketplace), disabled: true };
}
```

`src/main/ipc.ts:74-76`. Current:
```ts
import {
  findPluginServers, installPluginCommands, installPluginSkills, pluginOrigin, rewriteSkillRoots,
} from "./plugins/install";
```
Replacement (`pluginOrigin` has no other use in ipc.ts, and `noUnusedLocals` is on):
```ts
import {
  findPluginServers, installPluginCommands, installPluginSkills, pluginServerEntry, rewriteSkillRoots,
} from "./plugins/install";
```
`ipc.ts:132`. Current:
```ts
import { readMcpFile, writeMcpServer, serverNameInFiles, type McpServerConfig } from "./mcp";
```
Replacement:
```ts
import { isMcpServerOff, readMcpFile, withoutOffFlag, writeMcpServer, serverNameInFiles, type McpServerConfig } from "./mcp";
```
`ipc.ts:1414-1419` (checkServer). Current:
```ts
    const cfg = readMcpFile(file).mcpServers[name];
    if (!cfg) {
      mcpStatusMap.delete(statusKey(scope, workspaceId, name));
      mcpStatusChanged();
      return;
    }
```
Replacement:
```ts
    const cfg = readMcpFile(file).mcpServers[name];
    // docs-round #25: an off server (a plugin's, until Connect) is never probed: a stdio
    // probe STARTS it. Every sweep and Reconnect routes through here.
    if (!cfg || isMcpServerOff(cfg)) {
      mcpStatusMap.delete(statusKey(scope, workspaceId, name));
      mcpStatusChanged();
      return;
    }
```
`ipc.ts:1509-1512` (remote sweep prefetch). Current:
```ts
    for (const [n, cfg] of Object.entries(globalFile)) if (cfg.url) httpByName.set(n, { name: n, url: cfg.url });
    for (const [, servers] of wsFiles) {
      for (const [n, cfg] of Object.entries(servers)) if (cfg.url) httpByName.set(n, { name: n, url: cfg.url });
    }
```
Replacement (no keychain read for a server nobody can use):
```ts
    for (const [n, cfg] of Object.entries(globalFile)) if (cfg.url && !isMcpServerOff(cfg)) httpByName.set(n, { name: n, url: cfg.url });
    for (const [, servers] of wsFiles) {
      for (const [n, cfg] of Object.entries(servers)) if (cfg.url && !isMcpServerOff(cfg)) httpByName.set(n, { name: n, url: cfg.url });
    }
```
`ipc.ts:5887-5891` (end of `hv:mcp-connect-flow`). Current:
```ts
      setStatus(result.state, result.tools, result.error);
      return result.state === "connected"
        ? { ok: true as const, tools: result.tools ?? [] }
        : { ok: false as const, error: result.error ?? "Could not connect" };
```
Replacement:
```ts
      setStatus(result.state, result.tools, result.error);
      // docs-round #25: Connect is the switch for a server that arrived off (a plugin's).
      // Re-read the file rather than trust `cfg`: the OAuth leg can take minutes. A failed
      // connect leaves it off.
      if (result.state === "connected") {
        const now = readMcpFile(file).mcpServers[name];
        if (now && isMcpServerOff(now)) {
          writeMcpServer(file, name, withoutOffFlag(now));
          scheduleMcpReload(scope, workspaceId);
        }
      }
      return result.state === "connected"
        ? { ok: true as const, tools: result.tools ?? [] }
        : { ok: false as const, error: result.error ?? "Could not connect" };
```
`ipc.ts:6960-6965` (hv:plugins-install). Current:
```ts
          writeMcpServer(
            globalMcpFile(),
            key,
            { ...normalizePluginMcpServer(cfg), origin: pluginOrigin(scan.name, marketplaceId) },
            { failIfExists: true },
          );
```
Replacement:
```ts
          // docs-round #25: written OFF. The adapter neither lists nor connects it until
          // Connect (hv:mcp-connect-flow) removes the flag.
          writeMcpServer(globalMcpFile(), key, pluginServerEntry(cfg, scan.name, marketplaceId), { failIfExists: true });
```
`ipc.ts:6978`. Current:
```ts
        if (servers.length > 0) scheduleMcpReload("global", null);
```
Replacement: delete the line. The servers are off, so a restart would only reset session grants. Connect reloads.

`src/renderer/src/components/McpServersSection.tsx:239-265` (authenticate). Current:
```tsx
  const authenticate = (scope: "global" | "workspace", name: string): void => {
    const wsId = scope === "workspace" ? workspaceId : null;
    const gen = ++connectGen.current;
    const stale = (): boolean => connectGen.current !== gen;
    setConnectResult({ phase: "connecting", serverName: name });
    void window.hv.mcpAuthenticate(scope, wsId, name).then((res) => {
      if (stale()) return;
      if (res.ok) {
        setConnectResult({ phase: "ok", serverName: name, tools: res.tools });
      } else {
        setConnectResult({
          phase: "error",
          serverName: name,
          error: res.error,
          retry: () => authenticate(scope, name),
        });
      }
    }).catch((e: unknown) => {
      if (stale()) return;
      setConnectResult({
        phase: "error",
        serverName: name,
        error: String(e),
        retry: () => authenticate(scope, name),
      });
    });
  };
```
Replacement:
```tsx
  // docs-round #25: `via: "connect"` runs the plugin dialog's flow (probe, sign in only on a
  // 401), which is also what switches an off server on — so the row re-reads its config.
  const authenticate = (scope: "global" | "workspace", name: string, via: "auth" | "connect" = "auth"): void => {
    const wsId = scope === "workspace" ? workspaceId : null;
    const gen = ++connectGen.current;
    const stale = (): boolean => connectGen.current !== gen;
    setConnectResult({ phase: "connecting", serverName: name });
    const run = via === "connect" ? window.hv.mcpConnectFlow : window.hv.mcpAuthenticate;
    void run(scope, wsId, name).then((res) => {
      if (stale()) return;
      if (res.ok) {
        setConnectResult({ phase: "ok", serverName: name, tools: res.tools });
        if (via === "connect") void refresh();
      } else {
        setConnectResult({
          phase: "error",
          serverName: name,
          error: res.error,
          retry: () => authenticate(scope, name, via),
        });
      }
    }).catch((e: unknown) => {
      if (stale()) return;
      setConnectResult({
        phase: "error",
        serverName: name,
        error: String(e),
        retry: () => authenticate(scope, name, via),
      });
    });
  };
```
`:309`. Current:
```tsx
            const isHttp = typeof s.cfg.url === "string";
```
Replacement:
```tsx
            const isHttp = typeof s.cfg.url === "string";
            const off = s.cfg.disabled === true; // docs-round #25: a plugin's server, until Connect
```
`:327-328`. Current:
```tsx
                    <McpStatusBadge
                      status={status}
```
Replacement:
```tsx
                    <McpStatusBadge
                      status={status}
                      off={off}
```
`:354`. Current:
```tsx
                {status?.state === "needs-auth" && (
```
Replacement:
```tsx
                {!off && status?.state === "needs-auth" && (
```
`:371-378`. Current:
```tsx
                <button
                  type="button"
                  onClick={() => reconnect(s)}
                  className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer shrink-0"
                >
                  Reconnect
                </button>
```
Replacement:
```tsx
                <button
                  type="button"
                  onClick={() => (off ? authenticate(s.scope, s.name, "connect") : reconnect(s))}
                  className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer shrink-0"
                >
                  {off ? "Connect" : "Reconnect"}
                </button>
```
`:433-450` (McpStatusBadge head). Current:
```tsx
function McpStatusBadge({
  status,
  open = false,
  onToggleTools,
}: {
  status: McpServerStatusLike | undefined;
  /** Round 11: is the tool list expanded? */
  open?: boolean;
  /** Provided only when there is a tool list to show — absent keeps the plain badge. */
  onToggleTools?: () => void;
}): React.JSX.Element {
  if (!status) {
```
Replacement:
```tsx
/** docs-round #25: the badge of a server that arrived off. Exported as data (no DOM in the suite). */
export const MCP_OFF_PILL = {
  label: "off",
  title: "Installed by a plugin and switched off. Sessions can't use it until you click Connect.",
};

function McpStatusBadge({
  status,
  open = false,
  onToggleTools,
  off = false,
}: {
  status: McpServerStatusLike | undefined;
  /** Round 11: is the tool list expanded? */
  open?: boolean;
  /** Provided only when there is a tool list to show — absent keeps the plain badge. */
  onToggleTools?: () => void;
  /** docs-round #25: off wins over any status a failed Connect left behind. */
  off?: boolean;
}): React.JSX.Element {
  if (off) {
    return (
      <span title={MCP_OFF_PILL.title} className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-paper-deep text-ink-soft border border-line shrink-0">
        {MCP_OFF_PILL.label}
      </span>
    );
  }
  if (!status) {
```
`:536` (editor `next`). Current:
```tsx
        ...(direct ? { directTools: true } : { directTools: undefined }),
```
Replacement:
```tsx
        ...(direct ? { directTools: true } : { directTools: undefined }),
        // docs-round #25: Edit is not the switch. Connect is.
        ...(cfg.disabled === true ? { disabled: true } : {}),
```
`:546`. Current:
```tsx
      onSaved(scope, name, kind === "http");
```
Replacement:
```tsx
      onSaved(scope, name, kind === "http" && cfg.disabled !== true);
```

`src/renderer/src/components/PluginsSection.tsx:451`. Current:
```tsx
              note="Added to your global mcp.json but NOT connected — you can connect (and sign in) here once installed. Removed with the plugin."
```
Replacement:
```tsx
              note="Added to your global mcp.json, switched off: sessions can't use them until you click Connect, here once installed or on the MCP page. Removed with the plugin."
```
The sentence at `:463-467` ("MCP servers arrive unconnected — so nothing the agent can do changes yet") is now true and stays.

`.claude/rules/mcp.md`, Live reload section. Add a bullet:
```
- A plugin's servers are written `disabled: true` (`pluginServerEntry`, plugins/install.ts) — the
  adapter's own flag: not listed to the model, never connected. Main's Connect
  (`hv:mcp-connect-flow`) is the ONLY thing that clears it (then `scheduleMcpReload`); an off server
  is never probed or credential-read (`isMcpServerOff`, mcp.ts). `tests/mcp-adapter-disabled.test.ts`.
```

- [ ] **Step 4: Run it, expect PASS** (same command as Step 2). Also:
  `L=/tmp/vitest.log; npx vitest run tests/mcp-config.test.ts tests/mcp-status.test.ts tests/mcp-plugin-import-auth.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 5: Guide**
  - `mcp.md:35`. Old: "- **—**: no check has run yet."
    New: "- **—**: no check has run yet.\n- **off**: a plugin installed this server and it's switched off. Sessions can't use it until you click **Connect**, and HappyVibe doesn't check it either."
  - `mcp.md:43`. Old: "- **Reconnect**: check the server again."
    New: "- **Reconnect**: check the server again. On an **off** server this button reads **Connect**: HappyVibe checks the server answers and signs you in if it needs to. Once it's connected, your sessions can use it."
  - `plugins.md:58`. Old: "2. For each MCP server, click **Connect**, followed by the server's name. HappyVibe checks the server answers, and if it needs you to sign in, your browser opens. The button then says the server is connected."
    New: "2. For each MCP server, click **Connect**, followed by the server's name. HappyVibe checks the server answers, and if it needs you to sign in, your browser opens. The button then says the server is connected. Until you connect it, sessions can't use that server: it waits on [MCP](/docs/mcp/), marked **off**."

- [ ] **Step 6: Commit**
  ```bash
  git add src/main/mcp.ts src/main/plugins/install.ts src/main/ipc.ts src/renderer/src/components/McpServersSection.tsx src/renderer/src/components/PluginsSection.tsx .claude/rules/mcp.md tests/plugin-install.test.ts tests/mcp-adapter-disabled.test.ts docs/guide/src/content/docs/mcp.md docs/guide/src/content/docs/plugins.md
  git commit -s -F - <<'MSG'
  fix(docs-round #25): a plugin's MCP servers stay off until you click Connect

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**Live check (exact).** Dev app from this worktree, with a restart after the main change. Grep `out/main/index.js` for `pluginServerEntry` first.
1. **Plugins page:** open **playwright** (its server is stdio and needs no sign-in). Tick only its MCP server, click **Install**, then **Done**. Don't click Connect.
2. `grep -n '"disabled": true' "<userData>/pi-agent/mcp.json"` shows the `playwright` entry, next to its `origin`.
3. `pgrep -fl "playwright/mcp"` prints nothing, and no open session shows "reloading".
4. New session. Send: "Call the mcp tool with {} and list the servers it shows, then call it with {"connect":"playwright"}." Expected: the status output lists playwright as disabled. The connect call answers that the server is disabled. No permission dialog opens, and `pgrep -fl "playwright/mcp"` still prints nothing.
5. Quit and relaunch the app. `pgrep -fl "playwright/mcp"` still prints nothing (the boot sweep skipped it).
6. **MCP page:** the row reads **off** (tooltip: "Installed by a plugin and switched off. Sessions can't use it until you click Connect."), with **Connect**. There's no **Reconnect** and no tool count. Click **Connect**: the modal says "Connected to playwright" and "N tools discovered". The row now shows the tool count and **Reconnect**, and `mcp.json` has no `disabled` key for it.
7. In the step-4 session (it reloads once idle), ask for one playwright tool call. One dialog appears, headed **MCP: playwright_…**; Allow, and it runs.

**GUI assertions**
- **MCP page:** a plugin's server reads **off** with **Connect**, and after a successful Connect it reads as a tool count with **Reconnect**. A hand-added server looks exactly as before.
- **Absence, session top bar:** the 🔌 chip doesn't count an off server (for example, **1/1 MCP** with one hand-added server plus one off plugin server).
- **Absence, Activity Monitor/`pgrep`:** no process for an off stdio server after install or after a relaunch.
- **Absence, Plugins page:** installing a plugin that brings only MCP servers doesn't restart open sessions. The session's "Allow for session" grants survive, and no "reloading" appears.
- **Plugins page:** the install dialog's MCP servers note reads "Added to your global mcp.json, switched off: sessions can't use them until you click Connect, here once installed or on the MCP page. Removed with the plugin."
- **Regression to check:** on the MCP page, **Add server** a stdio server by hand, save, and click **Reconnect**: it gets a tool count. Relaunch the app: the tool count comes back on its own (the boot sweep still probes servers that are on). Then **Edit** an off plugin server, change nothing, and **Save**: it still reads **off**, and no sign-in window opens.

---

---

### Task 3: A sub-agent's approval dialog names the agent only (docs-round #1)

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:681-692` (the child policy's `ask`)
- Modify: `src/renderer/src/permission.ts:37-38`, `:95-98`
- Modify: `src/renderer/src/components/PermissionModal.tsx:162`
- Modify: `docs/validation/d1.md:4778-4787` (the child prompt's wire shape)
- Test: `tests/child-prompt.test.ts` (existing, `:20-26` rewritten, one test added)
- Guide: `docs/guide/src/content/docs/permissions.md:129`

**Interfaces:** Produces the `hv.permission` envelope's `child` as `{ agent: string; runId: string }` (no `runLabel`). `PermissionInfo.child` becomes `{ agent: string; runId: string }`. Nothing else reads `runLabel` from a permission: `App.tsx`'s `runLabel(...)` is the unrelated card-caption helper in `agents.ts:622` and stays.

- [ ] **Step 1: Write the failing test**. In `tests/child-prompt.test.ts`, replace the existing `it("parses the child's identity", …)` block (lines 20-26) with these two tests. `fs`, `parsePermission` and `CHILD_CHOICES` are already imported at the top of the file.

```ts
  it("parses the child's identity: its agent and run id, never the model's task text", () => {
    const info = parsePermission({
      method: "select", options: [...CHILD_CHOICES],
      title: JSON.stringify({ kind: "hv.permission", tool: "bash", summary: "npm test", child: { agent: "worker", runLabel: "Run the approved tests", runId: "r2" } }),
    } as never)!;
    expect(info.child).toEqual({ agent: "worker", runId: "r2" });
  });
  it("the title names the agent only — the app writes the dialog, never the model (docs round #1)", () => {
    const modal = fs.readFileSync("src/renderer/src/components/PermissionModal.tsx", "utf8");
    const title = modal.slice(modal.indexOf("<Dialog.Title"), modal.indexOf("</Dialog.Title>"));
    expect(title).toContain("`Sub-agent ${info.child.agent} wants to run something`");
    expect(title).not.toMatch(/runLabel|description/);
    // …and the bridge never looks the model's words up to send them.
    const bridge = fs.readFileSync("pi-runtime/extensions/happyvibe-bridge.ts", "utf8");
    const at = bridge.indexOf("ask: async (req) =>");
    expect(at).toBeGreaterThan(0);
    const ask = bridge.slice(at, bridge.indexOf('control("needs_attention");', at));
    expect(ask).toContain('child: { agent: req.type ?? "sub-agent", runId: req.agentId ?? "" }');
    expect(ask).not.toMatch(/runLabel|description|getRecord/);
  });
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/child-prompt.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1. The first test fails with `expected { agent: 'worker', runId: 'r2', runLabel: 'Run the approved tests' } to deeply equal { agent: 'worker', runId: 'r2' }`. The second fails on `expect(title).toContain(...)`, because the current title interpolates `info.child.runLabel`.

- [ ] **Step 3: Implement**

`pi-runtime/extensions/happyvibe-bridge.ts:681-692`. Current:
```ts
      ask: async (req) => {
        const ui = busUi;
        if (!ui) return "deny";
        const control = (activityState?: string) =>
          req.agentId && ui.notify(JSON.stringify({ kind: "hv.subagent", stage: "control", runId: req.agentId, ...(activityState ? { activityState } : {}) }), "info");
        const record = req.agentId
          ? (globalThis as Record<symbol, { getRecord?(id: string): { description?: string } | undefined } | undefined>)[Symbol.for("pi-subagents:manager")]?.getRecord?.(req.agentId)
          : undefined;
        const title = JSON.stringify({
          kind: "hv.permission", tool: req.permTool, summary: summarize(req.tool, req.input),
          child: { agent: req.type ?? "sub-agent", runLabel: record?.description ?? "", runId: req.agentId ?? "" },
        });
```
Replace with:
```ts
      ask: async (req) => {
        const ui = busUi;
        if (!ui) return "deny";
        const control = (activityState?: string) =>
          req.agentId && ui.notify(JSON.stringify({ kind: "hv.subagent", stage: "control", runId: req.agentId, ...(activityState ? { activityState } : {}) }), "info");
        // docs round #1: the app names the child, by its agent type and run id. Never the
        // run's task text: that is the model's own `Agent` argument, and a prompt never
        // shows the model's words (§13). The run's card turns amber while this waits,
        // which is how the user tells two runs of one agent apart.
        const title = JSON.stringify({
          kind: "hv.permission", tool: req.permTool, summary: summarize(req.tool, req.input),
          child: { agent: req.type ?? "sub-agent", runId: req.agentId ?? "" },
        });
```

`src/renderer/src/permission.ts:37-38`. Current:
```ts
  /** §10 (2026-09-26, Phase 4): a sub-agent's own `ask`, raised on the parent's pane. */
  child?: { agent: string; runLabel: string; runId: string };
```
Replace with:
```ts
  /** §10 (2026-09-26, Phase 4): a sub-agent's own `ask`, raised on the parent's pane.
      Only what the app knows. The run's description is the model's words (docs round #1). */
  child?: { agent: string; runId: string };
```

`src/renderer/src/permission.ts:95-98`. Current:
```ts
      const ch = p.child as Record<string, unknown> | undefined;
      if (ch && typeof ch === "object" && typeof ch.agent === "string" && typeof ch.runId === "string") {
        info.child = { agent: ch.agent, runId: ch.runId, runLabel: typeof ch.runLabel === "string" ? ch.runLabel : "" };
      }
```
Replace with:
```ts
      const ch = p.child as Record<string, unknown> | undefined;
      if (ch && typeof ch === "object" && typeof ch.agent === "string" && typeof ch.runId === "string") {
        info.child = { agent: ch.agent, runId: ch.runId };
      }
```

`src/renderer/src/components/PermissionModal.tsx:162`. Current:
```tsx
                  : info.child ? `Sub-agent ${info.child.agent}${info.child.runLabel ? ` · ${info.child.runLabel}` : ""} wants to run something`
```
Replace with:
```tsx
                  : info.child ? `Sub-agent ${info.child.agent} wants to run something`
```

`docs/validation/d1.md:4778-4787`. Current:
````md
A blocking `select` exactly like the parent's own, plus `child`. `options` is exactly
`["Allow", "Allow for this run", "Deny"]`; `runLabel` is the run's description (tintinweb's record).

```json
{
  "kind": "hv.permission",
  "tool": "write",
  "summary": "<summarize(tool, input), as for the parent's own prompts>",
  "child": { "agent": "writer", "runLabel": "Write files", "runId": "<tintinweb agent id>" }
}
```
````
Replace with:
````md
A blocking `select` exactly like the parent's own, plus `child`. `options` is exactly
`["Allow", "Allow for this run", "Deny"]`. `child` carries only what the app knows. The run's
description (tintinweb's record) is NOT sent: it is the model's own `Agent` argument, and a prompt never
shows the model's words (§13, docs round #1). The modal's title is `Sub-agent <agent> wants to run something`.

```json
{
  "kind": "hv.permission",
  "tool": "write",
  "summary": "<summarize(tool, input), as for the parent's own prompts>",
  "child": { "agent": "writer", "runId": "<tintinweb agent id>" }
}
```
````

- [ ] **Step 4: Run it, expect PASS** (same command). Expected: EXIT=0, every test in `child-prompt.test.ts` green.

- [ ] **Step 5: Guide**. `docs/guide/src/content/docs/permissions.md:129`.
  Old: `- A subagent: **Allow**, **Allow for this run** and **Deny**. **Allow for this run** covers that tool until the subagent's run ends.`
  New: `- A subagent: the title names it, for example "Sub-agent worker wants to run something". The buttons are **Allow**, **Allow for this run** and **Deny**. **Allow for this run** covers that tool until the subagent's run ends.`
  (`approve-a-tool-call.md:32`, "The app writes the approval dialog, never the model.", is true again after this change and stays as written.) Run the `docs-reviewer` agent on `permissions.md` and fix every finding.

- [ ] **Step 6: Commit**
  ```bash
  git add pi-runtime/extensions/happyvibe-bridge.ts src/renderer/src/permission.ts src/renderer/src/components/PermissionModal.tsx docs/validation/d1.md tests/child-prompt.test.ts docs/guide/src/content/docs/permissions.md
  git commit -s -F - <<'MSG'
  fix(docs-round #1): a sub-agent's approval dialog names the agent, never the model's task text

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**Bridge coverage:** `tests/tw-child-prompt-bridge.test.ts` (live; it asserts `child: { agent: "writer" }` and never `runLabel`, so it must stay green unchanged). The key-free source scan above pins the absence.

**GUI assertions** (session view, the parent session's pane):
- Ask the main agent: "Use the Agent tool with subagent_type 'worker' and description 'Write files' to create child.txt containing A." When the worker writes, the dialog in the parent's pane is titled exactly "Sub-agent worker wants to run something", with the factual line under it ("Creating child.txt"). The buttons are **Allow**, **Allow for this run**, **Deny**.
- ABSENCE: "Write files" (the model's description) appears nowhere in the dialog, neither in the title nor in the line under it.
- Same page: while the dialog waits, the worker's run circle in the delegation row is amber. That is the run identity the title no longer carries.
- Regression to check: the main session's own delegation dialog is unchanged. Before the worker starts, the dialog reads "The agent wants to run something", then "Sub-agent: worker", then the **sub-agent boundary** block. Answer **Allow for this run** on the child's first write. The same run's second write must not prompt.

---

---

### Task 4: Every session with bypass on shows the red banner (docs-round #2)

**Spec note:** two gaps the spec doesn't mention, both fixed here because the new copy would otherwise be false. (1) A read-only scheduled run is spawned with `HV_BYPASS=1` whenever its workspace bypasses (`ipc.ts:1012` and `:1016` are independent). Bypass doesn't reach it (`happyvibe-bridge.ts:1212`: `if (dangerous && !plan.enabled && !readonly)`), so the notify is sent only `if (dangerous && !readonly)`. Otherwise a read-only run would show "every tool call runs without asking". (2) The workspace switch's live toggle doesn't reach that project's worktree sessions: `ipc.ts:4246` compares the session's raw `workspaceId` (a worktree root) with the project. `applyBypassLive` (`:4228`) already resolves `worktrees.projectOf`, and the filter needs the same resolution before the hint can say "open sessions".

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts:753` (`session_start`, beside the read-only notify)
- Modify: `src/main/ipc.ts:4246` (`hv:set-workspace-bypass` filter)
- Modify: `src/renderer/src/components/WorkspaceSettingsView.tsx:123`
- Modify: `docs/validation/d1.md:147-154` (the `hv.dangerous` wire shape)
- Test: `tests/rules-bridge.test.ts` (existing, key-free, two tests added after `:122`), `tests/bypass.test.ts` (existing, source scans added)
- Guide: `docs/guide/src/content/docs/permissions.md:73`

**Interfaces:** Produces an `hv.dangerous` notify `{"kind":"hv.dangerous","on":true}` at `session_start` when `HV_BYPASS=1` and not `HV_READONLY`. The shape and consumer are unchanged: `parseDangerous` (`permission.ts:140`) → `App.tsx:1123-1124`. No renderer code changes.

- [ ] **Step 1: Write the failing test**. In `tests/rules-bridge.test.ts`, insert after the `/hv-dangerous toggles…` test (after line 122, before the `test.skipIf(!KEY)(` live test). `makeClient`, `isKind`, `payloadOf` and `UiReq` are module-level in that file.

```ts
/**
 * docs round #2: the red banner's only signal is an hv.dangerous notify. The persistent
 * bypass reaches a session as HV_BYPASS=1 at spawn (ipc.ts spawnOpts), so the bridge must
 * announce it at session_start, before any command. Otherwise a session started or
 * restarted with bypass on runs every call without asking and shows no banner. A read-only
 * run holds even under bypass, so it must NOT announce it.
 */
const bootAndCollect = async (env: Record<string, string>, until: (seen: UiReq[]) => boolean): Promise<UiReq[]> => {
  const seen: UiReq[] = [];
  const c = makeClient(env);
  c.on("ui-request", (m) => seen.push(m as UiReq));
  try {
    await c.start();
    // No boot handshake in RPC mode: session_start fires when the boot ends (up to ~16 s cold).
    const deadline = Date.now() + 45_000;
    while (!until(seen) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    return seen;
  } finally {
    c.stop();
  }
};

test("HV_BYPASS=1 announces bypass at session_start, with no command sent", async () => {
  const seen = await bootAndCollect({ HV_BYPASS: "1" }, (s) => s.some((r) => isKind(r, "hv.dangerous")));
  const on = seen.find((r) => isKind(r, "hv.dangerous"));
  expect(on, `no hv.dangerous notify; saw ${JSON.stringify(seen)}`).toBeTruthy();
  expect(on!.method).toBe("notify");
  expect(payloadOf(on!)).toEqual({ kind: "hv.dangerous", on: true });
}, 60_000);

test("a read-only run under HV_BYPASS=1 announces read-only, never bypass", async () => {
  let readonlyAt = 0;
  const seen = await bootAndCollect({ HV_BYPASS: "1", HV_READONLY: "1" }, (s) => {
    if (!readonlyAt && s.some((r) => isKind(r, "hv.readonly"))) readonlyAt = Date.now();
    return readonlyAt > 0 && Date.now() - readonlyAt > 1000; // both would come from the same handler
  });
  expect(seen.some((r) => isKind(r, "hv.readonly")), `saw ${JSON.stringify(seen)}`).toBe(true);
  expect(seen.filter((r) => isKind(r, "hv.dangerous"))).toEqual([]);
}, 60_000);
```

Append to `tests/bypass.test.ts` (add `import { readFileSync } from "node:fs";` as line 3):

```ts
describe("docs round #2: the bypass switches reach open sessions, and the copy says so", () => {
  test("a workspace switch reaches that project's open sessions, worktree sessions included", () => {
    const ipc = readFileSync("src/main/ipc.ts", "utf8");
    const at = ipc.indexOf('ipcMain.handle("hv:set-workspace-bypass"');
    expect(at).toBeGreaterThan(0);
    const handler = ipc.slice(at, at + 500);
    expect(handler).toContain('if (worktrees.projectOf(index.get(id)?.workspaceId ?? "") === workspace) applyBypassLive(id);');
  });

  test("the workspace hint says it applies to open sessions too", () => {
    const view = readFileSync("src/renderer/src/components/WorkspaceSettingsView.tsx", "utf8");
    // Scoped to the bypass hint: the model picker's own "Applies to new or restarted sessions." (:86) is true.
    expect(view).not.toMatch(/banner shows in each session\)\. Applies to new or restarted sessions\./);
    expect(view).toContain("banner shows in each session). Applies to open sessions at once, and to every session you start.");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/rules-bridge.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1 after ~45 s. "HV_BYPASS=1 announces bypass…" fails with `no hv.dangerous notify; saw [...]`. The read-only arm passes already (it guards against the regression the fix could introduce). Run it in the worktree WITHOUT a `.env` symlink: this command doesn't neutralise the keys, and with a key the file's live rule-deny test also runs (paid).
  `L=/tmp/vitest.log; npx vitest run tests/bypass.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1. Both new tests fail on their `toContain`.

- [ ] **Step 3: Implement**

`pi-runtime/extensions/happyvibe-bridge.ts:753-754`. Current:
```ts
    if (readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.readonly", enabled: true }), "info");
    busUi = ctx.ui;
```
Replace with:
```ts
    if (readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.readonly", enabled: true }), "info");
    // docs round #2: the red banner's only signal. The persistent setting arrives as
    // HV_BYPASS at every spawn, so `dangerous` is already true here, and nothing else
    // would say so; `/hv-dangerous` announces its own toggles. Only when ON: a notify
    // on every fresh session would be the first ui-request other bridge tests wait on.
    // Never in a read-only run: bypass doesn't reach it (the tool_call gate), and a
    // banner saying every call runs without asking would be false.
    if (dangerous && !readonly) ctx.ui.notify(JSON.stringify({ kind: "hv.dangerous", on: true }), "warning");
    busUi = ctx.ui;
```

`src/main/ipc.ts:4245-4247`. Current:
```ts
    for (const id of manager.activeIds()) {
      if ((index.get(id)?.workspaceId ?? null) === workspace) applyBypassLive(id);
    }
```
Replace with:
```ts
    for (const id of manager.activeIds()) {
      // §29: a worktree session's workspaceId is the worktree root; its bypass is its project's.
      if (worktrees.projectOf(index.get(id)?.workspaceId ?? "") === workspace) applyBypassLive(id);
    }
```

`src/renderer/src/components/WorkspaceSettingsView.tsx:122-123`. Current:
```tsx
              Overrides the global setting for this workspace. "On" auto-approves every action with no prompts (a red
              banner shows in each session). Applies to new or restarted sessions.
```
Replace with:
```tsx
              Overrides the global setting for this workspace. "On" auto-approves every action with no prompts (a red
              banner shows in each session). Applies to open sessions at once, and to every session you start.
```

`docs/validation/d1.md:147-154`. Current:
````md
### hv.dangerous — /hv-dangerous on|off acknowledgment

```json
{"kind":"hv.dangerous","on":true}
{"kind":"hv.dangerous","stage":"error","message":"Usage: /hv-dangerous on|off"}
```

Per-session, in-bridge-memory only — never persisted, always off after respawn. The renderer drives its warning banner from this notify (forwarded through `hv:ui-request` like all non-audit requests).
````
Replace with:
````md
### hv.dangerous — bypass on/off (/hv-dangerous, and HV_BYPASS at session_start)

```json
{"kind":"hv.dangerous","on":true}
{"kind":"hv.dangerous","stage":"error","message":"Usage: /hv-dangerous on|off"}
```

`/hv-dangerous` is per-session and in bridge memory only, so a toggle is gone after a respawn. The
persistent "Bypass ALL permissions" setting arrives as `HV_BYPASS=1` at every spawn, and the bridge announces
it at `session_start` with `{"kind":"hv.dangerous","on":true}`. It sends that only when bypass is on, and never
in a read-only run (`HV_READONLY`), which bypass doesn't reach (docs round #2). The renderer drives its
warning banner from this notify (forwarded through `hv:ui-request` like all non-audit requests).
````

- [ ] **Step 4: Run it, expect PASS** (both commands above). Expected: EXIT=0 for each. The rules-bridge file takes ~30-40 s (three key-free Pi boots). Its live test reports skipped.

- [ ] **Step 5: Guide**. `docs/guide/src/content/docs/permissions.md:73`.
  Old: `Sessions already open when you switch it on show a red banner, "Dangerous mode is ON for this session — every tool call runs without asking.", whose **Turn off** button makes that session ask again until it restarts. Sessions started or restarted while bypass is on don't show the banner, but bypass applies to them too. To stop bypass for good, turn this switch off.`
  New: `While it's on, every session shows a red banner, "Dangerous mode is ON for this session — every tool call runs without asking.": the ones already open, and every one you start or restart. The banner's **Turn off** button makes that session ask again until it restarts. To stop bypass for good, turn this switch off.`
  Run the `docs-reviewer` agent on `permissions.md` and fix every finding.

- [ ] **Step 6: Commit**
  ```bash
  git add pi-runtime/extensions/happyvibe-bridge.ts src/main/ipc.ts src/renderer/src/components/WorkspaceSettingsView.tsx docs/validation/d1.md tests/rules-bridge.test.ts tests/bypass.test.ts docs/guide/src/content/docs/permissions.md
  git commit -s -F - <<'MSG'
  fix(docs-round #2): every session with bypass on shows the red banner, including new and restarted ones

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**Bridge coverage:** the two key-free tests added to `tests/rules-bridge.test.ts` (they boot Pi with no model, like its `/hv-dangerous` test). No live test needed.

**GUI assertions** (a `src/main` change: restart the dev server, then grep `out/main/index.js` for `projectOf(index.get(id)?.workspaceId`):
- Permissions page: turn **Bypass ALL permissions** on. Start a NEW session. Its session view shows the red banner "Dangerous mode is ON for this session — every tool call runs without asking." as soon as the session is up, before you send anything.
- Session view: quit and relaunch the app with bypass still on, then open that session again. The banner is back once the session wakes.
- ABSENCE: with bypass off (global Off and no workspace override), a new session shows no red banner.
- ABSENCE: a **Read-only** schedule run in a workspace whose bypass is On shows the "Read-only run" pill and NO red banner (Schedules page → run it → its session view).
- Workspace settings page: the bypass hint reads "…(a red banner shows in each session). Applies to open sessions at once, and to every session you start." The model hint above still reads "Applies to new or restarted sessions."
- Worktree: open a session in a worktree of project P (session view), then set P's workspace bypass to On in P's workspace settings. The banner appears in the worktree session without a restart.
- Regression to check: with bypass on and a session open, click the banner's **Turn off**. The banner leaves and the next write prompts. Then turn the global switch Off on the Permissions page. No session shows the banner, and a new session shows none.

---

---

### Task 5: Agent tools pills say which name a per-call tool is checked under (docs-round #3)

**Spec note:** a `workflow` rule can only deny. Every workflow prompts unless a deny rule refuses it (`happyvibe-bridge.ts:1185-1199`: an allow rule falls through to the prompt), so `SubagentWorkflow`'s pill turns an evaluated `allow` into `ask`. The spec says only "evaluated as `workflow`". `permissions.md:51` already says "Only **deny** has an effect". Also: a bare-name `mcp` rule still decides MCP *discovery* calls (`hv-mcp.ts:67-75`, `ruleTool: "mcp"`). The neutral pill is still right, because no single verdict covers the tool, and #34's classifier change is a different task.

**Files:**
- Modify: `src/renderer/src/agents.ts:7-9` (imports), `:73-82` (types + `joinToolPermissions`)
- Modify: `src/renderer/src/components/AllToolsView.tsx:2`, `:7-11`, `:34-43`, `:78-85`
- Modify: `src/renderer/src/components/PermissionRulesSection.tsx:1-3` (imports), `:29-38`, `:61`
- Test: `tests/agents-renderer.test.ts` (existing, one `describe` added)
- Guide: `docs/guide/src/content/docs/agent-tools.md:24`, `:30`; `docs/guide/src/content/docs/permissions.md:61`

**Interfaces:** Produces, in `src/renderer/src/agents.ts`:
- `export interface CheckedAs { name: string; per?: "per MCP tool" | "per agent" | "per site" }`
- `export function checkedAs(tool: string): CheckedAs | null`
- `ToolRow.permission: PermState | NonNullable<CheckedAs["per"]>` and `ToolRow.checkedAs?: CheckedAs`

`PermState` and `joinToolPermissions(tools, verdicts)` keep their signatures. `pi-runtime/extensions/hv-agents.ts:210` has a separate `joinToolPermissions` (bridge side). It is untouched.

- [ ] **Step 1: Write the failing test**. Append to `tests/agents-renderer.test.ts`, and add these imports after line 29 (`readFileSync`, `path` and `joinToolPermissions` are already imported):

```ts
import { checkedAs } from "../src/renderer/src/agents";
import { boundaryRuleName } from "../pi-runtime/extensions/hv-subagent-boundary";
import { unwrapMcpCall } from "../pi-runtime/extensions/hv-mcp";
import { browserRuleName } from "../pi-runtime/extensions/hv-browser";
```

```ts
describe("per-call pills (docs round #3)", () => {
  test("the tools the gate checks under another name say which, and the per-call ones have no verdict", () => {
    expect(checkedAs("mcp")).toEqual({ name: "mcp:<tool>", per: "per MCP tool" });
    expect(checkedAs("Agent")).toEqual({ name: "subagent:<agent>", per: "per agent" });
    for (const t of ["browser_open", "browser_navigate", "web_fetch", "web_map", "web_crawl"]) {
      expect(checkedAs(t)).toEqual({ name: "browser:<host>", per: "per site" });
    }
    expect(checkedAs("SubagentWorkflow")).toEqual({ name: "workflow" });
    // web_search has no host; browser_click never navigates; a directly exposed MCP tool keeps its name.
    for (const t of ["bash", "read", "web_search", "browser_click", "github_create_issue"]) expect(checkedAs(t)).toBeNull();
  });

  test("the names are the gate's own", () => {
    expect(checkedAs("mcp")!.name).toBe(unwrapMcpCall({ tool: "<tool>" }).ruleTool);
    expect(checkedAs("Agent")!.name).toBe(boundaryRuleName("<agent>"));
    expect(browserRuleName("https://example.org")).toBe("browser:example.org");
    const bridge = readFileSync(path.join(process.cwd(), "pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
    expect(bridge).toContain('(tool === "browser_open" || tool === "browser_navigate") && typeof input.url === "string"');
    expect(bridge).toContain('WEB_URL_TOOLS.has(tool) && typeof input.url === "string" ? browserRuleName(input.url) : null');
    expect(bridge).toContain("const permTool = mcp?.ruleTool ?? browserNav ?? webHost ?? (subagentName ? boundaryRuleName(subagentName) : tool);");
    expect(bridge).toContain('evaluate(rules, { tool: "workflow", input');
  });

  test("a per-call tool shows what it is checked per; a workflow never shows allow", () => {
    const tools = [
      { name: "Agent", description: "", source: "" },
      { name: "SubagentWorkflow", description: "", source: "" },
      { name: "bash", description: "", source: "" },
    ];
    expect(joinToolPermissions(tools, { Agent: "deny", SubagentWorkflow: "allow", bash: "deny" })).toEqual([
      { name: "Agent", description: "", source: "", permission: "per agent", checkedAs: { name: "subagent:<agent>", per: "per agent" } },
      { name: "SubagentWorkflow", description: "", source: "", permission: "ask", checkedAs: { name: "workflow" } },
      { name: "bash", description: "", source: "", permission: "deny" },
    ]);
    expect(joinToolPermissions([tools[1]], { SubagentWorkflow: "deny" })[0].permission).toBe("deny");
  });

  test("the page evaluates the checked name, and the test box says which name to test", () => {
    const view = readFileSync(path.join(process.cwd(), "src/renderer/src/components/AllToolsView.tsx"), "utf8");
    expect(view).toMatch(/evalRules\(ws, checkedAs\(t\.name\)\?\.name \?\? t\.name, \{\}\)/);
    expect(view).not.toMatch(/evalRules\(ws, t\.name, \{\}\)/);
    expect(view).toContain("Checked as <span className=\"font-mono\">{t.checkedAs.name}</span> on every call.");
    const box = readFileSync(path.join(process.cwd(), "src/renderer/src/components/PermissionRulesSection.tsx"), "utf8");
    expect(box).toContain("checkedAs(tool.trim())");
    expect(box).toContain("is checked as ${c.name} on every call. Test that name instead.");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1, with `TypeError: checkedAs is not a function` (not exported yet) in the new tests. The existing `joinToolPermissions (renderer)` test still passes.

- [ ] **Step 3: Implement**

`src/renderer/src/agents.ts:7-9`. Current:
```ts
import { delegationRunId, displayableTask, isDelegationTool } from "../../../pi-runtime/extensions/hv-rules";
import { subagentRosterLine } from "../../../pi-runtime/extensions/hv-agents";
import { fmtNum } from "./analytics-format";
```
Replace with (both new modules are pure: `hv-tw-gate` imports only `hv-subagent-boundary`, `hv-web` only `hv-browser`):
```ts
import { delegationRunId, displayableTask, isDelegationTool } from "../../../pi-runtime/extensions/hv-rules";
import { subagentRosterLine } from "../../../pi-runtime/extensions/hv-agents";
import { AGENT_TOOL, WORKFLOW_TOOL } from "../../../pi-runtime/extensions/hv-tw-gate";
import { WEB_URL_TOOLS } from "../../../pi-runtime/extensions/hv-web";
import { fmtNum } from "./analytics-format";
```

`src/renderer/src/agents.ts:73-82`. Current:
```ts
export type PermState = "allow" | "ask" | "deny";

export interface ToolRow extends ToolInfo {
  permission: PermState;
}

/** Join a tool list against per-tool verdicts. A tool with no verdict → "ask". */
export function joinToolPermissions(tools: ToolInfo[], verdicts: Record<string, PermState>): ToolRow[] {
  return tools.map((t) => ({ ...t, permission: verdicts[t.name] ?? "ask" }));
}
```
Replace with:
```ts
export type PermState = "allow" | "ask" | "deny";

/**
 * docs round #3: the name the bridge's gate checks a tool's calls under, when it isn't the
 * tool's own (happyvibe-bridge.ts `permTool`, and the SubagentWorkflow gate). `per` is set
 * when that name changes with the call (which MCP tool, which agent, which site), so the
 * bare name has no verdict of its own: a deny rule on `Agent` would paint the pill red while
 * every delegation still prompts. A directly exposed MCP tool keeps its own name (null here).
 */
export interface CheckedAs {
  name: string;
  per?: "per MCP tool" | "per agent" | "per site";
}

export function checkedAs(tool: string): CheckedAs | null {
  if (tool === "mcp") return { name: "mcp:<tool>", per: "per MCP tool" };
  if (tool === AGENT_TOOL) return { name: "subagent:<agent>", per: "per agent" };
  if (tool === "browser_open" || tool === "browser_navigate" || WEB_URL_TOOLS.has(tool)) {
    return { name: "browser:<host>", per: "per site" };
  }
  if (tool === WORKFLOW_TOOL) return { name: "workflow" };
  return null;
}

export interface ToolRow extends ToolInfo {
  /** The verdict, or, for a per-call tool, what it is checked per (a pill, never a verdict). */
  permission: PermState | NonNullable<CheckedAs["per"]>;
  checkedAs?: CheckedAs;
}

/** Join a tool list against per-tool verdicts. A tool with no verdict → "ask". */
export function joinToolPermissions(tools: ToolInfo[], verdicts: Record<string, PermState>): ToolRow[] {
  return tools.map((t) => {
    const c = checkedAs(t.name);
    if (!c) return { ...t, permission: verdicts[t.name] ?? "ask" };
    if (c.per) return { ...t, permission: c.per, checkedAs: c };
    // The one fixed-name case is the workflow gate. It prompts unless a rule DENIES,
    // and an allow rule never skips it, so the pill never says allow.
    const v = verdicts[t.name] ?? "ask";
    return { ...t, permission: v === "allow" ? "ask" : v, checkedAs: c };
  });
}
```

`src/renderer/src/components/AllToolsView.tsx:2`. Current:
```tsx
import { joinToolPermissions, type PermState, type ToolInfo, type ToolRow } from "../agents";
```
Replace with:
```tsx
import { checkedAs, joinToolPermissions, type PermState, type ToolInfo, type ToolRow } from "../agents";
```

`src/renderer/src/components/AllToolsView.tsx:7-11`. Current:
```tsx
const PERM_TONE: Record<PermState, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  ask: "bg-honey-soft text-tangerine-deep border-honey/60",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
};
```
Replace with:
```tsx
const PERM_TONE: Record<ToolRow["permission"], string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  ask: "bg-honey-soft text-tangerine-deep border-honey/60",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
  // docs round #3: not verdicts. Which rule decides depends on the call.
  "per MCP tool": "bg-card text-ink-soft border-line",
  "per agent": "bg-card text-ink-soft border-line",
  "per site": "bg-card text-ink-soft border-line",
};
```

`src/renderer/src/components/AllToolsView.tsx:34-37`. Current:
```tsx
      {open && (
        <div className="px-4 pb-3 pt-0 flex flex-col gap-2">
          <p className="text-sm text-ink whitespace-pre-wrap">{t.description || "No description provided."}</p>
          {t.source && (
```
Replace with:
```tsx
      {open && (
        <div className="px-4 pb-3 pt-0 flex flex-col gap-2">
          <p className="text-sm text-ink whitespace-pre-wrap">{t.description || "No description provided."}</p>
          {t.checkedAs && (
            <p className="text-xs text-ink-soft">
              Checked as <span className="font-mono">{t.checkedAs.name}</span> on every call.
            </p>
          )}
          {t.source && (
```

`src/renderer/src/components/AllToolsView.tsx:78-85`. Current:
```tsx
  // Join tools against the SAME rules engine the bridge runs (hv:eval-rules).
  useEffect(() => {
    if (!tools) return setToolRows(null);
    const ws = workspaceId ?? "";
    let stale = false;
    void Promise.all(
      tools.map((t) => window.hv.evalRules(ws, t.name, {}).then((v) => [t.name, v.action] as const)),
    ).then((pairs) => {
```
Replace with:
```tsx
  // Join tools against the SAME rules engine the bridge runs (hv:eval-rules), under the
  // name the gate checks (docs round #3: SubagentWorkflow is checked as `workflow`). A
  // per-call name (mcp:<tool>, subagent:<agent>, browser:<host>) has no one verdict to ask for.
  useEffect(() => {
    if (!tools) return setToolRows(null);
    const ws = workspaceId ?? "";
    let stale = false;
    void Promise.all(
      tools
        .filter((t) => !checkedAs(t.name)?.per)
        .map((t) => window.hv.evalRules(ws, checkedAs(t.name)?.name ?? t.name, {}).then((v) => [t.name, v.action] as const)),
    ).then((pairs) => {
```
(`PermState` stays imported: `:87` still casts the verdicts with it.)

`src/renderer/src/components/PermissionRulesSection.tsx:1-3`. Current:
```tsx
import { useEffect, useState } from "react";
import { EmptyState } from "./EmptyState";
import { HowItWorks } from "./HowItWorks";
```
Replace with:
```tsx
import { useEffect, useState } from "react";
import { EmptyState } from "./EmptyState";
import { HowItWorks } from "./HowItWorks";
import { checkedAs } from "../agents";
```

`src/renderer/src/components/PermissionRulesSection.tsx:29-38`. Current:
```tsx
function TestBox({ workspace }: { workspace: string }): React.JSX.Element {
  const [tool, setTool] = useState("bash");
  const [arg, setArg] = useState("");
  const [verdict, setVerdict] = useState<HvVerdict | null>(null);

  const run = async (): Promise<void> => {
    // bash-ish tools carry a command; everything else a path — same keys the engine scans.
    const input = tool === "bash" ? { command: arg } : { path: arg };
    setVerdict(await window.hv.evalRules(workspace, tool, input));
  };
```
Replace with:
```tsx
function TestBox({ workspace }: { workspace: string }): React.JSX.Element {
  const [tool, setTool] = useState("bash");
  const [arg, setArg] = useState("");
  const [verdict, setVerdict] = useState<HvVerdict | null>(null);
  // docs round #3: a tool the gate checks under another name has no verdict under its own.
  const [instead, setInstead] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    const c = checkedAs(tool.trim());
    if (c) {
      setVerdict(null);
      setInstead(`${tool.trim()} is checked as ${c.name} on every call. Test that name instead.`);
      return;
    }
    setInstead(null);
    // bash-ish tools carry a command; everything else a path — same keys the engine scans.
    const input = tool === "bash" ? { command: arg } : { path: arg };
    setVerdict(await window.hv.evalRules(workspace, tool, input));
  };
```

`src/renderer/src/components/PermissionRulesSection.tsx:61`. Current:
```tsx
      {verdict && (
```
Replace with:
```tsx
      {instead && <p className="text-xs mt-2 text-ink-soft">{instead}</p>}
      {verdict && (
```

- [ ] **Step 4: Run it, expect PASS** (same command). Expected: EXIT=0. Also run `tests/hv-agents.test.ts` and `tests/sidebar-groups.test.ts` the same way (they pin `joinToolPermissions` and `AllToolsView.tsx`). Expected: EXIT=0.

- [ ] **Step 5: Guide**
  `docs/guide/src/content/docs/agent-tools.md:24`. After `- **deny**: it's blocked.` add a fourth bullet:
  `- **per MCP tool**, **per agent** or **per site**: the tool is checked under another name on each call, so it has no one answer. Open the row to see that name, for example "Checked as subagent:<agent> on every call."`
  `docs/guide/src/content/docs/agent-tools.md:30`.
  Old: ``A few tools are checked under another name on a real call: `mcp` per MCP tool (unless its server has **Expose tools directly** ticked, then each tool keeps its own name), `Agent` per subagent, `SubagentWorkflow` as `workflow`, and the browser and web tools that open an address per site. Their pills here don't show those rules. [Permissions](/docs/permissions/) lists the names to use.``
  New: ``A few tools are checked under another name on a real call: `mcp` per MCP tool (unless its server has **Expose tools directly** ticked, then each tool keeps its own name), `Agent` per subagent, and the browser and web tools that open an address per site. Their pill says which, instead of a verdict. `SubagentWorkflow` is checked as `workflow`, and its pill shows your `workflow` rules. Every workflow asks unless a rule denies it, so that pill never says **allow**. [Permissions](/docs/permissions/) lists the names to use.``
  `docs/guide/src/content/docs/permissions.md:61`. After the paragraph that begins `The answer is **allow**, **ask** or **deny**, followed by why:` add:
  ``Type a tool that's checked under another name (`mcp`, `Agent`, `SubagentWorkflow`, or a browser or web tool that opens an address), and the box names the one to test instead, for example "Agent is checked as subagent:<agent> on every call. Test that name instead."``
  Run the `docs-reviewer` agent on both pages and fix every finding.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/agents.ts src/renderer/src/components/AllToolsView.tsx src/renderer/src/components/PermissionRulesSection.tsx tests/agents-renderer.test.ts docs/guide/src/content/docs/agent-tools.md docs/guide/src/content/docs/permissions.md
  git commit -s -F - <<'MSG'
  fix(docs-round #3): Agent tools says which name a per-call tool is checked under, instead of a verdict it doesn't have

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**:
- Permissions page: add a global tool rule `Agent` → **deny** and save. Agent tools page (with a session selected, so the list fills): the `Agent` row's pill reads "PER AGENT" in grey. Opening the row shows "Checked as subagent:<agent> on every call."
- ABSENCE: no red **DENY** pill on the `Agent`, `mcp`, `browser_navigate` or `web_fetch` rows from a bare-name deny rule. Then check that no deny is really in force: ask the agent to delegate to `code-explorer`. The delegation dialog still opens (session view).
- Agent tools page: with a `workflow` → **allow** rule, the `SubagentWorkflow` pill reads **ASK**, not **ALLOW**. With a `workflow` → **deny** rule it reads **DENY**.
- Permissions page, test box: type `Agent` and click **Evaluate**. It shows "Agent is checked as subagent:<agent> on every call. Test that name instead." and no verdict line. Type `subagent:code-explorer` and click **Evaluate**. You get a normal verdict line.
- Regression to check: a `bash` → **deny** rule still turns the `bash` pill red on Agent tools. `read` still reads **ALLOW** ("safe tool default").

---

---

### Task 6: Every paste into a terminal asks before running several lines (docs-round #4, #12 plural)

**Spec note:** `allowPaste` takes an optional `ask` (default `(q) => window.confirm(q)`) so vitest can drive it. It lives in `src/main/terminalSettings.ts`, which both emulators already import (`fontStack`). That module is import-free, and the base tsconfig sets no `lib`, so DOM types exist there. `window` is touched only when the renderer calls it. #12's exit-bar half (`formatBinding(closeKey)`, `TerminalTab.tsx:294`) is NOT in this task.

**Files:**
- Modify: `src/main/terminalSettings.ts:199` (append two exports)
- Modify: `src/renderer/src/components/TerminalTab.tsx:9`, `:204-225`, `:250`
- Modify: `src/renderer/src/components/TerminalRunCard.tsx:7`, `:258`
- Test: `tests/terminal-settings.test.ts` (existing, one `describe` added)
- Guide: `docs/guide/src/content/docs/terminal.md:44`, `:72`

**Interfaces:** Produces, in `src/main/terminalSettings.ts`:
- `export function pasteWarning(text: string): string | null`
- `export function allowPaste(text: string, warn: boolean, ask?: (question: string) => boolean): boolean`

- [ ] **Step 1: Write the failing test**. In `tests/terminal-settings.test.ts`, add after line 9:
```ts
import { readFileSync } from "node:fs";
import { allowPaste, pasteWarning } from "../src/main/terminalSettings";
```
and append:
```ts
describe("the multi-line paste question (docs round #4, #12)", () => {
  it("asks only when a newline would run, and counts lines in English", () => {
    expect(pasteWarning("ls -la")).toBeNull();
    expect(pasteWarning("  ls -la  ")).toBeNull();
    expect(pasteWarning("ls -la\n")).toBe("Paste and run 1 line? A pasted newline executes immediately.");
    expect(pasteWarning("cd /tmp\nrm -rf x\n")).toBe("Paste and run 2 lines? A pasted newline executes immediately.");
    expect(pasteWarning("a\r\nb\r\nc")).toBe("Paste and run 3 lines? A pasted newline executes immediately.");
  });

  it("allowPaste asks that exact question, and only while the setting is on", () => {
    const asked: string[] = [];
    const no = (q: string): boolean => { asked.push(q); return false; };
    expect(allowPaste("a\nb", true, no)).toBe(false);
    expect(asked).toEqual(["Paste and run 2 lines? A pasted newline executes immediately."]);
    expect(allowPaste("a\nb", false, no)).toBe(true);
    expect(allowPaste("one line", true, no)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(allowPaste("a\nb", true, () => true)).toBe(true);
  });

  it("both emulators ask in the CAPTURE phase, and a right-click paste goes through the same check", () => {
    const tab = readFileSync("src/renderer/src/components/TerminalTab.tsx", "utf8");
    const card = readFileSync("src/renderer/src/components/TerminalRunCard.tsx", "utf8");
    for (const src of [tab, card]) {
      // xterm's own paste listener stops propagation, so a bubbling onPaste never runs.
      expect(src).toContain("onPasteCapture={onPasteCapture}");
      expect(src).not.toMatch(/\sonPaste=\{/);
      expect(src).toContain('allowPaste(e.clipboardData.getData("text"), live.current.warnMultilinePaste)');
    }
    const at = tab.indexOf("const onContextMenu");
    const menu = tab.slice(at, at + 600);
    expect(menu).toContain("allowPaste(text, live.current.warnMultilinePaste)) term.current?.paste(text)");
    expect(menu).not.toContain("termInput");
    expect(tab).not.toContain("${lines} lines?");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/terminal-settings.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1, with `TypeError: pasteWarning is not a function` / `allowPaste is not a function` in the first two tests. The source-scan test fails on `toContain("onPasteCapture={onPasteCapture}")`.

- [ ] **Step 3: Implement**

`src/main/terminalSettings.ts`, append after line 199 (end of file):
```ts

/**
 * §26: the question to ask before a paste runs, or null when it needs none. A block
 * containing or ending in a newline EXECUTES on arrival, which is why the multi-line
 * warning is a safety setting rather than a preference.
 */
export function pasteWarning(text: string): string | null {
  if (!/\n/.test(text.trim()) && !text.endsWith("\n")) return null;
  const lines = text.trimEnd().split("\n").length;
  return `Paste and run ${lines} ${lines === 1 ? "line" : "lines"}? A pasted newline executes immediately.`;
}

/**
 * docs round #4: the ONE paste check, for every route into an emulator (keyboard, right
 * click, the agent terminal card). `ask` is injectable so vitest can drive it; the default
 * is only ever reached in the renderer.
 */
export function allowPaste(text: string, warn: boolean, ask: (question: string) => boolean = (q) => window.confirm(q)): boolean {
  const question = warn ? pasteWarning(text) : null;
  return question === null || ask(question);
}
```

`src/renderer/src/components/TerminalTab.tsx:9`. Current:
```tsx
import { fontStack } from "../../../main/terminalSettings";
```
Replace with:
```tsx
import { allowPaste, fontStack } from "../../../main/terminalSettings";
```

`src/renderer/src/components/TerminalTab.tsx:204-225`. Current:
```tsx
  /**
   * Pasting is where a terminal can hurt someone who did not mean it: a block
   * ending in a newline EXECUTES on arrival. §26 calls this a safety setting
   * rather than a preference, which is why it defaults on.
   */
  const onPaste = (e: React.ClipboardEvent): void => {
    if (!live.current.warnMultilinePaste) return;
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text.trim()) && !text.endsWith("\n")) return;
    const lines = text.trimEnd().split("\n").length;
    if (!window.confirm(`Paste and run ${lines} lines? A pasted newline executes immediately.`)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onContextMenu = (e: React.MouseEvent): void => {
    if (!live.current.rightClickPastes) return; // macOS convention is a menu
    e.preventDefault();
    void navigator.clipboard.readText().then((text) => {
      if (text) void window.hv.termInput(terminalId, text);
    });
  };
```
Replace with:
```tsx
  /**
   * Pasting is where a terminal can hurt someone who did not mean it: a block
   * ending in a newline EXECUTES on arrival. §26 calls this a safety setting
   * rather than a preference, which is why it defaults on.
   *
   * CAPTURE, not onPaste (docs round #4): xterm's own paste listener on its
   * textarea calls stopPropagation() and writes the text at once, so a bubbling
   * handler here never ran. React's capture listener sits at the root and runs
   * first, and stopping the event there keeps a refused paste from reaching xterm.
   */
  const onPasteCapture = (e: React.ClipboardEvent): void => {
    if (!allowPaste(e.clipboardData.getData("text"), live.current.warnMultilinePaste)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onContextMenu = (e: React.MouseEvent): void => {
    if (!live.current.rightClickPastes) return; // macOS convention is a menu
    e.preventDefault();
    void navigator.clipboard.readText().then((text) => {
      // Through xterm's paste(), never a raw termInput: it applies bracketed paste
      // and line-ending normalisation, exactly as a keyboard paste does.
      if (text && allowPaste(text, live.current.warnMultilinePaste)) term.current?.paste(text);
    });
  };
```

`src/renderer/src/components/TerminalTab.tsx:250`. Current:
```tsx
      onPaste={onPaste}
```
Replace with:
```tsx
      onPasteCapture={onPasteCapture}
```

`src/renderer/src/components/TerminalRunCard.tsx:7`. Current:
```tsx
import { fontStack } from "../../../main/terminalSettings";
```
Replace with:
```tsx
import { allowPaste, fontStack } from "../../../main/terminalSettings";
```

`src/renderer/src/components/TerminalRunCard.tsx:258`. Current:
```tsx
  return <div ref={host} className="border-t-2 border-line h-64 px-2 py-1.5 bg-paper-deep/40" />;
```
Replace with:
```tsx
  // docs round #4: the same paste question as a terminal tab (TerminalTab.tsx). Typing here
  // is ungated, but a pasted newline still runs, and that is the user's own safety setting.
  const onPasteCapture = (e: React.ClipboardEvent): void => {
    if (!allowPaste(e.clipboardData.getData("text"), live.current.warnMultilinePaste)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return <div ref={host} onPasteCapture={onPasteCapture} className="border-t-2 border-line h-64 px-2 py-1.5 bg-paper-deep/40" />;
```

- [ ] **Step 4: Run it, expect PASS** (same command). Expected: EXIT=0. Also run `tests/run-rail-layout.test.ts` the same way (it scans `TerminalRunCard.tsx`). Expected: EXIT=0.

- [ ] **Step 5: Guide**
  `docs/guide/src/content/docs/terminal.md:44`.
  Old: `- **Warn on multi-line paste** (on by default): "A safety setting, not a preference: a pasted block ending in a newline runs the moment it lands." With it on, pasting text that contains or ends with a line break asks first, for example "Paste and run 3 lines? A pasted newline executes immediately." A right-click paste (with **Right-click pastes** on) doesn't ask, so paste several lines with the keyboard instead.`
  New: `- **Warn on multi-line paste** (on by default): "A safety setting, not a preference: a pasted block ending in a newline runs the moment it lands." With it on, pasting text that contains or ends with a line break asks first, for example "Paste and run 3 lines? A pasted newline executes immediately." Every paste asks: from the keyboard, with a right-click (when **Right-click pastes** is on), and into an agent terminal's card.`
  `docs/guide/src/content/docs/terminal.md:72`.
  Old: `Agent terminals use the same style and appearance settings as yours.`
  New: `Agent terminals use the same style and appearance settings as yours, and the same **Warn on multi-line paste**.`
  Run the `docs-reviewer` agent on `terminal.md` and fix every finding.

- [ ] **Step 6: Commit**
  ```bash
  git add src/main/terminalSettings.ts src/renderer/src/components/TerminalTab.tsx src/renderer/src/components/TerminalRunCard.tsx tests/terminal-settings.test.ts docs/guide/src/content/docs/terminal.md
  git commit -s -F - <<'MSG'
  fix(docs-round #4): every paste into a terminal asks before running several lines, and "1 line" reads right

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (the spec lists the keyboard half as "still to confirm live"; these are that check). `src/main/terminalSettings.ts` is bundled into the renderer here, so a renderer reload is enough, but restart anyway because it's a `src/main` file:
- Terminal tab: copy `echo one` + newline + `echo two` + newline, click into the terminal, press ⌘V (Ctrl+V). A dialog asks "Paste and run 2 lines? A pasted newline executes immediately."
- ABSENCE: answer Cancel. Nothing appears at the prompt: no `echo one`, no output.
- Terminal tab: copy `pwd` + newline. ⌘V asks "Paste and run 1 line? A pasted newline executes immediately." (singular).
- Terminal settings page: turn **Right-click pastes** on. Back in the terminal tab, right-click with the two-line text copied. The same question appears. Cancel pastes nothing. OK pastes both lines; zsh/bash shows the block as a paste (bracketed) rather than typing it.
- Agent terminal card (session view: ask the agent to start `npm run dev` or any `terminal_run`, open its card): ⌘V with the two-line text asks the same question.
- Regression to check: paste a single line with no newline (`ls`). It lands at once with no dialog, in both the tab and the card. Then turn **Warn on multi-line paste** off on the Terminal settings page. A two-line paste lands with no dialog.

---

---

### Task 7: A shortcut needs ⌘/Ctrl, and a saved one without it falls back (docs-round #5)

**Spec note:** if a saved `Shift-…` binding falls back to a default that another override already holds (e.g. `newTerminal: "Shift-a"` with `newSession: "Mod-t"`), two actions show the same keys and the first in `App.tsx`'s dispatch order wins. Not handled (hand-edited or legacy configs only). The Shortcuts page shows both rows, and re-recording either fixes it.

**Files:**
- Modify: `src/renderer/src/shortcuts.ts:98-106` (`eventToBinding`), `:131-139` (`resolveBindings`)
- Modify: `src/renderer/src/components/ShortcutsView.tsx:40` (comment only)
- Test: `tests/shortcuts.test.ts` (existing, two tests added)
- Guide: `docs/guide/src/content/docs/keyboard-shortcuts.md:57`

**Interfaces:** `eventToBinding` now returns only `Mod-…` bindings (it still returns `string | null`). `resolveBindings` still returns `Record<ShortcutId, string>`. Its values now always start with `Mod-`. Both consumers (`App.tsx:3145` dispatch, `ChatView.tsx:784` `matchesBinding`, `ShortcutsView.tsx:39` recorder) go through `eventToBinding`, so capture and dispatch change together.

- [ ] **Step 1: Write the failing test**. In `tests/shortcuts.test.ts`, add after the `"a bare key or a lone modifier is not a binding"` test (after line 24):
```ts
test("a binding needs ⌘/Ctrl: Shift or Alt alone would take over typing (docs round #5)", () => {
  expect(eventToBinding(ev({ key: "A", shiftKey: true }))).toBeNull();
  expect(eventToBinding(ev({ key: "e", altKey: true }))).toBeNull();
  expect(eventToBinding(ev({ key: "E", shiftKey: true, altKey: true }))).toBeNull();
  expect(eventToBinding(ev({ key: "A", metaKey: true, shiftKey: true }))).toBe("Mod-Shift-a");
  expect(eventToBinding(ev({ key: "x", ctrlKey: true, altKey: true }))).toBe("Mod-Alt-x");
});

test("resolveBindings drops a saved binding without ⌘/Ctrl, so it falls back instead of going dead", () => {
  const b = resolveBindings({ newSession: "Shift-a", newTerminal: "Alt-t", save: "Mod-Shift-s" });
  expect(b.newSession).toBe("Mod-n");
  expect(b.newTerminal).toBe("Mod-t");
  expect(b.save).toBe("Mod-Shift-s");
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/shortcuts.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: EXIT=1. The first new test fails with `expected 'Shift-a' to be null`. The second with `expected 'Shift-a' to be 'Mod-n'`.

- [ ] **Step 3: Implement**

`src/renderer/src/shortcuts.ts:97-106`. Current:
```ts
/** A KeyboardEvent → its canonical binding, or null when it isn't one. */
export function eventToBinding(e: KeyEventish): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (parts.length === 0) return null; // a bare key is never an app shortcut
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("-");
}
```
Replace with:
```ts
/** A KeyboardEvent → its canonical binding, or null when it isn't one. */
export function eventToBinding(e: KeyEventish): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // docs round #5: ⌘/Ctrl is required, not merely some modifier. Shift+A is a capital A
  // and Option+E an accent; the app-wide handler would swallow them while you type.
  if (!(e.metaKey || e.ctrlKey)) return null;
  const parts = ["Mod"];
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("-");
}
```

`src/renderer/src/shortcuts.ts:131-139`. Current:
```ts
/** Stored overrides layered over the defaults. Unknown ids are dropped, so a
    renamed action can never resurrect a stale binding from an old config. */
export function resolveBindings(saved: Record<string, string> | null | undefined): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const a of SHORTCUT_ACTIONS) {
    const s = saved?.[a.id];
    out[a.id] = typeof s === "string" && s.length > 0 ? s : a.defaultKey;
  }
  return out;
}
```
Replace with:
```ts
/** Stored overrides layered over the defaults. Unknown ids are dropped, so a
    renamed action can never resurrect a stale binding from an old config. A saved
    binding without ⌘/Ctrl is dropped too (docs round #5): eventToBinding can never
    produce one again, so it would be a dead key, and it would swallow typing. */
export function resolveBindings(saved: Record<string, string> | null | undefined): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const a of SHORTCUT_ACTIONS) {
    const s = saved?.[a.id];
    out[a.id] = typeof s === "string" && s.startsWith("Mod-") ? s : a.defaultKey;
  }
  return out;
}
```

`src/renderer/src/components/ShortcutsView.tsx:40`. Current:
```tsx
      if (!next) return; // still holding modifiers — keep listening
```
Replace with:
```tsx
      if (!next) return; // a lone modifier, or no ⌘/Ctrl yet — keep listening
```

- [ ] **Step 4: Run it, expect PASS** (same command). Expected: EXIT=0. The existing `resolveBindings` test (`save: ""` → `"Mod-s"`, `newSession: "Mod-Shift-n"` kept) still passes.

- [ ] **Step 5: Guide**. `docs/guide/src/content/docs/keyboard-shortcuts.md:57`.
  Old: `2. Press the new combination. Include ⌘ on macOS or Ctrl on Windows and Linux, plus a key. Shift or Alt alone would take over normal typing. (On macOS, Ctrl counts as ⌘. On Windows and Linux, the Windows key counts as Ctrl.)`
  New: `2. Press the new combination: ⌘ on macOS or Ctrl on Windows and Linux, plus a key, with Shift or Alt too if you like. Without ⌘ or Ctrl the button keeps waiting, because Shift or Alt on its own would take over normal typing. (On macOS, Ctrl counts as ⌘. On Windows and Linux, the Windows key counts as Ctrl.)`
  Run the `docs-reviewer` agent on `keyboard-shortcuts.md` and fix every finding.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/shortcuts.ts src/renderer/src/components/ShortcutsView.tsx tests/shortcuts.test.ts docs/guide/src/content/docs/keyboard-shortcuts.md
  git commit -s -F - <<'MSG'
  fix(docs-round #5): a shortcut needs ⌘/Ctrl, so a recorded Shift or Alt combination can't swallow your typing

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**:
- Keyboard shortcuts page (**App features** → **Keyboard shortcuts**): click the keys next to "New session in the current workspace". The button says "press…". Press Shift+A: it keeps saying "press…" and nothing is saved. Press Esc: the row still shows ⌘N (Ctrl+N).
- Same page: record ⌘⇧A (Ctrl+Shift+A) for it. The row shows ⌘⇧A. Pressing it anywhere opens a new session.
- ABSENCE: after the Shift+A attempt, type "Hello All" in a session's message box (session view). The capital letters appear, and no new session opens.
- Regression to check: quit the app and put `"shortcuts": { "newSession": "Shift-a" }` in `config.json` (userData). Relaunch. The Keyboard shortcuts page shows ⌘N for New session, ⌘N opens a session, and typing a capital A in the message box types it. Afterwards, **Reset** the row (or restore the file) so the next recording isn't layered on it.

---

### Task 8: Key hints follow the binding and the platform (docs-round #28, #12 first half, #22 "⇧Enter", #11 escape, #32 search tooltip)

**Spec note:** Sidebar gets its two hints ALREADY formatted from App, following Sidebar's own documented
convention (`Sidebar.tsx:775-777`: "`formatBinding` stays in App"). TerminalTab, FileTab and ChatView
get the RAW binding and format it themselves, as the spec says for `closeKey` ("passed like
`searchKey`"). `noUnusedLocals` is on (`@electron-toolkit/tsconfig`), so every `MOD` import this task
empties must be deleted, or `npm run build` fails at typecheck.

**Files:**
- Modify: `src/renderer/src/App.tsx:3305-3306`, `:3686-3689`
- Modify: `src/renderer/src/components/Sidebar.tsx:3`, `:688-689`, `:778-779`, `:995`, `:1095`, `:1104`
- Modify: `src/renderer/src/components/FileTab.tsx:2`, `:342-343`
- Modify: `src/renderer/src/components/ChatView.tsx:3`, `:9`, `:1100`
- Modify: `src/renderer/src/components/TerminalTab.tsx:2`, `:33`, `:46`, `:294`
- Modify: `src/renderer/src/components/feedbackCopy.ts:1`, `:30`
- Modify: `src/renderer/src/shortcuts.ts:83`
- Modify: `src/renderer/src/components/VoiceView.tsx:2`, `:336`
- Test: `tests/mod-key-copy.test.ts` (existing, extended)
- Guide: `docs/guide/src/content/docs/keyboard-shortcuts.md:8`, `:47`, `:75`; `docs/guide/src/content/docs/terminal.md:56`

**Interfaces:**
- Consumes: `formatBinding(binding: string, mac = IS_MAC): string` (`shortcuts.ts:119`); App's
  `bindings: Record<ShortcutId, string>` (`App.tsx:409`).
- Produces: `Sidebar` props `findSessionKey: string` and `sidebarKey: string` (FORMATTED text);
  `TerminalTab` prop `closeKey: string` (RAW binding, e.g. `"Mod-w"`).
- Shares files with Task 15 (`Sidebar.tsx`, other lines) and Task 17 (`ChatView.tsx` imports; Task 8
  edits lines 3 and 9, Task 17 adds a line after 10). No overlapping hunks.

- [ ] **Step 1: Write the failing test**

In `tests/mod-key-copy.test.ts`, replace the import on line 5:

```ts
import { formatBinding } from "../src/renderer/src/shortcuts";
```

with:

```ts
import { FIXED_SHORTCUTS, formatBinding } from "../src/renderer/src/shortcuts";
```

and add this block after the `describe("no literal ⌘ survives in rendered copy", …)` block (after line 82):

```ts
describe("docs-round #28/#12/#22/#11: a key hint follows the binding", () => {
  /**
   * `${MOD}K` printed "CtrlK" off macOS — no separator — and ignored a rebound
   * shortcut, because MOD is a glyph, not a binding. MOD stays for naming the
   * key itself ("Hold right Ctrl"); a COMBINATION goes through formatBinding.
   */
  it("no hint glues MOD to a key", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      for (const line of code(f).split("\n")) {
        if (/\{MOD\}[A-Za-z0-9\\,./]/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "use formatBinding(binding) instead").toEqual([]);
  });

  it("no ⌘ hides behind a \\u2318 escape — a JSX attribute prints it as six characters", () => {
    const offenders = walk(SRC)
      .filter((f) => /\\u2318/i.test(code(f)))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("the Built-in list names Shift the way the running platform does", () => {
    expect(code(path.join(SRC, "shortcuts.ts"))).not.toContain('"⇧Enter"');
    expect(code(path.join(SRC, "shortcuts.ts"))).toContain('formatBinding("Shift-Enter")');
    expect(FIXED_SHORTCUTS.map((s) => s.keys)).toContain(formatBinding("Shift-Enter"));
    expect(formatBinding("Shift-Enter", false)).toBe("Shift+Enter");
    expect(formatBinding("Shift-Enter", true)).toBe("⇧Enter");
  });

  it("every hinted surface gets the RESOLVED binding from App", () => {
    const app = code(path.join(SRC, "App.tsx"));
    expect(app).toContain("findSessionKey={formatBinding(bindings.findSession)}");
    expect(app).toContain("sidebarKey={formatBinding(bindings.toggleSidebar)}");
    expect(app).toContain("closeKey={bindings.closeTab}");
    const sites: Array<[string, string]> = [
      ["components/Sidebar.tsx", "Find a session (${findSessionKey})"],
      ["components/Sidebar.tsx", "Collapse sidebar (${sidebarKey})"],
      ["components/Sidebar.tsx", "Expand sidebar (${sidebarKey})"],
      ["components/FileTab.tsx", "Save (${formatBinding(saveKey)})"],
      ["components/ChatView.tsx", "Search this conversation (${formatBinding(searchKey)})"],
      ["components/TerminalTab.tsx", "{formatBinding(closeKey)} closes this tab"],
      ["components/feedbackCopy.ts", 'Paste an image (${formatBinding("Mod-v")}) or'],
      ["components/VoiceView.tsx", "Hold right ${MOD} to dictate"],
    ];
    for (const [file, hint] of sites) expect(code(path.join(SRC, file)), file).toContain(hint);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

`L=/tmp/vitest.log; npx vitest run tests/mod-key-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=1 with four failures:
- "no hint glues MOD to a key" lists `components/TerminalTab.tsx`, `components/FileTab.tsx` (2 lines),
  `components/ChatView.tsx`, `components/feedbackCopy.ts` and `components/Sidebar.tsx` (3 lines).
- The escape test lists `components/VoiceView.tsx`.
- The Shift test fails on `not.toContain('"⇧Enter"')`.
- The App test fails on `findSessionKey={formatBinding(bindings.findSession)}`.

- [ ] **Step 3: Implement**

`src/renderer/src/App.tsx:3305-3306`. Current:

```tsx
        newSessionKey={formatBinding(bindings.newSession)}
        newWorktreeKey={formatBinding(bindings.newWorktree)}
```

Replacement:

```tsx
        newSessionKey={formatBinding(bindings.newSession)}
        newWorktreeKey={formatBinding(bindings.newWorktree)}
        findSessionKey={formatBinding(bindings.findSession)}
        sidebarKey={formatBinding(bindings.toggleSidebar)}
```

`src/renderer/src/App.tsx:3687-3689`. Current:

```tsx
                    hidden={area === null}
                    searchKey={bindings.search}
                    dividerClass={paneDivider(area)}
```

Replacement:

```tsx
                    hidden={area === null}
                    searchKey={bindings.search}
                    closeKey={bindings.closeTab}
                    dividerClass={paneDivider(area)}
```

`src/renderer/src/components/Sidebar.tsx:3`: delete the line `import { MOD } from "../platformCopy";`
(its only uses are the three hints below).

`src/renderer/src/components/Sidebar.tsx:688-689`. Current:

```tsx
  newSessionKey,
  newWorktreeKey,
```

Replacement:

```tsx
  newSessionKey,
  newWorktreeKey,
  findSessionKey,
  sidebarKey,
```

`src/renderer/src/components/Sidebar.tsx:778-779`. Current:

```tsx
  newSessionKey?: string;
  newWorktreeKey?: string;
```

Replacement:

```tsx
  newSessionKey?: string;
  newWorktreeKey?: string;
  /** docs-round #28: the Find-a-session and sidebar-toggle hints, formatted in App like the two above. */
  findSessionKey: string;
  sidebarKey: string;
```

`src/renderer/src/components/Sidebar.tsx:995`. Current:

```tsx
            title={`Expand sidebar (${MOD}\\)`}
```

Replacement:

```tsx
            title={`Expand sidebar (${sidebarKey})`}
```

`src/renderer/src/components/Sidebar.tsx:1095`. Current:

```tsx
            title={`Find a session (${MOD}K)`}
```

Replacement:

```tsx
            title={`Find a session (${findSessionKey})`}
```

`src/renderer/src/components/Sidebar.tsx:1104`. Current:

```tsx
            title={`Collapse sidebar (${MOD}\\)`}
```

Replacement:

```tsx
            title={`Collapse sidebar (${sidebarKey})`}
```

`src/renderer/src/components/FileTab.tsx:2`. Current:

```tsx
import { MOD } from "../platformCopy";
```

Replacement:

```tsx
import { formatBinding } from "../shortcuts";
```

`src/renderer/src/components/FileTab.tsx:342-343`. Current:

```tsx
              title={dirty ? `Save (${MOD}S) — unsaved changes` : `Save (${MOD}S)`}
              aria-label={`Save (${MOD}S)`}
```

Replacement:

```tsx
              title={dirty ? `Save (${formatBinding(saveKey)}) — unsaved changes` : `Save (${formatBinding(saveKey)})`}
              aria-label={`Save (${formatBinding(saveKey)})`}
```

`src/renderer/src/components/ChatView.tsx:3`: delete `import { MOD } from "../platformCopy";` (line 1100 is its
only use).

`src/renderer/src/components/ChatView.tsx:9`. Current:

```tsx
import { matchesBinding } from "../shortcuts";
```

Replacement:

```tsx
import { formatBinding, matchesBinding } from "../shortcuts";
```

`src/renderer/src/components/ChatView.tsx:1100`. Current:

```tsx
          title={`Search this conversation (${MOD}F)`}
```

Replacement:

```tsx
          title={`Search this conversation (${formatBinding(searchKey)})`}
```

`src/renderer/src/components/TerminalTab.tsx:2`. Current:

```tsx
import { MOD } from "../platformCopy";
```

Replacement:

```tsx
import { formatBinding } from "../shortcuts";
```

`src/renderer/src/components/TerminalTab.tsx:33`. Current:

```tsx
  searchKey,
```

Replacement:

```tsx
  searchKey,
  closeKey,
```

`src/renderer/src/components/TerminalTab.tsx:45-46`. Current:

```tsx
  /** The one `search` action, focus-scoped — a third consumer beside chat and editor. */
  searchKey: string;
```

Replacement:

```tsx
  /** The one `search` action, focus-scoped — a third consumer beside chat and editor. */
  searchKey: string;
  /** docs-round #12: the resolved `closeTab` binding, printed in the exit bar. */
  closeKey: string;
```

`src/renderer/src/components/TerminalTab.tsx:294`. Current:

```tsx
          process exited (code {exited}) — {MOD}W closes this tab
```

Replacement:

```tsx
          process exited (code {exited}) — {formatBinding(closeKey)} closes this tab
```

`src/renderer/src/components/feedbackCopy.ts:1`. Current:

```ts
import { MOD } from "../platformCopy";
```

Replacement:

```ts
import { formatBinding } from "../shortcuts";
```

`src/renderer/src/components/feedbackCopy.ts:30`. Current:

```ts
  paste: `Paste an image (${MOD}V) or`,
```

Replacement (paste is the OS's key, never rebindable, so the default IS the key):

```ts
  paste: `Paste an image (${formatBinding("Mod-v")}) or`,
```

`src/renderer/src/shortcuts.ts:83`. Current:

```ts
  { keys: "⇧Enter", label: "New line in the composer" },
```

Replacement (`formatBinding` is a hoisted function declaration further down the same module):

```ts
  { keys: formatBinding("Shift-Enter"), label: "New line in the composer" },
```

`src/renderer/src/components/VoiceView.tsx:2`. Current:

```tsx
import { MIC_DENIED_HINT } from "../platformCopy";
```

Replacement:

```tsx
import { MIC_DENIED_HINT, MOD } from "../platformCopy";
```

`src/renderer/src/components/VoiceView.tsx:336`. Current:

```tsx
          subtitle="Hold right ⌘ (right Ctrl on Windows and Linux) to dictate while held; tap it to keep recording until you tap again. It is listed under Built-in on the Keyboard shortcuts page."
```

Replacement (MOD already names the right key per OS, so the parenthetical goes):

```tsx
          subtitle={`Hold right ${MOD} to dictate while held; tap it to keep recording until you tap again. It is listed under Built-in on the Keyboard shortcuts page.`}
```

- [ ] **Step 4: Run it, expect PASS**

`L=/tmp/vitest.log; npx vitest run tests/mod-key-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=0. The existing "allowlist is exactly the three places" test still passes, because no new
file spells ⌘.

- [ ] **Step 5: Guide**

`docs/guide/src/content/docs/keyboard-shortcuts.md:8`
- Old: `Shortcuts use ⌘ on macOS and Ctrl on Windows and Linux. The screen shows the keys for the computer you're on (except the **Built-in** list, which always shows ⇧ for Shift).`
- New: `Shortcuts use ⌘ on macOS and Ctrl on Windows and Linux. The screen shows the keys for the computer you're on.`

`docs/guide/src/content/docs/keyboard-shortcuts.md:47`
- Old: `| New line in the composer | ⇧Enter (Shift+Enter) |`
- New: `| New line in the composer | ⇧Enter on macOS, Shift+Enter on Windows and Linux |`

`docs/guide/src/content/docs/keyboard-shortcuts.md:75`
- Old: `The app shows the keys you've chosen, not the defaults. The tab strip's **+** menu, for example, lists your keys next to **New session**, **New terminal** and **New browser**.`
- New: `The app shows the keys you've chosen, not the defaults. The tab strip's **+** menu, for example, lists your keys next to **New session**, **New terminal** and **New browser**, and tooltips like "Find a session" and the editor's **Save** name them too.`

`docs/guide/src/content/docs/terminal.md:56`
- Old: `…A bar along the bottom says so, for example "process exited (code 0)", and names the default shortcut that closes the tab.`
- New: `…A bar along the bottom says so, for example "process exited (code 0)", and names the shortcut that closes the tab, including one you've changed on [Keyboard shortcuts](/docs/keyboard-shortcuts/).`

No change needed: `workspaces-and-sessions.md:24-25`, `:106`, `:149` and `session-view.md:55` already say
"Ctrl+K", "Ctrl+\" and "Ctrl+F", which is what the app now prints.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/FileTab.tsx src/renderer/src/components/ChatView.tsx src/renderer/src/components/TerminalTab.tsx src/renderer/src/components/feedbackCopy.ts src/renderer/src/shortcuts.ts src/renderer/src/components/VoiceView.tsx tests/mod-key-copy.test.ts docs/guide/src/content/docs/keyboard-shortcuts.md docs/guide/src/content/docs/terminal.md
git commit -s -F - <<'MSG'
fix(docs-round #28, #12, #22, #11): key hints show your keys, the right way for your computer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

**GUI assertions**
- **Sidebar**, on Windows or Linux: hovering the magnifying glass shows "Find a session (Ctrl+K)",
  **«** shows "Collapse sidebar (Ctrl+\)", and the collapsed rail's logo shows "Expand sidebar (Ctrl+\)".
  On macOS: "(⌘K)" and "(⌘\)".
- **Keyboard shortcuts page, then the Sidebar**: rebind "Find a session in the sidebar" to ⌘⇧K. The
  magnifier's tooltip now reads "Find a session (⌘⇧K)" without a restart. **Reset** returns it to "(⌘K)".
- **A file tab**: the Save button's tooltip reads "Save (⌘S)", or "Save (Ctrl+S)" off macOS, and follows
  a rebound Save.
- **Session view**: the ⌕ tooltip reads "Search this conversation (Ctrl+F)" on Windows and Linux.
- **Terminal tab**: type `exit`, and the bar reads "process exited (code 0) — Ctrl+W closes this tab",
  or ⌘W on macOS. It follows a rebound "Close the active tab".
- **Feedback dialog**: the image row reads "Paste an image (Ctrl+V) or" off macOS.
- **Keyboard shortcuts page, Built-in**: "Shift+Enter" on Windows and Linux, "⇧Enter" on macOS.
- **Voice page, Behaviour**: "Hold right ⌘ to dictate while held; …" on macOS, "Hold right Ctrl …"
  elsewhere.
- **Absence:** no hint anywhere reads "CtrlK", "CtrlS", "CtrlF", "CtrlW", "Ctrl\" or "CtrlV"; the Voice
  subtitle never shows the six characters `⌘`; and a rebound shortcut's tooltip never shows the
  default key.
- **Regression to try:** on Keyboard shortcuts, rebind Save to ⌘⇧S. Open a file, edit it, press ⌘⇧S:
  it saves, and the Save tooltip says ⌘⇧S. Press ⌘W on a terminal tab: it still closes (after its
  confirm). Both dispatch paths are unchanged; only the printed text moved.

---

### Task 9: A revised plan gets its buttons back (docs-round #6)

**Spec note:** "a live `plan_complete`" can't be read off the notify on its own. `/hv-plan off` (sent by Implement, Discard and the plan toggle) re-emits `hv.plan` with the SAME `planPath` and `restored:false` (`happyvibe-bridge.ts:2427-2435` via `emitPlan`, `:498`). So App.tsx:1137 today runs for those too. A fresh draft is `enabled:true && planPath && !restored`. Clearing on every emit would bring the buttons back after "Keep planning" → toggle plan mode off. The pill's own `PlanCard` (`ChatView.tsx:1123`) is mounted only while the pill is open, so it reads the cleared key the next time it opens. No change there.

**Files:**
- Modify: `src/renderer/src/components/PlanCard.tsx:8-9` (export the key)
- Modify: `src/renderer/src/App.tsx:18` (import), `:719-727` (`ensurePlanCard`), `:1137` (call site)
- Test: `tests/dismissals-persist.test.ts` (existing, append)
- Guide: `docs/guide/src/content/docs/built-in-tools.md:97`

**Interfaces:** Produces `export const PLAN_DISMISS_KEY = "hv:plan-dismissed:"` (PlanCard.tsx). `ensurePlanCard(sid: string, wsId: string, planPath: string, freshDraft: boolean): void` (App-internal). Consumes none.

- [ ] **Step 1: Write the failing test.** Append to `tests/dismissals-persist.test.ts`:

```ts
describe("a revised plan gets its buttons back (docs-round #6)", () => {
  // A revision rewrites the SAME file (tests/plans.test.ts:34-42), so the per-path
  // dismissal outlived the plan it dismissed and ensurePlanCard deduped the new one away.
  const app = fs
    .readFileSync(path.resolve(__dirname, "../src/renderer/src/App.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const fn = app.slice(app.indexOf("const ensurePlanCard"), app.indexOf("const loadEarlier"));

  it("the key is PlanCard's own, exported and imported — never re-typed", () => {
    expect(rendered("PlanCard.tsx")).toMatch(/export const PLAN_DISMISS_KEY = "hv:plan-dismissed:"/);
    expect(app).toMatch(/import \{ PLAN_DISMISS_KEY, type PlanCardData \} from "\.\/components\/PlanCard"/);
    expect(app).not.toContain('"hv:plan-dismissed:"');
  });

  it("a fresh draft clears that plan's dismissal", () => {
    expect(fn).toMatch(/if \(freshDraft\) localStorage\.removeItem\(`\$\{PLAN_DISMISS_KEY\}\$\{planPath\}`\)/);
  });

  it("and remounts the existing card under a new id instead of deduping it away", () => {
    expect(fn).toMatch(/next\[at\] = \{ \.\.\.items\[at\], id: idCounter\.current\+\+ \}/);
    expect(fn).toMatch(/if \(!freshDraft\) return p;/);
  });

  it("only a live plan_complete is a fresh draft — /hv-plan off re-sends the path with enabled:false", () => {
    expect(app).toMatch(/if \(pl\.planPath && wsId && !pl\.restored\) ensurePlanCard\(sid, wsId, pl\.planPath, pl\.enabled\);/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/dismissals-persist.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: the 4 new tests fail (no `export const PLAN_DISMISS_KEY`, no `removeItem`, no `next[at]`, call site has 3 args). The existing 6 pass.

- [ ] **Step 3: Implement.**

`src/renderer/src/components/PlanCard.tsx`, current:
```ts
/** §20 round 17 — plan-card dismissals persist per plan file. */
const PLAN_DISMISS_KEY = "hv:plan-dismissed:";
```
replacement:
```ts
/** §20 round 17 — plan-card dismissals persist per plan file. Exported for App,
 *  which clears one when that plan is revised (docs-round #6). */
export const PLAN_DISMISS_KEY = "hv:plan-dismissed:";
```

`src/renderer/src/App.tsx`, current (line 18):
```ts
import { type PlanCardData } from "./components/PlanCard";
```
replacement:
```ts
import { PLAN_DISMISS_KEY, type PlanCardData } from "./components/PlanCard";
```

`src/renderer/src/App.tsx`, current (lines 719-727):
```ts
  // §23: append a PlanCard for a plan path once (progress fills in via
  // onPlanChanged); no-op if a card for that path already exists in the session.
  const ensurePlanCard = (sid: string, wsId: string, planPath: string): void =>
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      if (items.some((i) => i.kind === "plan" && i.card.path === planPath)) return p;
      const withId = { kind: "plan" as const, card: { sessionId: sid, workspaceId: wsId, path: planPath, status: "draft", done: 0, total: 0 }, id: idCounter.current++ };
      return { ...p, [sid]: [...items, withId] };
    });
```
replacement:
```ts
  // §23: append a PlanCard for a plan path once (progress fills in via
  // onPlanChanged). docs-round #6: a revision rewrites the SAME file, so a
  // `freshDraft` (a live plan_complete) for a path that already has a card clears
  // that plan's "Keep planning" dismissal and gives the card a new id. The new id
  // remounts it, so the buttons come back and it re-reads the revised text.
  const ensurePlanCard = (sid: string, wsId: string, planPath: string, freshDraft: boolean): void => {
    if (freshDraft) localStorage.removeItem(`${PLAN_DISMISS_KEY}${planPath}`);
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      const at = items.findIndex((i) => i.kind === "plan" && i.card.path === planPath);
      if (at >= 0) {
        if (!freshDraft) return p;
        const next = [...items];
        next[at] = { ...items[at], id: idCounter.current++ };
        return { ...p, [sid]: next };
      }
      const withId = { kind: "plan" as const, card: { sessionId: sid, workspaceId: wsId, path: planPath, status: "draft", done: 0, total: 0 }, id: idCounter.current++ };
      return { ...p, [sid]: [...items, withId] };
    });
  };
```
(Replacing in place keeps every index, so `toolIndex` stays valid. The transcript keys each item by `it.id` (`Transcript.tsx:164-166`), which is what makes the new id a remount.)

`src/renderer/src/App.tsx`, current (line 1137):
```ts
        if (pl.planPath && wsId && !pl.restored) ensurePlanCard(sid, wsId, pl.planPath);
```
replacement:
```ts
        // `pl.enabled`: plan_complete emits enabled:true. /hv-plan off (Implement,
        // Discard, the toggle) re-sends the same path with enabled:false and must not
        // bring a dismissed card's buttons back.
        if (pl.planPath && wsId && !pl.restored) ensurePlanCard(sid, wsId, pl.planPath, pl.enabled);
```

- [ ] **Step 4: Run it, expect PASS** (same command). All 10 tests pass.

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/built-in-tools.md:97`
  - old: `   - **Keep planning**: hides these buttons so you can keep talking. A revised plan won't show them again, so to build it, leave plan mode and ask the agent to go ahead.`
  - new: `   - **Keep planning**: hides these buttons so you can keep talking. When the agent sends a revised plan, the card shows the new plan and its buttons again.`

- [ ] **Step 6: Commit.**
  ```bash
  git add src/renderer/src/components/PlanCard.tsx src/renderer/src/App.tsx tests/dismissals-persist.test.ts docs/guide/src/content/docs/built-in-tools.md
  git commit -s -F - <<'MSG'
  fix(docs-round #6): a revised plan shows its Implement buttons again after Keep planning

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (session view, a session with **🧭 Plan** on):
- Ask for a plan. The card shows **Implement this plan** · **Keep planning** · **Discard**. Click **Keep planning**: the row disappears. Reply "add a step for tests". When the agent sends the revised plan, the same card (still one card, same file name) shows the new text, including the tests step, and the three buttons again.
- Absence: after **Keep planning**, click **🧭 Plan** to leave plan mode. The buttons must NOT come back (the `/hv-plan off` emit carries the same path).
- Absence: after the revision there is still ONE plan card for that file in the transcript, not two.
- Persistence (same page, after ⌘R/Ctrl+R): a card you dismissed and that was never revised stays dismissed.
- Regression to try: click **Implement this plan**. The card goes to "implementing" with **Stop** and **Revert implementation**, not back to draft buttons, and it doesn't jump or re-animate.

---

---

### Task 10a: Audit log filters match what they say, and Schedules has rows (docs-round #7)

**Spec note:** a sub-agent row carries `bypass: true` only when the bypass DECIDED it (an allow under `HV_BYPASS`). A boundary refusal under bypass (`hv-child-guard.ts:150-159`, still enforced, pinned by `tests/child-guard-inproc.test.ts:26-27`) stays unmarked, or it would read "bypass" on a deny.

**Files:**
- Modify: `src/renderer/src/components/AuditView.tsx:314-319` (add `SOURCE_FILTERS` + `matchesFilters` after `DECISION_TONE`), `:356-380` (drop the inline `matches`), `:437-451` (options from data)
- Modify: `src/main/ipc.ts:476-483` (add `SCHEDULE_EVENT_TYPES`), `:4573-4574` (read them)
- Modify: `pi-runtime/extensions/hv-child-policy.ts:25-33`, `pi-runtime/extensions/hv-child-guard.ts:212`, `pi-runtime/extensions/happyvibe-bridge.ts:562-564`, `:672-673`
- Modify: `docs/validation/d1.md:109` (hv.audit wire shape gains `bypass?`)
- Test: `tests/audit-filters.test.ts` (new)
- Guide: `docs/guide/src/content/docs/audit-log.md:21`, `:50-51`, `:66`

**Interfaces:** Produces `export const SOURCE_FILTERS: ReadonlyArray<{ value: string; label: string }>` and `export function matchesFilters(r: Row, decision: string, source: string): boolean` (AuditView.tsx). `export const SCHEDULE_EVENT_TYPES` (ipc.ts). `PolicyAuditRow.bypass?: boolean` (hv-child-policy.ts). hv.audit payload gains `bypass?: true` on `source:"subagent"` rows. Task 10b consumes `SOURCE_FILTERS`, `matchesFilters` and this test file.

- [ ] **Step 1: Write the failing test.** Create `tests/audit-filters.test.ts`:

```ts
/**
 * docs-round #7 — the Audit log's source menu filters on the STORED value, every
 * choice matches something, a sub-agent's bypassed call shows under Bypass too, and
 * schedule.* rows are read at all. The guard half is driven through the real
 * in-process guard with a fake policy (tests/child-prompt.test.ts's harness).
 */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCHEDULE_EVENT_LABELS, SOURCE_FILTERS, matchesFilters, sourceText, toAuditRow } from "../src/renderer/src/components/AuditView";
import { SCHEDULE_EVENT_TYPES } from "../src/main/ipc";
import { setChildPolicy, type ChildPolicy, type PolicyAuditRow } from "../pi-runtime/extensions/hv-child-policy";
import hvChildGuard from "../pi-runtime/extensions/hv-child-guard";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const bridge = fs.readFileSync("pi-runtime/extensions/happyvibe-bridge.ts", "utf8");
const view = fs.readFileSync("src/renderer/src/components/AuditView.tsx", "utf8");
const readAudit = ipc.slice(ipc.indexOf('ipcMain.handle("hv:read-audit"'), ipc.indexOf("// ── B7: local analytics"));

const decision = (data: Record<string, unknown>) =>
  toAuditRow({
    ts: "2026-09-29T10:00:00.000Z", type: "permission.decision", sessionId: "s1", workspaceId: "/w",
    data: { kind: "hv.audit", tool: "bash", summary: "ls", decision: "allow", ...data },
  } as never);
const shows = (r: ReturnType<typeof toAuditRow>, source: string, dec = ""): boolean => matchesFilters(r, dec, source);

describe("the source menu filters on the stored value", () => {
  it("Web tools and Read-only run match their rows — the value, never the label", () => {
    expect(shows(decision({ source: "web", decision: "deny" }), "web")).toBe(true);
    expect(shows(decision({ source: "readonly", decision: "deny" }), "readonly")).toBe(true);
  });

  it("every choice in the menu matches at least one kind of row", () => {
    const rows = [
      ...["rule", "user", "safe-default", "bypass", "plan", "readonly", "subagent", "terminal", "web", "document"].map((source) => decision({ source })),
      toAuditRow({ ts: "t", type: "schedule.fire", data: { scheduleId: "x", title: "Nightly" } } as never),
      toAuditRow({ ts: "t", type: "assistant.oneshot", data: { kind: "title", model: "m", estTokens: 1, ok: true } } as never),
      toAuditRow({ ts: "t", type: "model.excluded", data: { notice: "n" } } as never),
      toAuditRow({ ts: "t", type: "memory.saved", data: { name: "n" } } as never),
      toAuditRow({ ts: "t", type: "feedback.sent", data: { database: "general", formVersion: 1, submissionId: "s", status: "accepted", attachments: 0, bytes: 0 } } as never),
      toAuditRow({ ts: "t", type: "crash.sent", data: { reportId: "r", groupId: "g", isNewGroup: true, kind: "exception", bytes: 1 } } as never),
    ];
    for (const f of SOURCE_FILTERS) expect(rows.some((r) => shows(r, f.value)), f.label).toBe(true);
  });

  it("every source the bridge can write has a choice", () => {
    const union = /type AuditSource = ([^;]+);/.exec(bridge)![1];
    const sources = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThanOrEqual(10);
    const values = SOURCE_FILTERS.map((f) => f.value);
    for (const s of sources) expect(values, s).toContain(s);
  });

  it("Sub-agents and Documents are choices", () => {
    expect(SOURCE_FILTERS).toContainEqual({ value: "subagent", label: "Sub-agents" });
    expect(SOURCE_FILTERS).toContainEqual({ value: "document", label: "Documents" });
  });

  it("Bypass selects the old 'dangerous' rows too", () => {
    expect(shows(decision({ source: "dangerous" }), "bypass")).toBe(true);
    expect(shows(decision({ source: "rule" }), "bypass")).toBe(false);
  });

  it("a sub-agent call the bypass let through shows under BOTH Sub-agents and Bypass", () => {
    const r = decision({ source: "subagent", agent: "worker", bypass: true, wouldHave: "ask" });
    expect(shows(r, "subagent")).toBe(true);
    expect(shows(r, "bypass")).toBe(true);
    expect(sourceText(r as never)).toBe("sub-agent worker · bypass · rules would have asked");
  });

  it("a sub-agent call its rules decided is NOT a bypass row", () => {
    const r = decision({ source: "subagent", agent: "worker", wouldHave: "allow" });
    expect(shows(r, "subagent")).toBe(true);
    expect(shows(r, "bypass")).toBe(false);
  });

  it("the menu is rendered from SOURCE_FILTERS, and nothing compares a label", () => {
    expect(view).toMatch(/SOURCE_FILTERS\.map\(\(f\) => \(/);
    expect(view).not.toMatch(/<option value="rule">/);
    expect(view).not.toMatch(/\(SOURCE_LABEL\[r\.source\] \?\? r\.source\) === source/);
  });
});

describe("schedule rows reach the Audit log", () => {
  it("SCHEDULE_EVENT_TYPES is exactly the labelled set", () => {
    expect([...SCHEDULE_EVENT_TYPES].sort()).toEqual(Object.keys(SCHEDULE_EVENT_LABELS).sort());
  });

  it("hv:read-audit reads every one of them", () => {
    expect(readAudit).toMatch(/SCHEDULE_EVENT_TYPES\.map\(\(t\) => log\.read\(\{ type: t, \.\.\.scoped \}\)\)/);
    expect(readAudit).toMatch(/\.\.\.schedules\.flat\(\)/);
  });

  it("a schedule row answers to Schedules and steps aside under a decision filter", () => {
    const r = toAuditRow({ ts: "t", type: "schedule.skip", data: { title: "Nightly", reason: "busy" } } as never);
    expect(r.row).toBe("schedule");
    expect(shows(r, "schedule")).toBe(true);
    expect(matchesFilters(r, "allow", "")).toBe(false);
  });
});

describe("a sub-agent row records that the bypass decided it", () => {
  const ws = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hv-audit-bypass-")));
  const rulesFile = path.join(ws, "rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({ global: [], workspaces: {} }));
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; setChildPolicy(undefined); });

  const lastRow = async (bypass: boolean, boundary: string[], tool: string, input: Record<string, unknown>) => {
    process.env.HV_RULES_FILE = rulesFile;
    if (bypass) process.env.HV_BYPASS = "1";
    else delete process.env.HV_BYPASS;
    delete process.env.HV_READONLY;
    const rows: PolicyAuditRow[] = [];
    const policy: ChildPolicy = {
      extensionPaths: () => [], skillPaths: () => [], refuseSpawn: () => undefined,
      boundaryFor: () => boundary,
      audit: (r) => rows.push(r),
      ask: async () => "deny",
    };
    setChildPolicy(policy);
    let handler: (e: { toolName?: string; input?: unknown }) => unknown = () => undefined;
    const cwd = process.cwd();
    process.chdir(ws);
    try {
      hvChildGuard({ on: (_ev, h) => { handler = h; } });
      await handler({ toolName: tool, input });
    } finally {
      process.chdir(cwd);
    }
    return rows.at(-1);
  };

  it("an allow under bypass carries bypass:true, with what the rules would have said", async () => {
    expect(await lastRow(true, ["bash"], "bash", { command: "npm test" })).toMatchObject({ decision: "allow", bypass: true, wouldHave: "ask" });
  });

  it("a boundary refusal under bypass is NOT marked — the bypass did not decide it", async () => {
    const row = await lastRow(true, ["read"], "bash", { command: "npm test" });
    expect(row).toMatchObject({ decision: "deny" });
    expect(row?.bypass).toBeUndefined();
  });

  it("without a bypass there is no flag", async () => {
    expect((await lastRow(false, ["read"], "read", { path: "rules.json" }))?.bypass).toBeUndefined();
  });

  it("the bridge forwards it onto the hv.audit row", () => {
    const at = bridge.indexOf('source: "subagent",');
    expect(bridge.slice(at, at + 300)).toMatch(/\.\.\.\(row\.bypass \? \{ bypass: true \} : \{\}\)/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/audit-filters.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `matchesFilters is not a function` / `SOURCE_FILTERS` undefined across the first two describes. `SCHEDULE_EVENT_TYPES` is undefined (TypeError on spread). The guard test fails on `bypass: true` missing from the row, and the bridge scan finds no forward.

- [ ] **Step 3: Implement.**

`src/renderer/src/components/AuditView.tsx`, current (lines 314-319):
```ts
const DECISION_TONE: Record<string, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
  "allow-session": "bg-leaf-soft text-leaf border-leaf/50",
};
```
replacement:
```ts
const DECISION_TONE: Record<string, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
  "allow-session": "bg-leaf-soft text-leaf border-leaf/50",
};

/**
 * docs-round #7: the source menu, as data (the renderer suite has no DOM). Each
 * value is the STORED source, or a non-decision row's own name, never a label.
 * Comparing against SOURCE_LABEL is what made Web tools and Read-only run match
 * nothing.
 */
export const SOURCE_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "rule", label: "Rule" },
  { value: "user", label: "You" },
  { value: "safe-default", label: "Safe default" },
  { value: "bypass", label: "Bypass" },
  { value: "plan", label: "Plan mode" },
  { value: "readonly", label: "Read-only run" },
  { value: "subagent", label: "Sub-agents" },
  { value: "schedule", label: "Schedules" },
  { value: "terminal", label: "Terminal" },
  { value: "web", label: "Web tools" },
  { value: "document", label: "Documents" },
  { value: "assistant", label: "The app itself" },
  { value: "model", label: "Model availability" },
  { value: "memory", label: "Memory" },
  { value: "feedback", label: "Feedback" },
  { value: "crash", label: "Crash reports" },
];

/**
 * One row against the two menus. Exported for tests.
 *
 * "bypass" also selects the old "dangerous" rows (one name, one filter, or the
 * log silently hides everything recorded before the rename) and a sub-agent's call
 * the bypass let through, which shows under BOTH Sub-agents and Bypass.
 */
export function matchesFilters(r: Row, decision: string, source: string): boolean {
  // A one-shot has no decision and no rule source; it answers to the source
  // filter under its own name so it can be isolated or excluded, and it is
  // hidden whenever a DECISION filter is on, because it is not one.
  if (r.row === "oneshot") return !decision && (!source || source === "assistant");
  // Not a decision either: it answers to the source filter under its own name.
  if (r.row === "excluded") return !decision && (!source || source === "model");
  // §33: a memory event is not a permission decision either — the DECISION that let it
  // happen is its own row, right beside this one. It answers to the source filter under its
  // own name so it can be isolated or excluded.
  if (r.row === "memory") return !decision && (!source || source === "memory");
  // §34: not a decision either. Its own source name, so it can be isolated or
  // excluded, and hidden whenever a DECISION filter is on.
  if (r.row === "feedback") return !decision && (!source || source === "feedback");
  // §37: not a decision either — nobody decided anything, which is the point.
  if (r.row === "crash") return !decision && (!source || source === "crash");
  // §35: a schedule event is not a permission decision — the run's own tool
  // calls are those, under this same log. Its own source name so it can be
  // isolated, which is how you answer "what has this thing been doing".
  if (r.row === "schedule") return !decision && (!source || source === "schedule");
  if (decision && r.decision !== decision) return false;
  if (!source) return true;
  if (source === "bypass") return r.source === "bypass" || r.source === "dangerous" || (r.source === "subagent" && r.bypass === true);
  return r.source === source;
}
```

`src/renderer/src/components/AuditView.tsx`, current (lines 356-380):
```ts
  // "bypass" selects the old "dangerous" rows too — one name, one filter, or
  // the log silently hides everything recorded before the rename.
  const matches = (r: Row): boolean => {
    // A one-shot has no decision and no rule source; it answers to the source
    // filter under its own name so it can be isolated or excluded, and it is
    // hidden whenever a DECISION filter is on, because it is not one.
    if (r.row === "oneshot") return !decision && (!source || source === "assistant");
    // Not a decision either: it answers to the source filter under its own name.
    if (r.row === "excluded") return !decision && (!source || source === "model");
    // §33: a memory event is not a permission decision either — the DECISION that let it
    // happen is its own row, right beside this one. It answers to the source filter under its
    // own name so it can be isolated or excluded.
    if (r.row === "memory") return !decision && (!source || source === "memory");
    // §34: not a decision either. Its own source name, so it can be isolated or
    // excluded, and hidden whenever a DECISION filter is on.
    if (r.row === "feedback") return !decision && (!source || source === "feedback");
    // §37: not a decision either — nobody decided anything, which is the point.
    if (r.row === "crash") return !decision && (!source || source === "crash");
    // §35: a schedule event is not a permission decision — the run's own tool
    // calls are those, under this same log. Its own source name so it can be
    // isolated, which is how you answer "what has this thing been doing".
    if (r.row === "schedule") return !decision && (!source || source === "schedule");
    return (!decision || r.decision === decision) && (!source || (SOURCE_LABEL[r.source] ?? r.source) === source);
  };
  const shown = rows?.filter(matches) ?? null;
```
replacement:
```ts
  const shown = rows?.filter((r) => matchesFilters(r, decision, source)) ?? null;
```

`src/renderer/src/components/AuditView.tsx`, current (lines 437-451):
```tsx
            <option value="">Any source</option>
            <option value="rule">Rule</option>
            <option value="user">You</option>
            <option value="safe-default">Safe default</option>
            <option value="bypass">Bypass</option>
            <option value="plan">Plan mode</option>
            <option value="readonly">Read-only run</option>
            <option value="schedule">Schedules</option>
            <option value="terminal">Terminal</option>
            <option value="web">Web tools</option>
            <option value="assistant">The app itself</option>
            <option value="model">Model availability</option>
            <option value="memory">Memory</option>
            <option value="feedback">Feedback</option>
            <option value="crash">Crash reports</option>
```
replacement:
```tsx
            <option value="">Any source</option>
            {SOURCE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
```

`src/main/ipc.ts`, current (lines 476-483):
```ts
export const MEMORY_EVENT_TYPES = [
  "memory.saved",
  "memory.refused",
  "memory.recalled",
  "memory.forgotten",
  "memory.edited",
  "memory.imported",
] as const;
```
replacement:
```ts
export const MEMORY_EVENT_TYPES = [
  "memory.saved",
  "memory.refused",
  "memory.recalled",
  "memory.forgotten",
  "memory.edited",
  "memory.imported",
] as const;

/** §35 (docs-round #7): every schedule audit type, named once. The Audit page reads these,
 *  `SCHEDULE_EVENT_LABELS` (AuditView.tsx) words them, and tests/audit-filters.test.ts keeps the
 *  two lists equal. */
export const SCHEDULE_EVENT_TYPES = [
  "schedule.create",
  "schedule.update",
  "schedule.delete",
  "schedule.fire",
  "schedule.skip",
  "schedule.done",
  "schedule.missed",
] as const;
```

`src/main/ipc.ts`, current (lines 4573-4574):
```ts
    const crashes = await log.read({ type: "crash.sent", ...scoped });
    return [...decisions, ...oneShots, ...excluded, ...memory.flat(), ...feedback, ...crashes]
```
replacement:
```ts
    const crashes = await log.read({ type: "crash.sent", ...scoped });
    // §35 (docs-round #7): what each schedule did. Written since §35 shipped and never read
    // until now, so the page's Schedules choice was always empty. Per type, like memory.
    const schedules = await Promise.all(SCHEDULE_EVENT_TYPES.map((t) => log.read({ type: t, ...scoped })));
    return [...decisions, ...oneShots, ...excluded, ...memory.flat(), ...feedback, ...crashes, ...schedules.flat()]
```

`pi-runtime/extensions/hv-child-policy.ts`, current (lines 24-33):
```ts
/** One child tool-call decision, reported to the parent for its audit log. */
export interface PolicyAuditRow {
  tool: string;
  decision: "allow" | "deny";
  wouldHave: "allow" | "ask" | "deny";
  summary: string;
  agentId?: string;
  type?: string;
  reason?: string;
}
```
replacement:
```ts
/** One child tool-call decision, reported to the parent for its audit log. */
export interface PolicyAuditRow {
  tool: string;
  decision: "allow" | "deny";
  wouldHave: "allow" | "ask" | "deny";
  summary: string;
  agentId?: string;
  type?: string;
  reason?: string;
  /** docs-round #7: the bypass decided this call (an allow under HV_BYPASS). */
  bypass?: boolean;
}
```

`pi-runtime/extensions/hv-child-guard.ts`, current (line 212):
```ts
      policy.audit({ tool, decision, wouldHave, summary: summarise(input), agentId: who?.agentId, type: who?.type, reason });
```
replacement:
```ts
      // docs-round #7: only an ALLOW under bypass is the bypass's decision. A boundary
      // refusal still holds under bypass, and marking it would read "bypass" on a deny.
      policy.audit({
        tool, decision, wouldHave, summary: summarise(input), agentId: who?.agentId, type: who?.type, reason,
        ...(bypass && decision === "allow" ? { bypass: true } : {}),
      });
```

`pi-runtime/extensions/happyvibe-bridge.ts`, current (lines 562-565):
```ts
    /** §12 (2026-09-26): a tintinweb child's call — which agent, which run (AuditView names both). */
    agent?: string;
    runId?: string;
  },
```
replacement:
```ts
    /** §12 (2026-09-26): a tintinweb child's call — which agent, which run (AuditView names both). */
    agent?: string;
    runId?: string;
    /** docs-round #7: on a child's row, the bypass let it through (AuditView lists it under Bypass too). */
    bypass?: boolean;
  },
```

`pi-runtime/extensions/happyvibe-bridge.ts`, current (lines 672-673):
```ts
          tool: row.tool, decision: row.decision, summary: row.summary, source: "subagent",
          wouldHave: row.wouldHave, ...(row.type ? { agent: row.type } : {}), ...(row.agentId ? { runId: row.agentId } : {}),
```
replacement:
```ts
          tool: row.tool, decision: row.decision, summary: row.summary, source: "subagent",
          wouldHave: row.wouldHave, ...(row.type ? { agent: row.type } : {}), ...(row.agentId ? { runId: row.agentId } : {}),
          ...(row.bypass ? { bypass: true } : {}),
```

`docs/validation/d1.md`, current (line 109):
```
| `wouldHave?` | `"allow"` \| `"ask"` \| `"deny"` — round 15, bypassed rows only |
```
replacement:
```
| `wouldHave?` | `"allow"` \| `"ask"` \| `"deny"` — round 15, bypassed rows only |
| `bypass?` | `true` — docs-round #7: a sub-agent row (`source:"subagent"`) the bypass let through. Absent on every other row. The Audit log lists it under both **Sub-agents** and **Bypass** |
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also rerun the neighbours that pin this code:
  `L=/tmp/vitest.log; npx vitest run tests/child-prompt.test.ts tests/child-guard-inproc.test.ts tests/schedules-source.test.ts tests/oneshot-audit.test.ts tests/memory-surfaces.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`. Expect EXIT=0.

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/audit-log.md`
  - `:21` old: `- **Any source**: show only the rows that came from one place, like **Rule**, **You**, **Bypass** or **Plan mode**. The last few choices pick out the other kinds of row: **The app itself**, **Model availability**, **Memory**, **Feedback** and **Crash reports**.`
    new: `- **Any source**: show only the rows that came from one place, like **Rule**, **You**, **Bypass**, **Plan mode** or **Sub-agents**. The last few choices pick out the other kinds of row: **The app itself**, **Model availability**, **Memory**, **Feedback** and **Crash reports**.`
  - `:51`, insert a new bullet BEFORE `- **feedback**: feedback you sent, such as "Sent feedback" or "Rated the session". Your answers stay out of the log.`:
    `- **schedule**: what one of your [schedules](/docs/schedules/) did, such as "created schedule", "schedule fired" or "schedule missed its time", with the schedule's name.`
  - `:66` old: `Calls made by subagents are listed under "sub-agent", not **Bypass**, so this filter hides them. To see them too, leave **Any source** on **Any source**.`
    new: `Calls your subagents made under a bypass are here too. They read "sub-agent" followed by the agent's name and "bypass". **Sub-agents** lists every subagent call, whoever decided it.`
  - `schedules.md:179` already describes the fixed behaviour ("**Any source** → **Schedules** shows what your schedules did, and **Read-only run** shows what read-only runs blocked."). No change.
  - Run the `docs-reviewer` agent on `audit-log.md`.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/renderer/src/components/AuditView.tsx src/main/ipc.ts pi-runtime/extensions/hv-child-policy.ts pi-runtime/extensions/hv-child-guard.ts pi-runtime/extensions/happyvibe-bridge.ts docs/validation/d1.md tests/audit-filters.test.ts docs/guide/src/content/docs/audit-log.md
  git commit -s -F - <<'MSG'
  fix(docs-round #7): Audit log filters match their rows, list sub-agent calls under Bypass, and show schedule events

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (Audit log page, **The record** → **Audit log**):
- **Any source** lists, in order: Rule, You, Safe default, Bypass, Plan mode, Read-only run, **Sub-agents**, Schedules, Terminal, Web tools, **Documents**, The app itself, Model availability, Memory, Feedback, Crash reports.
- After the agent's web tool is refused for a host (a `web` deny), **Web tools** shows that row. Before the fix it showed "No decisions match these filters."
- On the Schedules page, create a schedule and **Run now**, then come back here: **Schedules** shows "created schedule" and "schedule fired" with its name.
- With a bypass on (Permissions page), have a subagent run `ls`, then pick **Bypass**: the row reads "sub-agent <name> · bypass · rules would have …". **Sub-agents** shows it too.
- Absence: with a bypass OFF, a subagent call your rules allowed does NOT appear under **Bypass**.
- Absence: with **Any decision** = **Denied**, no schedule row shows.
- Regression to try: pick **Bypass** on a log that has pre-rename rows. They still show (`dangerous` folds into Bypass). Then pick a workspace and a session. The rows still narrow to it (the new read goes through the same `wsKeys` filter).
- Bridge coverage: the guard half is pinned key-free in `tests/audit-filters.test.ts` (the `child-prompt` harness). The forward onto `hv.audit` is a one-line source scan. The live pipe is `tests/tw-child-guard-bridge.test.ts`, which asserts `source:"subagent"` rows end to end and runs in the live batch because the bridge changed.

---

---

### Task 10b: Git actions appear in the Audit log (docs-round #31, second half)

**Files:**
- Modify: `src/renderer/src/components/AuditView.tsx` (as left by 10a): `:157-167` (add `GitEvent` + labels after `CrashEvent`), `:169-176` (`Row`), `:196` (`toAuditRow`), `SOURCE_FILTERS` and `matchesFilters` (from 10a), `:520` (the row render)
- Modify: `src/main/ipc.ts` `hv:read-audit` (as left by 10a)
- Test: `tests/audit-filters.test.ts` (from 10a, append + one edit)
- Guide: `docs/guide/src/content/docs/audit-log.md:21`, `:52`

**Interfaces:** Consumes `SOURCE_FILTERS`, `matchesFilters` (Task 10a). Produces `export const GIT_ACTION_LABEL: Record<string, string>`, `export function gitText(r: { action: string; ok?: boolean }): string`, and a `Row` member `{ row: "git" } & GitEvent`.

- [ ] **Step 1: Write the failing test.** In `tests/audit-filters.test.ts`:
  - Change the import line to:
    ```ts
    import { GIT_ACTION_LABEL, SCHEDULE_EVENT_LABELS, SOURCE_FILTERS, gitText, matchesFilters, sourceText, toAuditRow } from "../src/renderer/src/components/AuditView";
    ```
  - In `"every choice in the menu matches at least one kind of row"`, add to the `rows` array after the `crash.sent` entry:
    ```ts
      toAuditRow({ ts: "t", type: "git.action", data: { action: "sync", who: "human" } } as never),
    ```
  - Append:
```ts
describe("git actions are Audit log rows (docs-round #31)", () => {
  const git = (data: Record<string, unknown>) =>
    toAuditRow({ ts: "2026-09-29T10:00:00.000Z", type: "git.action", workspaceId: "/w", data: { who: "human", ...data } } as never);

  it("a git.action is a Git row, never misfiled as a permission decision", () => {
    expect(git({ action: "commit", sha: "abc1234", message: "feat: x" }).row).toBe("git");
  });

  it("answers to Git, and steps aside under a decision filter", () => {
    const r = git({ action: "switch", branch: "main" });
    expect(matchesFilters(r, "", "git")).toBe(true);
    expect(matchesFilters(r, "", "rule")).toBe(false);
    expect(matchesFilters(r, "allow", "")).toBe(false);
    expect(SOURCE_FILTERS).toContainEqual({ value: "git", label: "Git" });
  });

  it("says what happened in the app's words, and a merge that stopped says so", () => {
    expect(gitText({ action: "commit" })).toBe("committed");
    expect(gitText({ action: "merge", ok: true })).toBe("merged a worktree");
    expect(gitText({ action: "merge", ok: false })).toBe("merged a worktree · failed");
  });

  it("every action main audits has a label", () => {
    const calls = (ipc.match(/\bauditGit\(/g) ?? []).length;
    const literal = [...ipc.matchAll(/auditGit\([^,]+,\s*((?:"[a-z-]+"|[^",{]+\?\s*"[a-z-]+"\s*:\s*"[a-z-]+"))\s*,/g)];
    const stash = /auditGit\(workspaceId, `stash-\$\{action\}`/.test(ipc);
    expect(literal.length + (stash ? 1 : 0), "an auditGit call this scan cannot read").toBe(calls);
    const actions = literal.flatMap((m) => [...m[1].matchAll(/"([a-z-]+)"/g)].map((q) => q[1]));
    if (stash) actions.push("stash-save", "stash-pop", "stash-drop");
    expect(actions.length).toBeGreaterThanOrEqual(17);
    for (const a of actions) expect(Object.keys(GIT_ACTION_LABEL), a).toContain(a);
  });

  it("the row never shows the commit message", () => {
    const at = view.indexOf('r.row === "git" ? (');
    expect(at).toBeGreaterThan(-1);
    expect(view.slice(at, at + 1500)).not.toMatch(/\.message/);
  });

  it("hv:read-audit reads git.action", () => {
    expect(readAudit).toMatch(/log\.read\(\{ type: "git\.action", \.\.\.scoped \}\)/);
    expect(readAudit).toMatch(/\.\.\.schedules\.flat\(\), \.\.\.git\]/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/audit-filters.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `gitText is not a function`, `GIT_ACTION_LABEL` undefined, a `git.action` row arriving as `"decision"`, "Git" missing from the menu, and no `git.action` read. The 10a tests still pass, except "every choice…", which still passes because the git row is simply unmatched by any choice until Git exists.

- [ ] **Step 3: Implement.**

`src/renderer/src/components/AuditView.tsx`, current:
```ts
interface CrashEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  reportId: string;
  groupId: string;
  isNewGroup: boolean;
  kind: string;
  bytes: number;
  channel?: string;
}

export type Row =
  | ({ row: "decision" } & Decision)
```
replacement:
```ts
interface CrashEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  reportId: string;
  groupId: string;
  isNewGroup: boolean;
  kind: string;
  bytes: number;
  channel?: string;
}

/**
 * §29 (docs-round #31): a git action YOU took, written by `auditGit` (ipc.ts). Human-only by
 * construction (there is no git tool the model can call), so there is no decision to show.
 * The branch or the path only, never the commit message.
 */
interface GitEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  action: string;
  branch?: string;
  path?: string;
  ok?: boolean;
}

/** The app's own words for each `auditGit` action. A test asserts every action main writes has one. */
export const GIT_ACTION_LABEL: Record<string, string> = {
  commit: "committed",
  amend: "amended the last commit",
  switch: "switched branch",
  "delete-branch": "deleted a branch",
  "worktree-add": "made a worktree",
  merge: "merged a worktree",
  "worktree-remove": "removed a worktree",
  "worktree-prune": "cleaned up missing worktrees",
  sync: "synced with the remote",
  publish: "published the branch",
  "stash-save": "stashed changes",
  "stash-pop": "restored a stash",
  "stash-drop": "deleted a stash",
  "undo-hunk": "undid a change",
  "undo-file": "undid a file",
  "discard-untracked": "discarded a new file",
  init: "started tracking versions",
};

/** Exported for tests, like its neighbours: the renderer suite has no DOM. */
export function gitText(r: { action: string; ok?: boolean }): string {
  const label = GIT_ACTION_LABEL[r.action] ?? r.action;
  return r.ok === false ? `${label} · failed` : label;
}

export type Row =
  | ({ row: "git" } & GitEvent)
  | ({ row: "decision" } & Decision)
```

`src/renderer/src/components/AuditView.tsx`, current:
```ts
  if (e.type === "crash.sent") return { row: "crash", ...(e.data as unknown as CrashEvent), ...base };
```
replacement:
```ts
  if (e.type === "crash.sent") return { row: "crash", ...(e.data as unknown as CrashEvent), ...base };
  // §29 (docs-round #31): the TYPE again. Falling through would file a git action as a
  // permission decision with no tool and no decision.
  if (e.type === "git.action") return { row: "git", ...(e.data as unknown as GitEvent), ...base };
```

`src/renderer/src/components/AuditView.tsx` (`SOURCE_FILTERS`, from 10a), current:
```ts
  { value: "assistant", label: "The app itself" },
```
replacement:
```ts
  { value: "git", label: "Git" },
  { value: "assistant", label: "The app itself" },
```

`src/renderer/src/components/AuditView.tsx` (`matchesFilters`, from 10a), current:
```ts
  if (r.row === "schedule") return !decision && (!source || source === "schedule");
  if (decision && r.decision !== decision) return false;
```
replacement:
```ts
  if (r.row === "schedule") return !decision && (!source || source === "schedule");
  // §29: a git action is yours, not a decision — its own name, like a schedule's.
  if (r.row === "git") return !decision && (!source || source === "git");
  if (decision && r.decision !== decision) return false;
```

`src/renderer/src/components/AuditView.tsx`, current (lines 514-521):
```tsx
                    {(r.reason || r.outcome || r.recurrence) && (
                      <div className="text-xs text-ink-soft mt-0.5 truncate">
                        {[r.recurrence, r.outcome, r.reason, r.source === "agent" ? "asked for by the agent" : null].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </>
                ) : r.row === "crash" ? (
```
replacement:
```tsx
                    {(r.reason || r.outcome || r.recurrence) && (
                      <div className="text-xs text-ink-soft mt-0.5 truncate">
                        {[r.recurrence, r.outcome, r.reason, r.source === "agent" ? "asked for by the agent" : null].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </>
                ) : r.row === "git" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        git
                      </span>
                      <span className="font-bold shrink-0">{gitText(r)}</span>
                      <span className="text-xs text-ink-soft truncate min-w-0">{r.branch ?? (r.path ? basename(r.path) : "")}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                        {r.workspaceId ? basename(r.workspaceId) : ""}
                      </span>
                    </div>
                  </>
                ) : r.row === "crash" ? (
```

`src/main/ipc.ts` (`hv:read-audit`, as left by 10a), current:
```ts
    const schedules = await Promise.all(SCHEDULE_EVENT_TYPES.map((t) => log.read({ type: t, ...scoped })));
    return [...decisions, ...oneShots, ...excluded, ...memory.flat(), ...feedback, ...crashes, ...schedules.flat()]
```
replacement:
```ts
    const schedules = await Promise.all(SCHEDULE_EVENT_TYPES.map((t) => log.read({ type: t, ...scoped })));
    // §29 (docs-round #31): the git actions you took. `auditGit` writes them as human actions
    // for exactly this page, which never read them back.
    const git = await log.read({ type: "git.action", ...scoped });
    return [...decisions, ...oneShots, ...excluded, ...memory.flat(), ...feedback, ...crashes, ...schedules.flat(), ...git]
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `L=/tmp/vitest.log; npx vitest run tests/usage-from-log.test.ts tests/crash-audit.test.ts tests/feedback-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0.

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/audit-log.md`
  - `:21` (as left by 10a) old: `The last few choices pick out the other kinds of row: **The app itself**, **Model availability**, **Memory**, **Feedback** and **Crash reports**.`
    new: `The last few choices pick out the other kinds of row: **Git**, **The app itself**, **Model availability**, **Memory**, **Feedback** and **Crash reports**.`
  - `:52`, add after the `- **crash**: …` bullet:
    `- **git**: a git action you took in HappyVibe, such as "committed", "switched branch" or "merged a worktree", with the branch or file it touched. The commit message stays out of the log. Git commands the agent runs itself are ordinary decisions, under the tool that ran them.`
  - Run the `docs-reviewer` agent on `audit-log.md`.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/renderer/src/components/AuditView.tsx src/main/ipc.ts tests/audit-filters.test.ts docs/guide/src/content/docs/audit-log.md
  git commit -s -F - <<'MSG'
  fix(docs-round #31): git actions you take show in the Audit log, with their own Git filter

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions:**
- Changes panel: commit a change, switch branch, and stash then restore. On the Audit log page, rows tagged "git" read "committed", "switched branch <branch>", "stashed changes" and "restored a stash", each with the project name underneath.
- **Any source** → **Git** shows only those rows. **Any decision** → **Allowed** hides them.
- Absence: no git row shows the commit message (commit with a distinctive message such as "zebra-7" and check that it appears nowhere on the Audit log page).
- Absence: no row appears with an empty tool name and no decision tag (the misfiled shape `toAuditRow` would have produced).
- Regression to try: make a worktree with **New worktree…**, merge it from its Changes panel, then pick the parent project in **All workspaces**. The "made a worktree" and "merged a worktree" rows show under the parent. Then pick a single session. The git rows step aside (they carry no session), exactly as feedback and crash rows do.

---

---

### Task 11: Duplicate and Edit work for every agent the list shows (docs-round #8)

**Files:**
- Modify: `src/main/agents.ts:5-20` (allow `.agents/agents`, take the roots)
- Modify: `src/main/ipc.ts:4938` (`roots()`)
- Modify: `src/renderer/src/components/AgentsView.tsx:1-4` (import), `:55-80` (state + `duplicate`), `:112` (row click), `:150-164` (inspector props), `:187-199` (`AgentInspector` signature), `:224` (error line), `:313`, `:323`
- Test: `tests/agents-dirs.test.ts` (new)
- Guide: `docs/guide/src/content/docs/agents.md:50-52`, `:66`

**Interfaces:** Changes `allowedAgentDirs(builtinDir: string, roots: string[]): string[]`, which now returns `<builtin>`, then per root `<root>/.pi/agents` and `<root>/.agents/agents`. `AgentInspector` gains `error: string | null`. Consumes `ipcMessage` (`src/renderer/src/ipcError.ts:12`).

- [ ] **Step 1: Write the failing test.** Create `tests/agents-dirs.test.ts`:

```ts
/**
 * docs-round #8 — Duplicate and Edit work wherever tintinweb finds an agent: `<agentDir>/agents`,
 * `.pi/agents` and `.agents/agents`, in every root the app admits (a worktree too). Driven through
 * the real path confinement on temp dirs; the wiring halves are source scans.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedAgentDirs, confineAgentPath, duplicateAgent, readAgentBody } from "../src/main/agents";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agent-dirs-"));
const builtin = path.join(tmp, "agent", "agents");
const ws = path.join(tmp, "ws");
const wt = path.join(tmp, "wt");
const shared = path.join(ws, ".agents", "agents");
for (const d of [builtin, path.join(ws, ".pi", "agents"), shared, path.join(wt, ".pi", "agents")]) fs.mkdirSync(d, { recursive: true });
const AGENT = "---\nname: greeter\ndescription: Says hello.\n---\nSay hello, then stop.\n";
fs.writeFileSync(path.join(shared, "greeter.md"), AGENT);
fs.writeFileSync(path.join(wt, ".pi", "agents", "tester.md"), AGENT.replace("greeter", "tester"));
const dirs = allowedAgentDirs(builtin, [ws, wt]);

describe("agents in .agents/agents can be edited and duplicated", () => {
  it("the allowed folders are the three tintinweb discovers", () => {
    expect(dirs).toEqual(expect.arrayContaining([path.resolve(builtin), path.resolve(ws, ".pi", "agents"), path.resolve(shared)]));
  });

  it("Edit loads the agent's prompt", () => {
    expect(readAgentBody(dirs, path.join(shared, "greeter.md")).body).toContain("Say hello, then stop.");
  });

  it("Duplicate writes the copy beside the original", () => {
    const copy = duplicateAgent(dirs, path.join(shared, "greeter.md"));
    expect(copy).toBe(path.join(shared, "greeter-copy.md"));
    expect(fs.readFileSync(copy, "utf8")).toMatch(/name: greeter-copy/);
  });

  it("a worktree root counts, once roots() lists it", () => {
    expect(readAgentBody(dirs, path.join(wt, ".pi", "agents", "tester.md")).body).toContain("Say hello");
  });

  it("still refuses anything outside an agent folder", () => {
    fs.writeFileSync(path.join(ws, ".agents", "notes.md"), "x");
    expect(() => confineAgentPath(dirs, path.join(ws, ".agents", "notes.md"))).toThrow(/escapes/);
  });
});

describe("the page passes every root and says why a copy failed", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const view = fs.readFileSync("src/renderer/src/components/AgentsView.tsx", "utf8");

  it("main confines to roots(), so a worktree session's agents are in", () => {
    expect(ipc).toMatch(/allowedAgentDirs\(builtinAgentsDir\(\), roots\(\)\)/);
    expect(ipc).not.toMatch(/allowedAgentDirs\(builtinAgentsDir\(\), workspaces\.list\(\)\)/);
  });

  it("a refused Duplicate is shown in main's words, and the dialog stays open", () => {
    const at = view.indexOf("const duplicate = async");
    const dup = view.slice(at, view.indexOf("return (", at));
    expect(dup).toMatch(/catch \(e\) \{\s*setDupError\(ipcMessage\(e\)\);\s*return false;/);
    expect(view).toMatch(/if \(ok\) setInspecting\(null\)/);
    expect(view).toMatch(/\{error && <div className="mb-2 text-sm font-semibold text-berry">\{error\}<\/div>\}/);
  });

  it("the editor shows main's sentence, not the IPC preamble", () => {
    expect(view).not.toMatch(/setError\(String\(e\)\)/);
    expect((view.match(/setError\(ipcMessage\(e\)\)/g) ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/agents-dirs.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: "the allowed folders" fails (no `.agents/agents`), and Edit/Duplicate throw `Path escapes agent directories`. The worktree case and the refusal already pass. All three source scans fail.

- [ ] **Step 3: Implement.**

`src/main/agents.ts`, current (lines 5-20):
```ts
/**
 * Agent management (B6) — path-confined fs, mirroring agentsMd.ts.
 *
 * Edits/duplicates are confined to `*.md` files directly inside an ALLOWED
 * agent dir: the app-owned built-in dir, or a registered workspace's
 * `.pi/agents`. The renderer-supplied path is a trust boundary — we resolve it
 * and refuse anything that escapes an allowed dir.
 */

/** Allowed dirs: the app built-in dir + every registered workspace's .pi/agents. */
export function allowedAgentDirs(builtinDir: string, registeredWorkspaces: string[]): string[] {
  return [
    path.resolve(builtinDir),
    ...registeredWorkspaces.map((w) => path.resolve(w, ".pi", "agents")),
  ];
}
```
replacement:
```ts
/**
 * Agent management (B6) — path-confined fs, mirroring agentsMd.ts.
 *
 * Edits/duplicates are confined to `*.md` files directly inside an ALLOWED
 * agent dir: the app-owned built-in dir, or a root's `.pi/agents` or
 * `.agents/agents`, the three folders tintinweb discovers. The renderer-supplied
 * path is a trust boundary — we resolve it and refuse anything that escapes an
 * allowed dir.
 */

/**
 * Allowed dirs: the app built-in dir, plus every admitted root's `.pi/agents` and
 * `.agents/agents`. docs-round #8: the list showed `.agents/agents` agents as
 * "project", and Duplicate/Edit refused them. The app already writes `.agents/plans`.
 */
export function allowedAgentDirs(builtinDir: string, roots: string[]): string[] {
  return [
    path.resolve(builtinDir),
    ...roots.flatMap((w) => [path.resolve(w, ".pi", "agents"), path.resolve(w, ".agents", "agents")]),
  ];
}
```

`src/main/ipc.ts`, current (line 4938):
```ts
  const agentDirs = (): string[] => allowedAgentDirs(builtinAgentsDir(), workspaces.list());
```
replacement:
```ts
  // roots(), not workspaces.list(): a worktree session's Pi runs in the worktree, so
  // its agents live under a root the registry alone doesn't list (docs-round #8).
  const agentDirs = (): string[] => allowedAgentDirs(builtinAgentsDir(), roots());
```

`src/renderer/src/components/AgentsView.tsx`, current (line 4):
```ts
import { EmptyState } from "./EmptyState";
```
replacement:
```ts
import { EmptyState } from "./EmptyState";
import { ipcMessage } from "../ipcError";
```

`src/renderer/src/components/AgentsView.tsx`, current (lines 77-80):
```tsx
  const duplicate = async (a: AgentInfo): Promise<void> => {
    await window.hv.duplicateAgent(a.path);
    void window.hv.listAgents(sessionId ?? undefined); // refresh
  };
```
replacement:
```tsx
  // docs-round #8: a refused copy is SAID, in main's words. It used to reject into
  // nothing and leave the dialog open with no sign anything had been tried.
  const [dupError, setDupError] = useState<string | null>(null);
  const duplicate = async (a: AgentInfo): Promise<boolean> => {
    try {
      await window.hv.duplicateAgent(a.path);
    } catch (e) {
      setDupError(ipcMessage(e));
      return false;
    }
    void window.hv.listAgents(sessionId ?? undefined); // refresh
    return true;
  };
```

`src/renderer/src/components/AgentsView.tsx`, current (line 112):
```tsx
                  onClick={() => setInspecting(a)}
```
replacement:
```tsx
                  onClick={() => { setDupError(null); setInspecting(a); }}
```

`src/renderer/src/components/AgentsView.tsx`, current:
```tsx
        <AgentInspector
          agent={inspecting}
          onClose={() => setInspecting(null)}
          onToggle={() => {
            void toggle(inspecting).then(() => setInspecting(null));
          }}
          onDuplicate={() => {
            void duplicate(inspecting).then(() => setInspecting(null));
          }}
```
replacement:
```tsx
        <AgentInspector
          agent={inspecting}
          error={dupError}
          onClose={() => setInspecting(null)}
          onToggle={() => {
            void toggle(inspecting).then(() => setInspecting(null));
          }}
          onDuplicate={() => {
            void duplicate(inspecting).then((ok) => { if (ok) setInspecting(null); });
          }}
```

`src/renderer/src/components/AgentsView.tsx`, current:
```tsx
function AgentInspector({
  agent,
  onClose,
  onToggle,
  onDuplicate,
  onEdit,
}: {
  agent: AgentInfo;
  onClose: () => void;
```
replacement:
```tsx
function AgentInspector({
  agent,
  error,
  onClose,
  onToggle,
  onDuplicate,
  onEdit,
}: {
  agent: AgentInfo;
  /** Why the last Duplicate was refused, in main's words (docs-round #8). */
  error: string | null;
  onClose: () => void;
```

`src/renderer/src/components/AgentsView.tsx`, current (the one occurrence, in `AgentInspector`):
```tsx
        <div className="flex items-center gap-2 mb-3 flex-wrap">
```
replacement:
```tsx
        {error && <div className="mb-2 text-sm font-semibold text-berry">{error}</div>}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
```
(The same markup the editor already uses for its error, `AgentsView.tsx:349`.)

`src/renderer/src/components/AgentsView.tsx`, lines 313 and 323 (replace both occurrences), current:
```tsx
setError(String(e))
```
replacement:
```tsx
setError(ipcMessage(e))
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `L=/tmp/vitest.log; npx vitest run tests/agents-renderer.test.ts tests/hv-agents.test.ts tests/onboarding.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0 (`onboarding.test.ts:375-386` checks that `ipcMessage` is the one preamble stripper).

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/agents.md`
  - `:50-52`: delete the whole caution block (including the blank line after it):
    ```
    :::caution
    For a project agent kept in `.agents/agents`, **Edit** and **Duplicate** don't work yet: **Edit** opens with an error, and **Duplicate** does nothing. Edit that agent's file in your project instead. Agents in `.pi/agents` work as described here.
    :::
    ```
  - `:66` old: `A copy named *name*-copy appears on the list, next to the original. Edit the copy, and turn the original off if you only want the new one.`
    new: `A copy named *name*-copy appears on the list, next to the original, in the same folder. Edit the copy, and turn the original off if you only want the new one. If the copy can't be made, the window stays open and says why.`
  - Run the `docs-reviewer` agent on `agents.md`.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/main/agents.ts src/main/ipc.ts src/renderer/src/components/AgentsView.tsx tests/agents-dirs.test.ts docs/guide/src/content/docs/agents.md
  git commit -s -F - <<'MSG'
  fix(docs-round #8): Duplicate and Edit work for agents in .agents/agents and in worktrees, and say why when they can't

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (Agents page, with a session open in a workspace that has `.agents/agents/greeter.md`):
- The row shows "greeter" tagged **project**. Open it and click **Duplicate**: the window closes and "greeter-copy" appears on the list. On disk (Files panel, `.agents/agents/`), `greeter-copy.md` sits beside `greeter.md`.
- Open "greeter" → **Edit**: the editor shows its system prompt, with no red error. Change a word and click **Save**, and the change is in the file.
- In a worktree session (**New worktree…**) with `.pi/agents/x.md` in the worktree: **Duplicate** and **Edit** work the same.
- Absence: no "Error invoking remote method" text anywhere on the page, in either dialog.
- Absence: a failed Duplicate no longer closes the window silently. To force one, make the folder read-only (`chmod a-w .agents/agents`). The inspector stays open with main's refusal in red.
- Regression to try: **Duplicate** a **bundled** agent. The copy still lands in `<agentDir>/agents` and appears as bundled. Then close and reopen another agent. The earlier red error is gone.

---

---

### Task 12: A rejected API key is shown on first run, and doesn't count as set up (docs-round #9)

**Spec note:** "Forced setup sets `view` to models" as an effect on `keyState`/`onboarding` races the wizard. `onboarding` starts `false` (`App.tsx:197`) and is set asynchronously (`:950`), so the effect would fire for users about to see the wizard. The page behind the scrim would be Models, and a wizard closed after step 1 would land on Models instead of chat. Pinning it when the first-run page STARTS saving a key (a new `onSaving` prop) closes the same race (the push lands during `await setProviderKey`) with no side effects. The OAuth path is untouched: its success already hands over to chat.
Second note: once a refused key keeps step 1 open, the other doors must clear the refusal when they succeed. Otherwise signing in after a typo'd key would never tick the step. So a successful sign-in and a local runner both clear the note.

**Files:**
- Modify: `src/renderer/src/onboarding.ts:65-67` (add `keyRejectedNote`)
- Modify: `src/renderer/src/components/ModelsView.tsx:7` (import), `:85-91` (prop), `:224-237` (`saveKey`), `:245-247` (`keyProbeNote`)
- Modify: `src/renderer/src/App.tsx:3437-3443` (`onSaving`)
- Modify: `src/renderer/src/components/OnboardingDoors.tsx:5` (import), `:170-185` (props + `KeyNote`), `:240-243` (`closeLogin`), `:251-257` (`saveKey`), `:302` (local door)
- Modify: `src/renderer/src/components/OnboardingDialog.tsx:4`, `:106`, `:138`, `:266`, `:274`
- Test: `tests/onboarding.test.ts` (existing: edit the import and `:357`, then append)
- Guide: `docs/guide/src/content/docs/connect-a-model.md:75`, `docs/guide/src/content/docs/first-launch.md:26`

**Interfaces:** Produces `export function keyRejectedNote(provider: string, reason: string): string` (onboarding.ts) and `export interface KeyNote { text: string; rejected: boolean }` (OnboardingDoors.tsx). `ModelsView` gains a required prop `onSaving: () => void`. `ProviderDoors`' `onNote` becomes `(note: KeyNote | null) => void`.

- [ ] **Step 1: Write the failing test.** In `tests/onboarding.test.ts`:
  - line 4, current: `import { chipsFor, folderHasCode, ONBOARDING_COPY, rankProviders, shouldShowOnboarding } from "../src/renderer/src/onboarding";`
    replacement: `import { chipsFor, folderHasCode, keyRejectedNote, ONBOARDING_COPY, rankProviders, shouldShowOnboarding } from "../src/renderer/src/onboarding";`
  - line 357, current: `    expect(has(flat(DIALOG), "note={keyNote}"), "StepRow renders the note").toBe(true);`
    replacement: `    expect(has(flat(DIALOG), "note={keyNote?.text}"), "StepRow renders the note").toBe(true);`
  - Append:
```ts
describe("a rejected key on first run is seen, and doesn't count (docs-round #9)", () => {
  const MODELS = read("components/ModelsView.tsx");

  it("one sentence, used by both screens", () => {
    expect(keyRejectedNote("Anthropic", "HTTP 401")).toBe("Saved, but Anthropic rejected this key (HTTP 401).");
    expect(has(flat(MODELS), "keyRejectedNote("), "Models page").toBe(true);
    expect(has(flat(DOORS), "{ text: keyRejectedNote(label, probe.error), rejected: true }"), "setup window").toBe(true);
    expect(has(flat(MODELS), "rejected this key ("), "no second copy of the sentence").toBe(false);
  });

  it("the first-run Models page pins itself before the save, and hands over only for an accepted key", () => {
    const src = flat(MODELS);
    const pin = src.indexOf("if (firstRun) onSaving();");
    expect(pin, "pinned").toBeGreaterThan(-1);
    expect(pin, "before the push can land").toBeLessThan(src.indexOf("await window.hv.setProviderKey(id, key)"));
    expect(has(src, 'if (firstRun && probe.status !== "bad") onSaved();'), "accepted only").toBe(true);
    expect(has(src, "if (firstRun) onSaved();"), "the unconditional handover").toBe(false);
    expect(has(flat(APP), 'onSaving={() => setView("models")}'), "App pins the view").toBe(true);
  });

  it("step 1 ticks only for an accepted key, and the wizard can't hand over past a refusal", () => {
    const src = flat(DIALOG);
    expect(has(src, "const step1Done = modelReady && !keyNote?.rejected;")).toBe(true);
    expect(has(src, "done={step1Done} active={!step1Done}"), "step 1").toBe(true);
    expect(has(src, "active={step1Done && !workspaceReady}"), "step 2 waits").toBe(true);
    expect(has(src, "const complete = step1Done && workspaceReady;"), "no handover").toBe(true);
  });

  it("another door that works clears the refusal", () => {
    const src = flat(DOORS);
    expect(has(src, 'if (login?.event?.stage === "success") onNote(null);'), "sign-in").toBe(true);
    expect(has(src, "onClick={() => { onNote(null); onChanged(); }}"), "local runner").toBe(true);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/onboarding.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `keyRejectedNote is not a function`, the `note={keyNote?.text}` assertion fails, and every new scan fails.

- [ ] **Step 3: Implement.**

`src/renderer/src/onboarding.ts`, current:
```ts
export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;
```
replacement:
```ts
export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;

/**
 * docs-round #9: what the provider said about a key it refused, in ONE sentence for
 * both screens. The setup window showed only the raw reason ("HTTP 401"); the Models
 * page had this sentence inline.
 */
export function keyRejectedNote(provider: string, reason: string): string {
  return `Saved, but ${provider} rejected this key (${reason}).`;
}
```

`src/renderer/src/components/ModelsView.tsx`, current (line 7):
```ts
import { THINKING_LEVELS } from "../../../main/thinking";
```
replacement:
```ts
import { THINKING_LEVELS } from "../../../main/thinking";
import { keyRejectedNote } from "../onboarding";
```

`src/renderer/src/components/ModelsView.tsx`, current (lines 85-91):
```tsx
export function ModelsView({
  firstRun,
  onSaved,
}: {
  firstRun: boolean;
  onSaved: () => void;
}): React.JSX.Element {
```
replacement:
```tsx
export function ModelsView({
  firstRun,
  onSaved,
  onSaving,
}: {
  firstRun: boolean;
  onSaved: () => void;
  /** docs-round #9: a first-run key save is starting. App pins `view` to "models" so
   *  the provider push (which lands before the probe answers) can't close this page
   *  and take the verdict with it. */
  onSaving: () => void;
}): React.JSX.Element {
```

`src/renderer/src/components/ModelsView.tsx`, current (lines 224-229):
```ts
    // The key is saved regardless — this only reports what the provider said
    // when asked. "bad" means it answered 401/403; "unverified" means we could
    // not tell (no /models route, or the host was unreachable).
    const probe = await window.hv.setProviderKey(id, key);
```
replacement:
```ts
    // The key is saved regardless — this only reports what the provider said
    // when asked. "bad" means it answered 401/403; "unverified" means we could
    // not tell (no /models route, or the host was unreachable).
    if (firstRun) onSaving();
    const probe = await window.hv.setProviderKey(id, key);
```

`src/renderer/src/components/ModelsView.tsx`, current (line 237):
```ts
    if (firstRun) onSaved();
```
replacement:
```ts
    // docs-round #9: a refused key stays on this page with its verdict. Only an
    // accepted (or unverifiable) one hands over to the chat.
    if (firstRun && probe.status !== "bad") onSaved();
```

`src/renderer/src/components/ModelsView.tsx`, current (lines 245-247):
```tsx
      <p className="mt-1 text-xs font-bold text-berry">
        Saved, but {byok.find((b) => b.id === id)?.label ?? id} rejected this key ({probe.error}).
      </p>
```
replacement:
```tsx
      <p className="mt-1 text-xs font-bold text-berry">
        {keyRejectedNote(byok.find((b) => b.id === id)?.label ?? id, probe.error)}
      </p>
```

`src/renderer/src/App.tsx`, current (lines 3437-3443):
```tsx
            <ModelsView
              firstRun={needsSetup}
              onSaved={() => {
                setKeyState("present");
                setView("chat");
              }}
            />
```
replacement:
```tsx
            <ModelsView
              firstRun={needsSetup}
              onSaving={() => setView("models")}
              onSaved={() => {
                setKeyState("present");
                setView("chat");
              }}
            />
```

`src/renderer/src/components/OnboardingDoors.tsx`, current (line 5):
```ts
import { ONBOARDING_COPY as C, rankProviders } from "../onboarding";
```
replacement:
```ts
import { ONBOARDING_COPY as C, keyRejectedNote, rankProviders } from "../onboarding";
```

`src/renderer/src/components/OnboardingDoors.tsx`, current (lines 170-185):
```tsx
export function ProviderDoors({
  onChanged,
  onNote,
}: {
  onChanged: () => void;
  /**
   * What the provider said about the key, lifted OUT of this component.
   *
   * `setProviderKey` saves the key whatever the answer, so a typo'd key still
   * flips `hv:has-any-provider` — step 1 checks, this whole component unmounts,
   * and the refusal it just rendered disappears with it. Measured: a bogus
   * Anthropic key checked step 1 and showed nothing at all. The note has to
   * outlive the collapse, so the dialog owns it.
   */
  onNote: (note: string | null) => void;
}): React.JSX.Element {
```
replacement:
```tsx
/** What the key check said. `rejected` keeps step 1 open (docs-round #9). */
export interface KeyNote {
  text: string;
  rejected: boolean;
}

export function ProviderDoors({
  onChanged,
  onNote,
}: {
  onChanged: () => void;
  /**
   * What the provider said about the key, lifted OUT of this component.
   *
   * `setProviderKey` saves the key whatever the answer, so a typo'd key still
   * flips `hv:has-any-provider`. The dialog owns the note, because it must survive
   * this component unmounting, and since docs-round #9 a `rejected` note also keeps
   * step 1 from ticking.
   */
  onNote: (note: KeyNote | null) => void;
}): React.JSX.Element {
```

`src/renderer/src/components/OnboardingDoors.tsx`, current (lines 240-243):
```ts
  const closeLogin = (): void => {
    setLogin(null);
    onChanged();
  };
```
replacement:
```ts
  const closeLogin = (): void => {
    // A sign-in that worked replaces a refused key as the way in (docs-round #9).
    if (login?.event?.stage === "success") onNote(null);
    setLogin(null);
    onChanged();
  };
```

`src/renderer/src/components/OnboardingDoors.tsx`, current (lines 251-257):
```ts
    const probe = await window.hv.setProviderKey(keyId, key);
    setSaving(false);
    setKeyText("");
    const note =
      probe.status === "bad" ? probe.error : probe.status === "unverified" ? C.step1KeyUnverified : null;
    onNote(note);
    onChanged();
```
replacement:
```ts
    const probe = await window.hv.setProviderKey(keyId, key);
    setSaving(false);
    setKeyText("");
    const label = byok.find((b) => b.id === keyId)?.label ?? keyId;
    const note: KeyNote | null =
      probe.status === "bad" ? { text: keyRejectedNote(label, probe.error), rejected: true }
      : probe.status === "unverified" ? { text: C.step1KeyUnverified, rejected: false }
      : null;
    onNote(note);
    onChanged();
```

`src/renderer/src/components/OnboardingDoors.tsx`, current (line 302):
```tsx
              onClick={onChanged}
```
replacement:
```tsx
              onClick={() => { onNote(null); onChanged(); }}
```

`src/renderer/src/components/OnboardingDialog.tsx`, current (line 4):
```ts
import { ModelsEscape, ProviderDoors } from "./OnboardingDoors";
```
replacement:
```ts
import { ModelsEscape, ProviderDoors, type KeyNote } from "./OnboardingDoors";
```

`src/renderer/src/components/OnboardingDialog.tsx`, current (line 106):
```ts
  const [keyNote, setKeyNote] = useState<string | null>(null);
```
replacement:
```ts
  const [keyNote, setKeyNote] = useState<KeyNote | null>(null);
```

`src/renderer/src/components/OnboardingDialog.tsx`, current (line 138):
```ts
  const complete = modelReady && workspaceReady;
```
replacement:
```ts
  // docs-round #9: a refused key is SAVED (the probe informs, never blocks), so the
  // gate reads ready — but step 1 isn't done, and the wizard doesn't hand over, until
  // a key is accepted or another door works.
  const step1Done = modelReady && !keyNote?.rejected;
  const complete = step1Done && workspaceReady;
```

`src/renderer/src/components/OnboardingDialog.tsx`, current (line 266):
```tsx
                        <StepRow n="1" done={modelReady} active={!modelReady} title={C.step1Title} body={C.step1Body} note={keyNote}>
```
replacement:
```tsx
                        <StepRow n="1" done={step1Done} active={!step1Done} title={C.step1Title} body={C.step1Body} note={keyNote?.text}>
```

`src/renderer/src/components/OnboardingDialog.tsx`, current (line 274):
```tsx
                          active={modelReady && !workspaceReady}
```
replacement:
```tsx
                          active={step1Done && !workspaceReady}
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `L=/tmp/vitest.log; npx vitest run tests/has-any-provider.test.ts tests/providers.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0.

- [ ] **Step 5: Guide.**
  - `docs/guide/src/content/docs/connect-a-model.md:75` old: `- In the setup window, the provider's reason appears in red under **Connect a model**.`
    new: `- In the setup window, the same red line appears under **Connect a model**, and the step stays open until a key is accepted.`
  - `docs/guide/src/content/docs/first-launch.md:26` old: `3. When a model is ready, the step folds away to a ✓.`
    new: `3. When a model is ready, the step folds away to a ✓. If the provider refuses your key, the step stays open with a red line saying why, so you can paste another.`
  - Run the `docs-reviewer` agent on both pages.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/renderer/src/onboarding.ts src/renderer/src/components/ModelsView.tsx src/renderer/src/App.tsx src/renderer/src/components/OnboardingDoors.tsx src/renderer/src/components/OnboardingDialog.tsx tests/onboarding.test.ts docs/guide/src/content/docs/connect-a-model.md docs/guide/src/content/docs/first-launch.md
  git commit -s -F - <<'MSG'
  fix(docs-round #9): a key the provider rejects is shown on first run and doesn't complete setup

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (fresh profile, no provider configured):
- Setup window, **Paste an API key**, Anthropic, `sk-ant-bogus` → **Save key**: under **Connect a model** the red line reads "Saved, but Anthropic rejected this key (HTTP 401)." Step 1 has no ✓ and isn't struck through, and step 2 isn't active.
- Absence: the setup window does NOT say "You're in." or close on its own after the refused key, even when a workspace already exists.
- Same window: sign in with a plan (or use a local runner) → the red line goes and step 1 ticks.
- Models page first run (close the setup window with Esc): paste the bogus key → the page stays, now titled **Models**, with the red "Saved, but Anthropic rejected this key (HTTP 401)." under the Anthropic card.
- Absence: it does NOT jump to the chat with the verdict gone (the old behaviour).
- Regression to try: on the first-run Models page, paste a GOOD key. It lands in the chat as before. Then, on a fresh profile, sign in with a plan from the first-run Models page. After the sign-in it still ends up in the chat (OAuth path unchanged).

---

---

### Task 13: Privacy still shows the last crash report after a restart (docs-round #10)

**Spec note:** only `lastReport` falls back to the file. `lastSent` must stay in memory. App raises its crash notice at launch whenever `crashInfo().lastSent` is set (`App.tsx:3083`), so persisting it would show the notice on every launch. The file sits in the SDK's store directory (`<userData>/inlet-crash/`). The SDK only ever reads its own `queue`, `dedupe` and `running` files by key, with no directory scan (checked in `inlet-sdk/dist/crash/electron.js:1627`, `:1885`, `:1928`), so a sibling file can't be mistaken for a queued report.

**Files:**
- Modify: `src/main/crash/client.ts:17-18` (imports), after `:62` (`writeLastReport`/`readLastReport`)
- Modify: `src/main/crash/index.ts:18` (import), `:43` (`crashInfo`), `:130-131` (`onSent`)
- Test: `tests/crash-last-report.test.ts` (new)
- Guide: `docs/guide/src/content/docs/privacy.md:37`, `:50`

**Interfaces:** Produces `export const LAST_REPORT_FILE = "last-report.json"`, `export function writeLastReport(dir: string, envelope: CrashEnvelope): void` and `export function readLastReport(dir: string): CrashEnvelope | null` (crash/client.ts, electron-free). `hv:crash-info`'s `lastReport` now survives a restart. Its shape is unchanged.

- [ ] **Step 1: Write the failing test.** Create `tests/crash-last-report.test.ts`:

```ts
/**
 * docs-round #10 — the last crash report that LEFT the machine is kept beside the SDK's
 * store, so the Privacy page can still show it after a restart. The helpers live in the
 * electron-free seam (client.ts) so this runs under vitest; the wiring is a source scan.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LAST_REPORT_FILE, readLastReport, writeLastReport } from "../src/main/crash/client";

const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");

describe("the last crash report survives a restart", () => {
  it("round-trips the envelope exactly as it was sent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lastreport-"));
    const env = { kind: "exception", exception: { type: "Error", message: "<redacted>", handled: false, frames: [] }, tags: { channel: "dev" } };
    writeLastReport(dir, env as never);
    expect(readLastReport(dir)).toEqual(env);
  });

  it("a missing or unreadable file reads as nothing sent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-lastreport-none-"));
    expect(readLastReport(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, LAST_REPORT_FILE), "{not json");
    expect(readLastReport(dir)).toBeNull();
  });

  it("never collides with the SDK's own store files", () => {
    expect(["queue.json", "dedupe.json", "running.json"]).not.toContain(LAST_REPORT_FILE);
  });

  it("onSent writes it, and crashInfo falls back to it", () => {
    const sent = crash.slice(crash.indexOf("const onSent ="), crash.indexOf("const onDrop ="));
    expect(sent).toMatch(/writeLastReport\(queueDir, envelope\);/);
    expect(crash).toMatch(/lastReport: recent\.at\(-1\) \?\? \(queueDir \? readLastReport\(queueDir\) : null\),/);
  });

  it("lastSent stays in memory — App's launch notice keys on it", () => {
    expect(crash).toMatch(/^\s+lastSent,$/m);
    expect(crash).not.toMatch(/lastSent\s*[:=][^\n]*readLastReport/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/crash-last-report.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `writeLastReport is not a function` (and `LAST_REPORT_FILE` undefined). The wiring scan fails. The `lastSent` test already passes.

- [ ] **Step 3: Implement.**

`src/main/crash/client.ts`, current (lines 17-18):
```ts
import type { CrashReportInput } from "inlet-sdk/crash";
import type { EventLog } from "../log";
```
replacement:
```ts
import fs from "node:fs";
import path from "node:path";
import type { CrashEnvelope, CrashReportInput } from "inlet-sdk/crash";
import type { EventLog } from "../log";
```

`src/main/crash/client.ts`, current (end of file):
```ts
/** One payload, two moments — the live append and the buffered drain. */
export function recordCrashSent(row: CrashRow): void {
  if (auditLog) void auditLog.append({ type: "crash.sent", data: { ...row } });
  else pending.push(row);
}
```
replacement:
```ts
/** One payload, two moments — the live append and the buffered drain. */
export function recordCrashSent(row: CrashRow): void {
  if (auditLog) void auditLog.append({ type: "crash.sent", data: { ...row } });
  else pending.push(row);
}

/**
 * docs-round #10: the last report that LEFT, kept so the Privacy page can still show it
 * after a restart. Its own file, beside the SDK's store, because the EventLog takes ids,
 * never content. The envelope is already scrubbed (`beforeSendSync`), so this file holds
 * exactly what was sent.
 */
export const LAST_REPORT_FILE = "last-report.json";

export function writeLastReport(dir: string, envelope: CrashEnvelope): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LAST_REPORT_FILE), JSON.stringify(envelope));
  } catch {
    // A missing copy only means the page says nothing was sent. Never worth a crash.
  }
}

export function readLastReport(dir: string): CrashEnvelope | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, LAST_REPORT_FILE), "utf8")) as CrashEnvelope;
  } catch {
    return null;
  }
}
```

`src/main/crash/index.ts`, current (line 18):
```ts
import { captureCrash, recordCrashSent, setCrashCapture, type CrashRow } from "./client";
```
replacement:
```ts
import { captureCrash, readLastReport, recordCrashSent, setCrashCapture, writeLastReport, type CrashRow } from "./client";
```

`src/main/crash/index.ts`, current (line 43):
```ts
    lastReport: recent.at(-1) ?? null,
```
replacement:
```ts
    // docs-round #10: after a restart `recent` is empty, and the file is what left last.
    // `lastSent` above deliberately does NOT fall back: App's launch notice keys on it.
    lastReport: recent.at(-1) ?? (queueDir ? readLastReport(queueDir) : null),
```

`src/main/crash/index.ts`, current (lines 130-131):
```ts
    recent.push(envelope);
    if (recent.length > 5) recent.shift();
```
replacement:
```ts
    recent.push(envelope);
    if (recent.length > 5) recent.shift();
    writeLastReport(queueDir, envelope);
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `L=/tmp/vitest.log; npx vitest run tests/crash-wiring.test.ts tests/crash-audit.test.ts tests/crash-policy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0 (`crash-wiring` asserts `client.ts` still imports no electron).

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/privacy.md`
  - `:37` old: `- **Show the last report** displays the most recent report sent since HappyVibe started, in full. Click **Hide the last report** to fold it away. If none has been sent since the app started, the button is greyed out and the screen says "Nothing has been sent from this computer yet."`
    new: `- **Show the last report** displays the most recent report sent from this computer, in full. A copy stays on your computer, so it's still there after HappyVibe restarts. Click **Hide the last report** to fold it away. If none has been sent yet, the button is greyed out and the screen says "Nothing has been sent from this computer yet."`
  - `:50` old: `2. Click **Show the last report** to read the most recent one since the app started.`
    new: `2. Click **Show the last report** to read the most recent one.`
  - Run the `docs-reviewer` agent on `privacy.md`.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/main/crash/client.ts src/main/crash/index.ts tests/crash-last-report.test.ts docs/guide/src/content/docs/privacy.md
  git commit -s -F - <<'MSG'
  fix(docs-round #10): Privacy keeps showing the last crash report after HappyVibe restarts

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (dev build launched with `HV_CRASH_DEV=1`, reports **On**):
- Fire `hv:crash-test` `message` over electron-debug (the rule file's route), then open **Privacy**: **Show the last report** is enabled and shows the JSON. Quit and relaunch (a main-side change needs a restart anyway). **Privacy** → **Show the last report** is still enabled and shows the SAME JSON, and "Nothing has been sent from this computer yet." is absent.
- On disk: `<userData>/inlet-crash/last-report.json` equals the JSON on screen, byte for byte.
- Absence: after the relaunch, the app's crash notice does NOT appear (the launch check reads `lastSent`, which stays in memory).
- Absence: a dev launch WITHOUT `HV_CRASH_DEV=1` still says "Nothing has been sent from this computer yet." (`queueDir` stays empty, so no fallback read).
- Regression to try: send a second report with a different message. The page shows the new one, not the old one. Then check that the Audit log page still has one "crash" row per report.

---

---

### Task 14: On Linux the microphone row says no permission is needed (docs-round #11, Linux half)

**Spec note:** `docs-round.md:272` lists "11 (Linux half)" under "Closed without a change", while `:145-147` decides this row change. The closed part is the **Open System Settings** button, which can't appear on Linux. The badge text still changes. Also, main can't simply return a new status: `capture.ts:73` throws for anything but "granted" ("HappyVibe does not have microphone access…"). So dictation must accept `"not-needed"` in the same change, or Linux dictation breaks.

**Files:**
- Modify: `src/main/ipc.ts:4381-4388` (status via the platform seam), `:4396`, `:4399`, `:4403` (the block's other raw `process.platform` checks)
- Modify: `src/renderer/src/voice/capture.ts:73`
- Modify: `src/renderer/src/components/VoiceView.tsx:80`, `:391-395`, plus a new exported `micStatusLabel`
- Modify: `src/renderer/src/hv.d.ts:1231`
- Test: `tests/voice-mic-status.test.ts` (new)
- Guide: `docs/guide/src/content/docs/voice.md:53`, `:57`

**Interfaces:** `hv:voice-mic-status` may now return `"not-needed"` (Linux, and anywhere Electron has no microphone status). Produces `export function micStatusLabel(mic: string): string` (VoiceView.tsx). Consumes `platform.name` (`src/main/platform.ts:31`). Conflict note: Task #22 (others) edits `VoiceView.tsx:403` and #11's ⌘ half edits `:336`. Both are outside these hunks.

- [ ] **Step 1: Write the failing test.** Create `tests/voice-mic-status.test.ts`:

```ts
/**
 * docs-round #11 (Linux half) — Electron has no microphone status on Linux, and the row
 * read "Granted" for a check that never ran. Main now answers "not-needed", decided through
 * the platform seam, and dictation treats it exactly like "granted". No DOM in the suite, so
 * the badge is pinned as a pure function plus source scans.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { micStatusLabel } from "../src/renderer/src/components/VoiceView";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const capture = fs.readFileSync("src/renderer/src/voice/capture.ts", "utf8");
const view = fs.readFileSync("src/renderer/src/components/VoiceView.tsx", "utf8");
const block = ipc.slice(ipc.indexOf("const HAS_MIC_API"), ipc.indexOf('ipcMain.handle("hv:voice-transcribe"'));

describe("the Microphone access badge", () => {
  it("names each status main can return", () => {
    expect(micStatusLabel("granted")).toBe("Granted");
    expect(micStatusLabel("denied")).toBe("Denied");
    expect(micStatusLabel("not-needed")).toBe("No permission needed");
    expect(micStatusLabel("not-determined")).toBe("Not requested");
  });

  it("is rendered through micStatusLabel", () => {
    expect(view).toMatch(/\{micStatusLabel\(mic\)\}/);
    expect(view).not.toMatch(/mic === "granted" \? "Granted" : mic === "denied" \? "Denied" : "Not requested"/);
  });
});

describe("main answers not-needed where Electron has no status", () => {
  it("decided through the platform seam", () => {
    expect(block).toMatch(/const HAS_MIC_API = platform\.name === "darwin" \|\| platform\.name === "win32";/);
    expect(block).toMatch(/HAS_MIC_API \? systemPreferences\.getMediaAccessStatus\("microphone"\) : "not-needed",/);
  });

  it("the microphone block reads no raw process.platform", () => {
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/process\.platform/);
  });
});

describe("dictation treats not-needed exactly like granted", () => {
  it("capture does not refuse it", () => {
    expect(capture).toMatch(/\} else if \(status !== "granted" && status !== "not-needed"\) \{/);
  });

  it("the Voice page still lists input devices", () => {
    expect(view).toMatch(/if \(mic !== "granted" && mic !== "not-needed"\) return;/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**
  `L=/tmp/vitest.log; npx vitest run tests/voice-mic-status.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `micStatusLabel is not a function`, and every scan fails (`HAS_MIC_API` still reads `process.platform` and returns `"granted"`).

- [ ] **Step 3: Implement.**

`src/main/ipc.ts`, current (lines 4381-4388):
```ts
  // §27 + §4 Windows round: Electron answers getMediaAccessStatus on darwin AND
  // win32. The blanket "granted" now covers only linux, which has no such API — so a
  // Windows user whose privacy toggle is off gets the same guidance as a Mac user,
  // instead of a level meter that reads zero with nothing explaining why.
  const HAS_MIC_API = process.platform === "darwin" || process.platform === "win32";
  ipcMain.handle("hv:voice-mic-status", () =>
    HAS_MIC_API ? systemPreferences.getMediaAccessStatus("microphone") : "granted",
  );
```
replacement:
```ts
  // §27 + §4 Windows round: Electron answers getMediaAccessStatus on darwin AND
  // win32 — so a Windows user whose privacy toggle is off gets the same guidance as a
  // Mac user, instead of a level meter that reads zero with nothing explaining why.
  // docs-round #11: Linux has no such permission at all. "granted" there claimed a check
  // that never ran; "not-needed" is what is true, and capture treats it like "granted".
  const HAS_MIC_API = platform.name === "darwin" || platform.name === "win32";
  ipcMain.handle("hv:voice-mic-status", () =>
    HAS_MIC_API ? systemPreferences.getMediaAccessStatus("microphone") : "not-needed",
  );
```

`src/main/ipc.ts`, current (line 4396):
```ts
    return process.platform === "darwin" ? systemPreferences.askForMediaAccess("microphone") : false;
```
replacement:
```ts
    return platform.name === "darwin" ? systemPreferences.askForMediaAccess("microphone") : false;
```

`src/main/ipc.ts`, current (lines 4398-4403):
```ts
  ipcMain.handle("hv:voice-open-mic-settings", () => {
    if (process.platform === "win32") {
      void shell.openExternal("ms-settings:privacy-microphone");
      return;
    }
    if (process.platform !== "darwin") return;
```
replacement:
```ts
  ipcMain.handle("hv:voice-open-mic-settings", () => {
    if (platform.name === "win32") {
      void shell.openExternal("ms-settings:privacy-microphone");
      return;
    }
    if (platform.name !== "darwin") return;
```
(`platform` is already imported, `ipc.ts:91`.)

`src/renderer/src/voice/capture.ts`, current (line 73):
```ts
  } else if (status !== "granted") {
```
replacement:
```ts
  } else if (status !== "granted" && status !== "not-needed") {
    // "not-needed": Linux, where there is no OS permission to hold (docs-round #11).
```

`src/renderer/src/hv.d.ts`, current (line 1231):
```ts
  voiceMicStatus(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
```
replacement:
```ts
  voiceMicStatus(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown" | "not-needed">;
```

`src/renderer/src/components/VoiceView.tsx`, current (lines 49-54, the component's doc comment):
```ts
/**
 * Round 2: settings are OWNED BY APP and passed in, mirroring TerminalView's
 * `settings`/`onChange` pair. A page-local copy would leave already-mounted
 * composers on a stale value, which is exactly what the two new toggles must
 * not do — flipping "Show mic in the chat bar" has to change the chat tab now.
 */
```
replacement (the new function goes first, the comment stays attached to `VoiceView`):
```ts
/**
 * docs-round #11: the Microphone access badge, as data (the suite has no DOM).
 * "not-needed" is main's answer on Linux, which has no OS microphone permission.
 */
export function micStatusLabel(mic: string): string {
  if (mic === "granted") return "Granted";
  if (mic === "denied") return "Denied";
  if (mic === "not-needed") return "No permission needed";
  return "Not requested";
}

/**
 * Round 2: settings are OWNED BY APP and passed in, mirroring TerminalView's
 * `settings`/`onChange` pair. A page-local copy would leave already-mounted
 * composers on a stale value, which is exactly what the two new toggles must
 * not do — flipping "Show mic in the chat bar" has to change the chat tab now.
 */
```

`src/renderer/src/components/VoiceView.tsx`, current (line 80):
```ts
    if (mic !== "granted") return;
```
replacement:
```ts
    if (mic !== "granted" && mic !== "not-needed") return;
```

`src/renderer/src/components/VoiceView.tsx`, current (lines 390-396):
```tsx
              <span
                className={`text-[12px] font-bold rounded-full px-2.5 py-1 ${
                  mic === "granted" ? "bg-leaf-soft text-leaf" : "bg-honey-soft text-tangerine"
                }`}
              >
                {mic === "granted" ? "Granted" : mic === "denied" ? "Denied" : "Not requested"}
              </span>
```
replacement:
```tsx
              <span
                className={`text-[12px] font-bold rounded-full px-2.5 py-1 ${
                  mic === "granted" || mic === "not-needed" ? "bg-leaf-soft text-leaf" : "bg-honey-soft text-tangerine"
                }`}
              >
                {micStatusLabel(mic)}
              </span>
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `L=/tmp/vitest.log; npx vitest run tests/voice-worklet-csp.test.ts tests/mod-key-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0.

- [ ] **Step 5: Guide.** `docs/guide/src/content/docs/voice.md`
  - `:53` old: `**Microphone access** shows whether your operating system lets HappyVibe use the microphone: **Granted**, **Denied** or **Not requested**. How you change it depends on your system:`
    new: `**Microphone access** shows whether your operating system lets HappyVibe use the microphone: **Granted**, **Denied** or **Not requested**. On Linux it reads **No permission needed**. How you change it depends on your system:`
  - `:57` old: `- **Linux**: the app has no way to check, so the row always reads **Granted**. Use **Test** to be sure the microphone reaches the app.`
    new: `- **Linux**: there's no permission to give, so the row reads **No permission needed**. Use **Test** to be sure the microphone reaches the app.`
  - Run the `docs-reviewer` agent on `voice.md`.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/main/ipc.ts src/renderer/src/voice/capture.ts src/renderer/src/components/VoiceView.tsx src/renderer/src/hv.d.ts tests/voice-mic-status.test.ts docs/guide/src/content/docs/voice.md
  git commit -s -F - <<'MSG'
  fix(docs-round #11): on Linux the Voice page's microphone row says no permission is needed

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions:**
- Linux, Voice page → **Permissions**: **Microphone access** reads "No permission needed" in the green badge. **Input device** lists the real microphones (labels, not blank).
- Absence: on Linux the row never reads "Granted", and no **Open System Settings** button appears.
- Linux, in a session: hold right Ctrl and speak. Dictation records and transcribes (capture accepts "not-needed"). This is the regression the change risks. Before the capture fix it would fail with "HappyVibe does not have microphone access…".
- macOS (unchanged): with access granted the badge reads "Granted". With it denied in System Settings, the badge reads "Denied" and **Open System Settings** opens the Microphone pane. Windows: with the privacy toggle off, the badge reads "Denied".

---

### Task 15: Forget workspace stops its agents and restores its sessions exactly (docs-round #26, #27)

**Spec note:** the decision ("forget no longer archives") also makes the app's own copy false in two
places the spec doesn't list. `WorkspaceSettingsView.tsx:222-223` says forget "archives its N sessions",
and the confirm at `:266` says "Its N sessions will be archived." Both change here.
- `ipc.ts:5483`'s comment ("§5's Forget path, one level down") and `docs/prd.md:932` (working tree:
  worktree removal has "sessions archived via the Forget path") describe worktree removal through
  Forget. Worktree removal still archives, correctly, because its folder is gone, so only the wording
  changes. The ipc comment is fixed here; the PRD line is left to whoever owns the PRD fold.

**Files:**
- Modify: `src/main/ipc.ts:2860-2871` (doc comment), `:2879-2893` (loop), `:5483-5484` (comment)
- Modify: `src/renderer/src/components/Sidebar.tsx:908`
- Modify: `src/renderer/src/components/WorkspaceSettingsView.tsx:222-223`, `:266`
- Test: `tests/forget-workspace.test.ts` (new)
- Guide: `docs/guide/src/content/docs/workspaces-and-sessions.md:141`, `:145`

**Interfaces:** none produced. Consumes `endSession(sessionId, terminals_?)` (`ipc.ts:3072`), and in the
Sidebar the existing props `workspaces: string[]` and `worktrees?: Record<string, HvWorktreeInfo[]>`.
Shares `Sidebar.tsx` with Task 8 (other lines) and `ipc.ts` with Tasks 16 and 17 (other handlers).

- [ ] **Step 1: Write the failing test**

`tests/forget-workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * docs-round #26/#27 — Forget workspace. ipc.ts is not vitest-importable (it
 * reaches electron), so the handler is pinned as a source scan, the
 * worktrees-roots.test.ts pattern.
 */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const ipc = read("src/main/ipc.ts");
const handler = ipc.slice(
  ipc.indexOf('ipcMain.handle("hv:remove-workspace"'),
  ipc.indexOf('ipcMain.handle("hv:workspace-session-count"'),
);
const doc = ipc.slice(ipc.indexOf("Round 11: removal is a confirmed choice"), ipc.indexOf('ipcMain.handle("hv:remove-workspace"'));

describe("docs-round #26: forgetting a workspace stops its agents", () => {
  it("every affected session's agent is ended BEFORE either outcome runs", () => {
    const loop = handler.slice(handler.indexOf("for (const s of affected)"));
    const stop = loop.indexOf("if (manager.get(s.id)) await endSession(s.id);");
    const branch = loop.indexOf('if (mode === "delete") {');
    expect(stop).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(0);
    expect(stop).toBeLessThan(branch);
    // …and once: the delete branch no longer needs its own copy.
    expect(loop.split("await endSession(s.id)").length - 1).toBe(1);
  });
});

describe("docs-round #27: forgetting writes nothing to the sessions", () => {
  it("no archive flag is set, so re-adding the folder restores them as they were", () => {
    expect(handler).not.toMatch(/archived: true/);
    expect(handler).not.toMatch(/else if \(!s\.archived\)/);
  });

  it("the handler's doc comment no longer promises an archive", () => {
    expect(doc).not.toContain("forget — archive its sessions");
    expect(doc).toContain("re-adding");
  });

  it("the settings copy says what forget does now", () => {
    const ws = read("src/renderer/src/components/WorkspaceSettingsView.tsx");
    expect(ws).not.toMatch(/and archives its|will be archived/);
    expect(ws).toContain("adding the folder again brings its sessions back as they were.");
  });

  it("Show archived counts only sessions the sidebar can show", () => {
    const sb = read("src/renderer/src/components/Sidebar.tsx");
    expect(sb).not.toContain("const archivedCount = sessions.filter((s) => s.archived).length;");
    expect(sb).toContain(
      "const listed = new Set(workspaces.flatMap((ws) => [ws, ...(worktrees?.[ws] ?? []).map((w) => w.path)]));",
    );
    expect(sb).toContain("const archivedCount = sessions.filter((s) => s.archived && listed.has(s.workspaceId)).length;");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

`L=/tmp/vitest.log; npx vitest run tests/forget-workspace.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=1.
- The endSession test fails `expect(stop).toBeLessThan(branch)`: today the only `endSession` sits inside
  the delete branch.
- The archive test fails on `archived: true`.
- The doc-comment test fails on "forget — archive its sessions".
- The copy test fails on "and archives its".
- The count test fails on the old `archivedCount` line.

- [ ] **Step 3: Implement**

`src/main/ipc.ts:2860-2871`. Current:

```ts
  /**
   * Round 11: removal is a confirmed choice between two outcomes, and neither
   * leaves orphans behind (the old one-liner dropped the registry entry and left
   * every session pointing at a workspace that no longer existed).
   *
   *   forget — archive its sessions; re-adding the folder brings them back, and
   *            nothing on disk is touched.
   *   delete — permanently remove them, session files and snapshots included.
   *
   * Both reuse the paths the session UI already calls (`hv:archive-session` /
   * `hv:delete-session`) rather than adding a second delete implementation.
   */
```

Replacement:

```ts
  /**
   * Round 11: removal is a confirmed choice between two outcomes.
   *
   *   forget — stop its running agents and leave its sessions as they are.
   *            Only registered workspaces render, so they are hidden, and
   *            re-adding the folder brings them back unchanged — archived ones
   *            stay archived (docs-round #27). Nothing on disk is touched.
   *   delete — permanently remove them, session files and snapshots included.
   *
   * Both stop an agent through `endSession`, the path `hv:archive-session` and
   * `hv:delete-session` already take, rather than a second implementation.
   */
```

`src/main/ipc.ts:2879-2893`. Current:

```ts
    for (const s of affected) {
      if (mode === "delete") {
        if (manager.get(s.id)) await endSession(s.id);
        index.remove(s.id);
        // §5: before the session file, never after — the run ids its sub-agent
        // artifacts are filed under exist only inside it.
        deleteSessionChildren(sessionDir(), s.piSessionFile);
        deleteSessionFile(sessionDir(), s.piSessionFile);
        deleteSessionSnapshots(snapshotDir(), s.id);
        void log.append({ type: "session.delete", sessionId: s.id, workspaceId: s.workspaceId });
        forgetSessionFeatures(s.id);
      } else if (!s.archived) {
        index.update(s.id, { archived: true });
      }
    }
```

Replacement:

```ts
    for (const s of affected) {
      // docs-round #26: both outcomes stop a running agent first, as archiving
      // does (hv:archive-session). Nothing hibernates it otherwise, so a turn
      // nobody can see would keep running — and spending — until quit.
      if (manager.get(s.id)) await endSession(s.id);
      // docs-round #27: forget writes nothing else to the session.
      if (mode === "delete") {
        index.remove(s.id);
        // §5: before the session file, never after — the run ids its sub-agent
        // artifacts are filed under exist only inside it.
        deleteSessionChildren(sessionDir(), s.piSessionFile);
        deleteSessionFile(sessionDir(), s.piSessionFile);
        deleteSessionSnapshots(snapshotDir(), s.id);
        void log.append({ type: "session.delete", sessionId: s.id, workspaceId: s.workspaceId });
        forgetSessionFeatures(s.id);
      }
    }
```

`src/main/ipc.ts:5483-5484` (in `hv:worktree-remove`). Current:

```ts
    // §5's Forget path, one level down: the folder is gone, so reopening a
    // session here must fail honestly rather than resolve to nothing.
```

Replacement:

```ts
    // Archived, unlike a forgotten workspace's sessions: this folder is gone, so
    // reopening a session here must fail honestly rather than resolve to nothing.
```

`src/renderer/src/components/Sidebar.tsx:908`. Current:

```tsx
  const archivedCount = sessions.filter((s) => s.archived).length;
```

Replacement (raw `===` path identity, the same test the rows use at `:1188` and `:1344`):

```tsx
  // docs-round #27: only sessions this list can show. A forgotten workspace's
  // sessions stay in the index, archived or not, and never render here.
  const listed = new Set(workspaces.flatMap((ws) => [ws, ...(worktrees?.[ws] ?? []).map((w) => w.path)]));
  const archivedCount = sessions.filter((s) => s.archived && listed.has(s.workspaceId)).length;
```

`src/renderer/src/components/WorkspaceSettingsView.tsx:222-223`. Current:

```tsx
            Takes <strong>{name}</strong> out of the workspace list and archives its {sessions}. Nothing on disk is
            touched, and adding the folder again brings them back.
```

Replacement:

```tsx
            Takes <strong>{name}</strong> out of the workspace list and stops any agent still working there. Nothing on
            disk is touched, and adding the folder again brings its sessions back as they were.
```

`src/renderer/src/components/WorkspaceSettingsView.tsx:266`. Current:

```tsx
                ? `Its ${sessions} will be archived. Add the folder again and they come back.`
```

Replacement:

```tsx
                ? `Its ${sessions} leave the list, and any agent still working there stops. Add the folder again and they come back as they were.`
```

- [ ] **Step 4: Run it, expect PASS**

`L=/tmp/vitest.log; npx vitest run tests/forget-workspace.test.ts tests/usage-minor-fixes.test.ts tests/worktrees-roots.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=0. `usage-minor-fixes.test.ts:61` still finds `forgetSessionFeatures(ws)` at the head of
the handler, and `worktrees-roots.test.ts:100-112` still finds `index.update(s.id, { archived: true })`
after `removeWorktree` in `hv:worktree-remove`.

- [ ] **Step 5: Guide**

`docs/guide/src/content/docs/workspaces-and-sessions.md:141`
- Old: `   - **Forget workspace:** takes it out of the list and archives its sessions. "Nothing on disk is touched, and adding the folder again brings them back." Click **Forget**.`
- New: `   - **Forget workspace:** takes it out of the list and stops any agent still working there. "Nothing on disk is touched, and adding the folder again brings its sessions back as they were." Click **Forget**.`

`docs/guide/src/content/docs/workspaces-and-sessions.md:145`
- Old: `…Your project's files stay where they are either way. If you forget a workspace and add its folder again later, its sessions return archived, under **Show archived**.`
- New: `…Your project's files stay where they are either way. If you forget a workspace and add its folder again later, its sessions come back as they were: sessions you had archived stay under **Show archived**, and the rest are back in the list.`

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts src/renderer/src/components/Sidebar.tsx src/renderer/src/components/WorkspaceSettingsView.tsx tests/forget-workspace.test.ts docs/guide/src/content/docs/workspaces-and-sessions.md
git commit -s -F - <<'MSG'
fix(docs-round #26, #27): Forget workspace stops its agents, and re-adding brings its sessions back as they were

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

**GUI assertions**
- **Workspace settings → Remove workspace**: the Forget card reads "…and stops any agent still working
  there. Nothing on disk is touched, and adding the folder again brings its sessions back as they were."
  The confirm reads "Its N sessions leave the list, and any agent still working there stops. Add the
  folder again and they come back as they were."
- **Sidebar, with a turn running in workspace A**: forget A while the agent is mid-turn.
  `pgrep -fl "cli.js --mode rpc"` shows one Pi process fewer within ~3 s, and no notification or badge
  from that session arrives afterwards.
- **Sidebar, with a permission prompt open in workspace A** (Review Focus 4): ask A's agent for something
  that asks (e.g. "run `ls` in the terminal"), and while the dialog is up, forget A. The dialog closes
  with the session (`onPiExit` → `dropSession`, `App.tsx:1431`). No dialog for A appears afterwards, and
  the next prompt from another workspace still shows normally.
- **Sidebar, then Add workspace**: re-add A's folder. Its sessions appear directly in the list, not
  archived. A session archived before the forget is still only under **Show archived**. The session that
  was mid-turn shows its transcript up to where it stopped, and it answers a new message.
- **Absence:**
  - A's sessions do NOT come back under **Show archived** after re-adding.
  - While A is forgotten, **Show archived (N)** does not count A's archived sessions. Forget a workspace
    holding one archived session and the count drops by one; re-add it and the count returns.
- **Regression to try:** on another workspace with a running session, choose **Delete permanently**. The
  agent stops, the sessions are gone from the sidebar and from **Show archived**, and re-adding the
  folder brings nothing back.

---

### Task 16: Schedules tell the truth (docs-round #29, #33, #32 createdBy + audit row)

**Spec notes:**
- **Skip-reason test.** "every `reason:` in `scheduler.ts`" can't be read literally. `reason:` also
  appears in `runNow`'s return values (`"busy" | "disabled" | "gone"`, `scheduler.ts:137-142`) and in log
  payloads (`"asking"`, `"skipped"`, `:96`, `:102`, `:127`), none of which is a run's reason. The test
  keys on `outcome: "skipped", reason: "…"`.
- **needs_you in scheduleEnvelopes.** Deleting `needs_you` also has to delete its branch in
  `scheduleEnvelopes.ts:183`. Otherwise TypeScript flags the comparison against a type with no overlap,
  and the build fails. No stored run carries it: nothing ever wrote the value.
- **Double audit row.** It covers `schedule.update` too: an agent-proposed EDIT saved in the drawer also
  logs a second, user-sourced `schedule.update`. The guard covers both. These rows only reach the Audit
  log once #7's `SCHEDULE_EVENT_TYPES` read lands (another task), so check the single row after that.

**Files:**
- Modify: `src/renderer/src/App.tsx:3480`
- Modify: `src/renderer/src/components/SchedulesView.tsx:3`, `:9-12`, `:25`, `:36`, `:51`, `:81-83`, `:105`, `:290`, `:359`
- Modify: `src/renderer/src/schedulesCopy.ts:58-64`, `:150-156`
- Modify: `src/main/schedules.ts:36`, `:266`
- Modify: `src/main/scheduleEnvelopes.ts:183`
- Modify: `src/main/ipc.ts:2402` (agent path), `:3442-3450` (login item), `:3400-3405` (schedule-save)
- Test: `tests/schedules-docs-round.test.ts` (new); `tests/schedules-renderer.test.ts:92-93` (existing, updated)
- Guide: `docs/guide/src/content/docs/schedules.md:56`, `:68`, `:133`, `:162`, `:177`

**Interfaces:**
- Produces:
  - `export const SKIP_REASON: Record<string, string>` (`schedulesCopy.ts`).
  - `RunOutcome = "ok" | "failed" | "skipped"` (`schedules.ts`).
  - `SchedulesView` no longer takes a `bypassHere` prop. `ScheduleDrawer`'s `bypassHere: (ws: string) => boolean` is unchanged.
- Consumes:
  - `resolveBypass(global: boolean, workspace: boolean | null | undefined): boolean` (`src/main/bypass.ts:6`, import-free).
  - `window.hv.getGlobalBypass(): Promise<boolean>` and `window.hv.getWorkspaceBypass(ws): Promise<boolean | null>`.
  - `platform.name` (`src/main/platform.ts:31`, already imported in ipc.ts at `:91`).
  - `scheduleStore.update(id, patch, now)`.
- Interacts with #7 (Audit log reads `schedule.*`): after both land, an agent-created schedule shows ONE "created schedule" row.

- [ ] **Step 1: Write the failing test**

`tests/schedules-docs-round.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { lastRunLabel, OUTCOME_MARK, SKIP_REASON } from "../src/renderer/src/schedulesCopy";
import { type Schedule } from "../src/main/schedules";
import { resolveBypass } from "../src/main/bypass";

const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const S = (o: Partial<Schedule> = {}): Schedule => ({
  id: "s", title: "T", prompt: "p", workspaceId: "/w", repeat: { kind: "daily" }, at: "09:00",
  mode: "full", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true,
  createdAt: "c", nextRunAt: null, failStreak: 0, runs: [], ...o,
});
const sv = R("src/renderer/src/components/SchedulesView.tsx");
const ipc = R("src/main/ipc.ts");

describe("docs-round #29: the drawer's bypass warning", () => {
  it("App no longer stubs it off", () => {
    expect(R("src/renderer/src/App.tsx")).not.toContain("bypassHere");
  });

  it("SchedulesView resolves it the way a spawn does — workspace over global", () => {
    expect(sv).toContain('import { resolveBypass } from "../../../main/bypass";');
    expect(sv).toContain("window.hv.getGlobalBypass()");
    expect(sv).toContain("window.hv.getWorkspaceBypass(ws)");
    expect(sv).toContain("resolveBypass(globalOn, perWs[i])");
    expect(sv).toContain("bypassHere={(ws) => bypass[ws] ?? false}");
  });

  it("the resolver the renderer imports stays import-free, and means what spawn means", () => {
    expect(R("src/main/bypass.ts")).not.toMatch(/^import /m);
    expect(resolveBypass(true, null)).toBe(true);
    expect(resolveBypass(true, false)).toBe(false);
    expect(resolveBypass(false, true)).toBe(true);
    expect(resolveBypass(false, undefined)).toBe(false);
  });
});

describe("docs-round #29: Run now on a busy project", () => {
  it("does not promise a wait the scheduler never queues (scheduler.ts runNow returns busy)", () => {
    expect(sv).not.toContain("the run will wait");
    expect(sv).toContain("Another session in that project is working — try again when that session finishes.");
  });
});

describe("docs-round #29/#33: Open at login", () => {
  it("is unavailable on Linux, through the platform seam", () => {
    const h = ipc.slice(ipc.indexOf('ipcMain.handle("hv:login-item-get"'), ipc.indexOf('ipcMain.handle("hv:login-item-set"'));
    expect(h).toContain('const available = app.isPackaged && platform.name !== "linux";');
    expect(h).toContain("openAtLogin: available ? app.getLoginItemSettings().openAtLogin : false");
    expect(h).not.toContain("process.platform");
  });
});

describe("docs-round #29: skip reasons in words", () => {
  const written = [...new Set([...R("src/main/scheduler.ts").matchAll(/outcome: "skipped", reason: "([a-z-]+)"/g)].map((m) => m[1]!))];

  it("the scan still finds the reasons the scheduler writes", () => {
    expect(written).toEqual(expect.arrayContaining(["busy", "missed", "unanswered", "workspace-gone"]));
  });

  it("every reason the scheduler writes has words", () => {
    expect(written.filter((r) => !SKIP_REASON[r])).toEqual([]);
  });

  it("the row and the history both use them", () => {
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "skipped", reason: "workspace-gone" }] })))
      .toBe("– skipped: the project was removed from the sidebar");
    expect(sv).toContain('r.outcome === "skipped" ? SKIP_REASON[r.reason] ?? r.reason : r.reason');
  });
});

describe("docs-round #29: the dead 'needs you' outcome is gone", () => {
  it("has no mark, no label and no type member", () => {
    expect(Object.keys(OUTCOME_MARK).sort()).toEqual(["failed", "never", "ok", "skipped"]);
    expect(R("src/main/schedules.ts")).not.toContain('"needs_you"');
    expect(R("src/main/scheduleEnvelopes.ts")).not.toContain('"needs_you"');
    expect(R("src/renderer/src/schedulesCopy.ts")).not.toContain("needs_you");
  });

  it("the notification for a run that asks is untouched", () => {
    expect(R("src/main/scheduler.ts")).toContain('this.host.notify("needs_you", s, { sessionId })');
  });
});

describe("docs-round #32: an agent-created schedule", () => {
  it("is stamped createdBy in main once the agent's drawer saves a NEW schedule", () => {
    const i = ipc.indexOf('if ("cancelled" in res) return answer("declined");');
    expect(i).toBeGreaterThan(0);
    expect(ipc.slice(i, i + 600)).toMatch(
      /if \(!existing\) \{[\s\S]{0,300}scheduleStore\.update\(res\.saved\.id, \{ createdBy: \{ source: "agent", sessionId \} \}, new Date\(\)\);/,
    );
  });

  it("logs ONE audit row: the save path skips its user-sourced row while an agent drawer waits", () => {
    const h = ipc.slice(ipc.indexOf('ipcMain.handle("hv:schedule-save"'), ipc.indexOf('ipcMain.handle("hv:schedule-delete"'));
    expect(h).toMatch(/if \(scheduleDrawerWaits\.size === 0\) \{\s*void log\.append\(/);
  });

  it("the row line it feeds is still there", () => {
    expect(sv).toContain('s.createdBy?.source === "agent"');
  });
});
```

In `tests/schedules-renderer.test.ts`, delete line 92:

```ts
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "needs_you" }] }))).toBe("⚠ needs you");
```

and change line 93. Current:

```ts
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "skipped", reason: "busy" }] }))).toBe("– skipped: busy");
```

Replacement:

```ts
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "skipped", reason: "busy" }] }))).toBe("– skipped: another session in the project was working");
```

- [ ] **Step 2: Run it, expect FAIL**

`L=/tmp/vitest.log; npx vitest run tests/schedules-docs-round.test.ts tests/schedules-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=1.
- The new file fails at import: `SKIP_REASON` is undefined, so `SKIP_REASON[r]` throws a TypeError, and
  `lastRunLabel` returns "– skipped: workspace-gone".
- The App test finds `bypassHere`, and the SchedulesView scans fail.
- The login-item scan fails on `const available`.
- `OUTCOME_MARK` still has `needs_you`.
- The createdBy regex doesn't match.
- `schedules-renderer.test.ts` fails line 93 ("– skipped: busy").

- [ ] **Step 3: Implement**

`src/renderer/src/App.tsx:3480`: delete the line

```tsx
              bypassHere={() => false}
```

`src/renderer/src/components/SchedulesView.tsx:3`. Current:

```tsx
import type { Schedule } from "../../../main/schedules";
```

Replacement:

```tsx
import type { Schedule } from "../../../main/schedules";
import { resolveBypass } from "../../../main/bypass";
```

`src/renderer/src/components/SchedulesView.tsx:9-12`. Current:

```tsx
import {
  ENDED_COPY, hasEnded, humanRecurrence, lastRunLabel, LOGIN_ITEM_COPY, MISSED_ROW, nextRunLabel, OUTCOME_MARK, PAUSED_COPY,
  TEMPLATES,
} from "../schedulesCopy";
```

Replacement:

```tsx
import {
  ENDED_COPY, hasEnded, humanRecurrence, lastRunLabel, LOGIN_ITEM_COPY, MISSED_ROW, nextRunLabel, OUTCOME_MARK, PAUSED_COPY,
  SKIP_REASON, TEMPLATES,
} from "../schedulesCopy";
```

`src/renderer/src/components/SchedulesView.tsx:25`: delete the line `  bypassHere,`.

`src/renderer/src/components/SchedulesView.tsx:36`: delete the line `  bypassHere: (ws: string) => boolean;`.

`src/renderer/src/components/SchedulesView.tsx:51`. Current:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
```

Replacement:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
  // docs-round #29: the Full card's "runs will too" warning, resolved exactly as
  // every spawn resolves it (ipc.ts spawnOpts) — the workspace's own setting
  // over the global one. Here, not in the drawer: the drawer test bans setBypass.
  const [bypass, setBypass] = useState<Record<string, boolean>>({});
```

`src/renderer/src/components/SchedulesView.tsx:81-83`. Current:

```tsx
  useEffect(() => {
    void window.hv.loginItemGet().then(setLoginItem).catch(() => {});
  }, []);
```

Replacement:

```tsx
  useEffect(() => {
    void window.hv.loginItemGet().then(setLoginItem).catch(() => {});
  }, []);

  useEffect(() => {
    void Promise.all([window.hv.getGlobalBypass(), Promise.all(workspaces.map((ws) => window.hv.getWorkspaceBypass(ws)))])
      .then(([globalOn, perWs]) => setBypass(Object.fromEntries(workspaces.map((ws, i) => [ws, resolveBypass(globalOn, perWs[i])]))))
      .catch(() => {});
  }, [workspaces]);
```

`src/renderer/src/components/SchedulesView.tsx:105`. Current:

```tsx
          r.reason === "busy" ? "That project is busy right now — the run will wait for the session that's working."
```

Replacement (scheduler.ts:132 keeps the busy gate on purpose, and nothing is queued):

```tsx
          r.reason === "busy" ? "Another session in that project is working — try again when that session finishes."
```

`src/renderer/src/components/SchedulesView.tsx:290`. Current:

```tsx
                                {r.reason && <span className="text-ink-soft">{r.reason}</span>}
```

Replacement:

```tsx
                                {r.reason && <span className="text-ink-soft">{r.outcome === "skipped" ? SKIP_REASON[r.reason] ?? r.reason : r.reason}</span>}
```

`src/renderer/src/components/SchedulesView.tsx:359`. Current:

```tsx
          bypassHere={bypassHere}
```

Replacement:

```tsx
          bypassHere={(ws) => bypass[ws] ?? false}
```

`src/renderer/src/schedulesCopy.ts:58-64`. Current:

```ts
export const OUTCOME_MARK: Record<RunOutcome | "never", string> = {
  ok: "✓",
  needs_you: "⚠",
  failed: "✕",
  skipped: "–",
  never: "—",
};
```

Replacement:

```ts
export const OUTCOME_MARK: Record<RunOutcome | "never", string> = {
  ok: "✓",
  failed: "✕",
  skipped: "–",
  never: "—",
};

/**
 * docs-round #29: a skipped run's reason, in words. The keys are the `reason`
 * values scheduler.ts records with `outcome: "skipped"`; a test fails when it
 * writes one this record does not name. A failed run's reason is an error
 * message and is shown as it is.
 */
export const SKIP_REASON: Record<string, string> = {
  busy: "another session in the project was working",
  missed: "HappyVibe was closed or asleep at that time",
  unanswered: "nobody decided about the missed run",
  "workspace-gone": "the project was removed from the sidebar",
};
```

`src/renderer/src/schedulesCopy.ts:152-155`. Current:

```ts
  if (!r) return `${OUTCOME_MARK.never} never ran`;
  if (r.outcome === "needs_you") return `${OUTCOME_MARK.needs_you} needs you`;
  if (r.outcome === "failed") return `${OUTCOME_MARK.failed} failed${r.reason ? `: ${r.reason}` : ""}`;
  if (r.outcome === "skipped") return `${OUTCOME_MARK.skipped} skipped${r.reason ? `: ${r.reason}` : ""}`;
```

Replacement:

```ts
  if (!r) return `${OUTCOME_MARK.never} never ran`;
  if (r.outcome === "failed") return `${OUTCOME_MARK.failed} failed${r.reason ? `: ${r.reason}` : ""}`;
  if (r.outcome === "skipped") return `${OUTCOME_MARK.skipped} skipped${r.reason ? `: ${SKIP_REASON[r.reason] ?? r.reason}` : ""}`;
```

`src/main/schedules.ts:36`. Current:

```ts
export type RunOutcome = "ok" | "needs_you" | "failed" | "skipped";
```

Replacement:

```ts
// docs-round #29: no "needs you" outcome — nothing ever recorded one. A run that
// asks raises the OS notification (scheduler.ts onNeedsYou), all §35 promises.
export type RunOutcome = "ok" | "failed" | "skipped";
```

`src/main/schedules.ts:266`. Current:

```ts
  if (run.outcome === "ok" || run.outcome === "needs_you") failStreak = 0;
```

Replacement:

```ts
  if (run.outcome === "ok") failStreak = 0;
```

`src/main/scheduleEnvelopes.ts:182-184`. Current:

```ts
        : last.outcome === "failed" ? `last run failed${last.reason ? `: ${last.reason}` : ""}`
        : last.outcome === "needs_you" ? "last run needs permission"
        : `last run skipped${last.reason ? ` (${last.reason})` : ""}`;
```

Replacement:

```ts
        : last.outcome === "failed" ? `last run failed${last.reason ? `: ${last.reason}` : ""}`
        : `last run skipped${last.reason ? ` (${last.reason})` : ""}`;
```

`src/main/ipc.ts:2402` (inside the `hv.schedule-*` envelope branch of `attach`). Current:

```ts
            if (!existing) track("schedule_created", scheduleParams(res.saved, "agent"));
```

Replacement:

```ts
            if (!existing) {
              // docs-round #32: provenance the drawer never sends. editPatch
              // (scheduleStore.ts) keeps it out of every later edit.
              scheduleStore.update(res.saved.id, { createdBy: { source: "agent", sessionId } }, new Date());
              schedulesChanged();
              track("schedule_created", scheduleParams(res.saved, "agent"));
            }
```

`src/main/ipc.ts:3442-3450`. Current:

```ts
  /**
   * "Open HappyVibe at login". Hidden in development rather than disabled: in
   * dev this would register the Electron binary itself, which is not the app
   * the user thinks they are launching at login.
   */
  ipcMain.handle("hv:login-item-get", () => ({
    available: app.isPackaged,
    openAtLogin: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
  }));
```

Replacement (the `hv:login-item-set` handler and its `throw` stay byte-identical, so the crash-message
catalog needs no re-run):

```ts
  /**
   * "Open HappyVibe at login". Hidden in development rather than disabled: in
   * dev this would register the Electron binary itself, which is not the app
   * the user thinks they are launching at login. Hidden on Linux too
   * (docs-round #29): Electron's login items are macOS and Windows only, so the
   * switch would flip and do nothing.
   */
  ipcMain.handle("hv:login-item-get", () => {
    const available = app.isPackaged && platform.name !== "linux";
    return {
      available,
      openAtLogin: available ? app.getLoginItemSettings().openAtLogin : false,
    };
  });
```

`src/main/ipc.ts:3400-3405` (in `hv:schedule-save`). Current:

```ts
    if (!input.id && scheduleDrawerWaits.size === 0) track("schedule_created", scheduleParams(s, "page"));
    void log.append({
      type: input.id ? "schedule.update" : "schedule.create",
      workspaceId: s.workspaceId,
      data: { scheduleId: s.id, title: s.title, mode: s.mode, recurrence: humanRecurrence(s.repeat, s.at), source: "user" },
    });
```

Replacement:

```ts
    if (!input.id && scheduleDrawerWaits.size === 0) track("schedule_created", scheduleParams(s, "page"));
    // docs-round #32: an agent-opened drawer saves through here too, and the
    // agent path logs that create or update itself as `source: "agent"`.
    // ponytail: same ceiling as the track above — a page save made while an agent drawer is open goes unlogged.
    if (scheduleDrawerWaits.size === 0) {
      void log.append({
        type: input.id ? "schedule.update" : "schedule.create",
        workspaceId: s.workspaceId,
        data: { scheduleId: s.id, title: s.title, mode: s.mode, recurrence: humanRecurrence(s.repeat, s.at), source: "user" },
      });
    }
```

- [ ] **Step 4: Run it, expect PASS**

`L=/tmp/vitest.log; npx vitest run tests/schedules-docs-round.test.ts tests/schedules-renderer.test.ts tests/scheduler.test.ts tests/schedules-tools.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=0.
- The "no dead copy" test (`schedules-renderer.test.ts:376`) passes, because `SKIP_REASON` is named in
  `SchedulesView.tsx`.
- `scheduler.test.ts:173-193` still sees `notify:needs_you`.

- [ ] **Step 5: Guide**

`docs/guide/src/content/docs/schedules.md:56`
- Old: `- "– skipped:" and the reason: "busy" (another session in that workspace was working the whole time), "missed" (you skipped a missed run, or chose **Skip it**), "unanswered" (a missed run you never decided on) or "workspace-gone" (the project isn't in the sidebar any more, so the schedule switches itself off).`
- New: `- "– skipped:" and why: "another session in the project was working" (the whole time, so the run never started), "HappyVibe was closed or asleep at that time" (you skipped the missed run, or chose **Skip it**), "nobody decided about the missed run", or "the project was removed from the sidebar" (the schedule then switches itself off).`

`docs/guide/src/content/docs/schedules.md:68`
- Old: `…Below them, "Last 30 days:" adds up what the schedule has cost lately. Before its first run, the panel says "No runs yet."`
- New: `…Below them, "Last 30 days:" adds up what the schedule has cost lately. Before its first run, the panel says "No runs yet." A schedule the agent proposed and you created also says "Created by the agent."`

`docs/guide/src/content/docs/schedules.md:133`
- Old: `…a Full run bypasses too: nothing waits for you, and the drawer doesn't warn you. Choose **Read-only** when that's not what you want.`
- New: `…a Full run bypasses too: nothing waits for you. The **Full session** card says so: "This workspace bypasses permissions — runs will too." Choose **Read-only** when that's not what you want.`

`docs/guide/src/content/docs/schedules.md:162`
- Old: `- On macOS and Windows, **Open at login** keeps HappyVibe open without you thinking about it. On Linux the switch is there but doesn't work yet, so open HappyVibe yourself.`
- New: `- On macOS and Windows, **Open at login** keeps HappyVibe open without you thinking about it. Linux has no such switch, so open HappyVibe yourself.`

`docs/guide/src/content/docs/schedules.md:177`
- Old: `…It waits up to two hours, then skips. If another session in that workspace is working, **Run now** doesn't start the run, even though the message says it will wait. Click it again once that session has finished.`
- New: `…It waits up to two hours, then skips. **Run now** doesn't wait: while another session in that workspace is working, it says "Another session in that project is working — try again when that session finishes." Click it again once that session has finished.`

`schedules.md:22` ("on macOS and Windows, the **Open at login** switch") is already right.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/SchedulesView.tsx src/renderer/src/schedulesCopy.ts src/main/schedules.ts src/main/scheduleEnvelopes.ts src/main/ipc.ts tests/schedules-docs-round.test.ts tests/schedules-renderer.test.ts docs/guide/src/content/docs/schedules.md
git commit -s -F - <<'MSG'
fix(docs-round #29, #32, #33): schedules warn about bypass, say why a run was skipped, and credit the agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

**GUI assertions**
- **Permissions page, then Schedules**: turn on **Bypass ALL permissions**, open Schedules, click
  **New schedule**. The **Full session** card shows, in red, "This workspace bypasses permissions — runs
  will too."
- **Workspace settings, then Schedules**: with the global bypass on, set this workspace's bypass to Off.
  A drawer for this workspace shows no warning, and switching the drawer's workspace to another one that
  inherits the global setting shows it again.
- **Session view, then Schedules**: start a long turn in workspace A. On Schedules, **Run now** on A's
  schedule shows "Another session in that project is working — try again when that session finishes."
  Once the turn ends, nothing fires by itself; the expanded row has no new run.
- **Schedules, packaged build on Linux**: "HappyVibe has to be open for schedules to run." shows with no
  **Open at login** switch beside it. On a packaged macOS or Windows build the switch is still there and
  still works. In dev it is hidden everywhere, as before.
- **Workspace settings, then Schedules**: make a schedule for workspace B due in two minutes, then Forget
  B. After the slot, B's row reads "– skipped: the project was removed from the sidebar", and so does its
  expanded history line.
- **Session view, then Schedules**: ask the agent "schedule a daily dependency check here" and click
  **Create** in the drawer. The expanded row shows "Created by the agent." A schedule made with
  **New schedule** does not.
- **Absence:**
  - No row or history line shows a raw code ("workspace-gone", "unanswered").
  - No "⚠" or "needs you" appears on the Schedules page.
  - A Full run that asks for permission still raises the OS notification "… needs your permission".
- **Regression to try:** ask the agent to change an existing schedule you made yourself (e.g. "move my
  review schedule to 10:00") and click **Save**. The row must NOT say "Created by the agent." Only a new
  schedule is stamped, and editPatch never carries `createdBy`.

---

### Task 17: Session view: footer, no-model link, one send rule, back to the default model (docs-round #30)

**Spec note:** the no-model state is hard to reach by hand. `ensureDefaultModel` (`ipc.ts`) fills a null
default from any configured provider at boot and on every provider change. The GUI check below
therefore uses a hand-edited `config.json`.

**Files:**
- Modify: `src/renderer/src/components/ChatView.tsx:10`, `:694-704`, `:880-886`, `:989-993`, `:1682-1686`, `:1853`, `:1975`
- Modify: `src/main/ipc.ts:5043-5047` (`hv:set-session-model`)
- Test: `tests/session-view-fixes.test.ts` (new)
- Guide: `docs/guide/src/content/docs/session-view.md:120`, `:129`, `:155`

**Interfaces:**
- Consumes:
  - `GoTo` (`components/GoTo.tsx:35`).
  - `ModelSelect`'s `onClear?: () => void` and `clearLabel?: string` (`ModelSelect.tsx:29-30`).
  - `TIER_LABEL` (`ChatView.tsx:92`).
  - `resolveSpawnModel(root?: string, sessionId?: string)` (`ipc.ts:919`).
  - `window.hv.setSessionModel(sessionId, null)`.
- Produces: `hv:set-session-model` with `null` now applies the resolved default to a running session
  and returns `{ live: true }` when that worked.
- Shares `ChatView.tsx` with Task 8, which edits lines 3, 9 and 1100 and must not collide.

- [ ] **Step 1: Write the failing test**

`tests/session-view-fixes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** docs-round #30 — pinned as source scans: the renderer suite has no DOM, and ipc.ts reaches electron. */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const chat = read("src/renderer/src/components/ChatView.tsx");
const ipc = read("src/main/ipc.ts");

describe("docs-round #30: the / menu footer", () => {
  it("says what Enter does while the menu is open (it completes, §7 round 24)", () => {
    expect(chat).not.toContain("Enter to send");
    expect(chat).toContain("Tab or Enter to complete");
  });
});

describe("docs-round #30: the no-model notice", () => {
  it("links to the Models page, which exists, instead of naming one that doesn't", () => {
    expect(chat).not.toContain("Settings → Models");
    const at = chat.indexOf("{noModel && (");
    expect(chat.slice(at, at + 400)).toContain('<GoTo view="models" />');
    expect(chat).toContain('import { GoTo } from "./GoTo";');
  });
});

describe("docs-round #30: Enter and Send answer one question", () => {
  it("one canSend: a model, and text, a picked element or a document (§31)", () => {
    expect(chat).toContain(
      "const canSend = !noModel && (!!input.trim() || (pageRefs?.length ?? 0) > 0 || documents.length > 0);",
    );
  });

  it("submit refuses exactly when Send is disabled", () => {
    const at = chat.indexOf("const submit = (behavior?");
    expect(chat.slice(at, at + 900)).toContain("if (!canSend) return;");
    expect(chat).toContain("disabled={!canSend}");
    expect(chat).not.toMatch(/disabled=\{noModel \|\|/);
  });
});

describe("docs-round #30: the model chip's way back", () => {
  it("offers a clear row while this session has its own model, named after the tier it falls back to", () => {
    const at = chat.indexOf("<ModelSelect");
    const chip = chat.slice(at, chat.indexOf("renderTrigger", at));
    expect(chip).toContain("onClear={sessionModel ? () => void clearModel() : undefined}");
    expect(chip).toContain('clearLabel={`Use the ${TIER_LABEL[workspaceModel ? "workspace" : "global"]}`}');
    expect(chat).toContain("window.hv.setSessionModel(sessionId, null)");
  });

  it("main applies what a respawn would pick to the running session", () => {
    const h = ipc.slice(ipc.indexOf('"hv:set-session-model"'), ipc.indexOf("§16 round 16 — the session tier"));
    expect(h).toContain("const target = model ?? resolveSpawnModel(index.get(sessionId)?.workspaceId, sessionId);");
    expect(h).toContain("if (!client || !target) return { live: false };");
    expect(h).toContain("provider: target.provider, modelId: target.modelId");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

`L=/tmp/vitest.log; npx vitest run tests/session-view-fixes.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=1. All seven tests fail: "Enter to send" is present, "Settings → Models" is present, there
is no `canSend`, `disabled={noModel ||` is still there, there is no `onClear`, and there is no `target` in
the handler.

- [ ] **Step 3: Implement**

`src/renderer/src/components/ChatView.tsx:10`. Current:

```tsx
import { ModelSelect } from "./ModelSelect";
```

Replacement:

```tsx
import { ModelSelect } from "./ModelSelect";
import { GoTo } from "./GoTo";
```

`src/renderer/src/components/ChatView.tsx:694-704`. Current:

```tsx
  const pickModel = async (m: HvModel): Promise<void> => {
    setModelMenuOpen(false);
    if (!sessionId) return;
    if (resolved && m.provider === resolved.provider && m.id === resolved.modelId) return;
    try {
      const { live } = await window.hv.setSessionModel(sessionId, { provider: m.provider, modelId: m.id });
      setRestartHint(!live);
    } catch {
      /* unknown session (closed mid-click) — nothing to do */
    }
  };
```

Replacement (the pickModel body is unchanged; clearModel is added after it):

```tsx
  const pickModel = async (m: HvModel): Promise<void> => {
    setModelMenuOpen(false);
    if (!sessionId) return;
    if (resolved && m.provider === resolved.provider && m.id === resolved.modelId) return;
    try {
      const { live } = await window.hv.setSessionModel(sessionId, { provider: m.provider, modelId: m.id });
      setRestartHint(!live);
    } catch {
      /* unknown session (closed mid-click) — nothing to do */
    }
  };

  // docs-round #30: drop this session's override. Main switches the running
  // session to whatever a respawn would pick, so the chip is not a promise.
  const clearModel = async (): Promise<void> => {
    if (!sessionId) return;
    try {
      const { live } = await window.hv.setSessionModel(sessionId, null);
      setRestartHint(!live);
    } catch {
      /* unknown session (closed mid-click) — nothing to do */
    }
  };
```

`src/renderer/src/components/ChatView.tsx:880-886`. Current:

```tsx
  const submit = (behavior?: "followUp"): void => {
    // §28 round 1: a picked element is a message on its own. The comment and the
    // markup carry the whole intent, so requiring typed text as well would make
    // the popup's paper-plane hand you a composer that then refuses to send.
    // §31: a document with no typed text is a real message — the user picked a
    // file precisely so the agent would read it.
    if (!input.trim() && !(pageRefs?.length ?? 0) && !documents.length) return;
```

Replacement:

```tsx
  // docs-round #30: ONE answer to "can this be sent", for Enter and the Send
  // button alike — Enter used to send a documents-only message while Send sat
  // disabled, and to send with no model at all.
  // §28 round 1: a picked element is a message on its own. The comment and the
  // markup carry the whole intent, so requiring typed text as well would make
  // the popup's paper-plane hand you a composer that then refuses to send.
  // §31: a document with no typed text is a real message — the user picked a
  // file precisely so the agent would read it.
  const canSend = !noModel && (!!input.trim() || (pageRefs?.length ?? 0) > 0 || documents.length > 0);

  const submit = (behavior?: "followUp"): void => {
    if (!canSend) return;
```

`src/renderer/src/components/ChatView.tsx:989-993`. Current:

```tsx
            <ModelSelect
              models={models ?? []}
              loading={models === null}
              value={resolved ? { provider: resolved.provider, modelId: resolved.modelId } : null}
              onPick={(m) => void pickModel(m)}
```

Replacement:

```tsx
            <ModelSelect
              models={models ?? []}
              loading={models === null}
              value={resolved ? { provider: resolved.provider, modelId: resolved.modelId } : null}
              onPick={(m) => void pickModel(m)}
              // docs-round #30: the way back from a session override, named after
              // the tier the session falls back to (the chip's own TIER_LABEL words).
              onClear={sessionModel ? () => void clearModel() : undefined}
              clearLabel={`Use the ${TIER_LABEL[workspaceModel ? "workspace" : "global"]}`}
```

`src/renderer/src/components/ChatView.tsx:1682-1686`. Current:

```tsx
        {noModel && (
          <div className="max-w-3xl mx-auto px-1 pb-1.5 text-[11px] font-semibold text-berry">
            No model configured — add a provider in Settings → Models to start chatting.
          </div>
        )}
```

Replacement:

```tsx
        {noModel && (
          <div className="max-w-3xl mx-auto px-1 pb-1.5 text-[11px] font-semibold text-berry">
            No model configured — set one up on the <GoTo view="models" /> page to start chatting.
          </div>
        )}
```

`src/renderer/src/components/ChatView.tsx:1853`. Current:

```tsx
                <p className="px-3 pt-1 text-[10px] text-ink-soft">Tab to complete · Enter to send</p>
```

Replacement:

```tsx
                <p className="px-3 pt-1 text-[10px] text-ink-soft">Tab or Enter to complete</p>
```

`src/renderer/src/components/ChatView.tsx:1975`. Current:

```tsx
            disabled={noModel || (!input.trim() && !(pageRefs?.length ?? 0))}
```

Replacement:

```tsx
            disabled={!canSend}
```

`src/main/ipc.ts:5043-5047`. Current:

```ts
      sessionsChanged();
      const client = manager.get(sessionId) as PiClient | null;
      if (!client || !model) return { live: false };
      try {
        const res = await client.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
```

Replacement:

```ts
      sessionsChanged();
      const client = manager.get(sessionId) as PiClient | null;
      // docs-round #30: clearing the override switches the running session to
      // what its next spawn would pick — workspace, then global — through the
      // one resolver spawnOpts uses. The session tier is already cleared above.
      const target = model ?? resolveSpawnModel(index.get(sessionId)?.workspaceId, sessionId);
      if (!client || !target) return { live: false };
      try {
        const res = await client.send({ type: "set_model", provider: target.provider, modelId: target.modelId });
```

- [ ] **Step 4: Run it, expect PASS**

`L=/tmp/vitest.log; npx vitest run tests/session-view-fixes.test.ts tests/composer-commands.test.ts tests/composer-documents.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=0. `composer-commands.test.ts:101-120` still finds the command branch's Tab/Enter
completion.

- [ ] **Step 5: Guide**

`docs/guide/src/content/docs/session-view.md:120`
- Old: `…Each attachment waits above the box as a chip, with **×** to remove it, until you send. A document's chip shows its size…`
- New: `…Each attachment waits above the box as a chip, with **×** to remove it, until you send. A document can go on its own, with nothing typed. A document's chip shows its size…`

`docs/guide/src/content/docs/session-view.md:129`
- Old: `- "No model configured — add a provider in Settings → Models to start chatting.", when no model is set. You can't send until one is set on the [Models](/docs/models/) screen in the sidebar;`
- New: `- "No model configured — set one up on the Models page to start chatting.", when no model is set. Click **Models** in it to go there. You can't send until a model is set;`

`docs/guide/src/content/docs/session-view.md:155` (a new step after step 3)
- Old: `3. To change how hard it thinks, click **think:** beside it and pick a level. **default** ("Follow the default set on the Models page") puts it back.`
- New:

  ```
  3. To change how hard it thinks, click **think:** beside it and pick a level. **default** ("Follow the default set on the Models page") puts it back.
  4. To drop this session's own choice, open the chip again and pick **Use the workspace default** at the top of the list (**Use the global default** when the workspace has no model of its own). The session switches right away.
  ```

`session-view.md:171` ("Press **Tab** or **Enter** to complete one, then **Enter** again to send.") is
already right.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatView.tsx src/main/ipc.ts tests/session-view-fixes.test.ts docs/guide/src/content/docs/session-view.md
git commit -s -F - <<'MSG'
fix(docs-round #30): the message box sends by one rule, links to Models, and the model chip can go back to the default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

**GUI assertions**
- **Session view**: type `/` at the start of the box. The menu's footer reads "Tab or Enter to complete".
  Enter completes the highlighted item, and a second Enter sends.
- **Session view, then Models page**: to reach the no-model state, quit the app, delete `defaultModel`
  from `config.json` and every provider key, then relaunch. The notice reads "No model configured — set
  one up on the **Models** page to start chatting." Clicking **Models** opens the Models page.
- **Session view**: attach a document (**+** → **Attach document**) and type nothing. **Send** (the paper
  plane) is enabled, and clicking it or pressing Enter sends a bubble with the document chip.
- **Session view, then Workspace settings**: pick a model on the chip (tooltip "(session override)").
  Reopen the chip; the first row reads "Use the global default", or "Use the workspace default" when the
  workspace has its own model. Click it: the chip shows that model, its tooltip ends "(global default)"
  or "(workspace default)", and on a running session no "Model saved — applies when this session
  restarts." line appears.
- **Absence:**
  - In the no-model state, pressing Enter with typed text adds no bubble and makes no spawn attempt (no
    "session_start_failed" error toast).
  - The clear row is absent when the session has no override of its own.
  - No text reads "Settings → Models".
- **Regression to try:** while the agent is working, type a message and press Enter. It still steers
  (the Send tooltip reads "Steer — lands between tool calls"), and a message aimed at a picked sub-agent
  run still goes to that run. `canSend` gates both paths now, and both have a model and text.

---

### Task 18: Changes panel: Save anyway, the real command line, honest wand copy (docs-round #31 junk dialog, #32 command line, #21)

**Files:**
- Modify: `src/renderer/src/components/ChangesPanel.tsx:405-406`, `:426-431`, `:945-948`
- Test: `tests/changes-panel-fixes.test.ts` (new)
- Guide: `docs/guide/src/content/docs/files-and-changes.md:80`, `:126`

**Interfaces:**
- Consumes:
  - `Confirm.secondary?: { label: string; onPick: () => void | Promise<void> }` (`ChangesPanel.tsx:31`,
    rendered at `:1551-1559`).
  - `saveVersion(workspace, message, { stagedOnly, amend })` semantics (`git.ts:692-714`).
  - `TASK_COPY["commit-message"].title` (`OnBehalfView.tsx:38`) and NAV's `onBehalf` label
    (`Sidebar.tsx:342`), both used by the test.
- Produces: none.

- [ ] **Step 1: Write the failing test**

`tests/changes-panel-fixes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { TASK_COPY } from "../src/renderer/src/components/OnBehalfView";

/** docs-round #31/#32/#21 — the Changes panel, pinned as source scans (no DOM in this suite). */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const panel = read("src/renderer/src/components/ChangesPanel.tsx");
const save = panel.slice(panel.indexOf("const doSave = async"), panel.indexOf("const doSwitch = async"));

describe("docs-round #31: the junk-files dialog", () => {
  it("offers Save anyway — §29: declining the .gitignore still saves, it is their repo", () => {
    expect(save).toContain('confirmLabel: "Add to .gitignore and save"');
    expect(save).toContain('secondary: { label: "Save anyway", onPick: () => { setConfirm(null); commit(); } }');
  });
});

describe("docs-round #32: the command line prints what saveVersion runs", () => {
  it("add -A unless only the staged files go in — amend or not", () => {
    expect(save).toContain('`${stagedOnly ? "" : "git add -A && "}git commit${opts.amend ? " --amend" : ""} -m "${text}"`');
    expect(save).not.toContain('"add -A && git commit"');
  });

  it("…which is git.ts's own rule", () => {
    const git = read("src/main/git.ts");
    const sv = git.slice(git.indexOf("export async function saveVersion"), git.indexOf("export async function stageFile"));
    expect(sv).toMatch(/if \(!opts\.stagedOnly\) \{\s*const add = await run\(state\.root, \["add", "-A"/);
    expect(sv).toContain('if (opts.amend) args.push("--amend");');
  });
});

describe("docs-round #21: the wand's tooltip", () => {
  const at = panel.indexOf('aria-label="Write it for me"');
  const wand = panel.slice(at - 600, at);

  it("promises no price — the model is whichever one AI autofill picks", () => {
    expect(wand).not.toMatch(/\$\d/);
    expect(wand).not.toContain("cheap");
  });

  it("names the setting that picks the model, in the words that page and the sidebar use", () => {
    const page = NAV.find((n) => n.view === "onBehalf")!.label;
    expect(wand).toContain(`using the model picked for ${TASK_COPY["commit-message"].title} in ${page}`);
    expect(wand).toContain("Not counted in session costs.");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

`L=/tmp/vitest.log; npx vitest run tests/changes-panel-fixes.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=1.
- "Save anyway" is missing.
- The command-template test finds `"add -A && git commit"`.
- The wand test finds `$0` in "about $0.001 per draft" and "cheap".
- The model-setting test fails on "using the model picked for Commit message in AI autofill".
- The `git.ts` rule test already passes: it pins the existing code.

- [ ] **Step 3: Implement**

`src/renderer/src/components/ChangesPanel.tsx:405-406`. Current:

```tsx
      void act(
        `git ${opts.amend ? "commit --amend" : "add -A && git commit"} -m "${text}"`,
```

Replacement:

```tsx
      void act(
        // docs-round #32: the line saveVersion (git.ts) actually runs — `add -A`
        // unless only the staged files go in, whether or not it amends.
        `${stagedOnly ? "" : "git add -A && "}git commit${opts.amend ? " --amend" : ""} -m "${text}"`,
```

`src/renderer/src/components/ChangesPanel.tsx:426-431`. Current:

```tsx
        confirmLabel: "Add to .gitignore and save",
        onConfirm: async () => {
          await window.hv.gitAddGitignore(workspace, junk);
          setConfirm(null);
          commit();
        },
```

Replacement (the `secondary` pattern of `:1068-1071`; the dialog renders Cancel · Save anyway · Add to
.gitignore and save):

```tsx
        confirmLabel: "Add to .gitignore and save",
        onConfirm: async () => {
          await window.hv.gitAddGitignore(workspace, junk);
          setConfirm(null);
          commit();
        },
        // docs-round #31: declining the .gitignore still saves (§29, prd.md:912).
        secondary: { label: "Save anyway", onPick: () => { setConfirm(null); commit(); } },
```

`src/renderer/src/components/ChangesPanel.tsx:945-948`. Current:

```tsx
                        // The tooltip carries the cost disclosure, which is the
                        // load-bearing part: this call is a one-shot outside any
                        // session, so it never reaches the cost ledger (§2b).
                        title="Write it for me — drafts a message from your changes using a small, cheap model (about $0.001 per draft). Not counted in session costs."
```

Replacement (the model really is `task.model ?? resolveSpawnModel(workspaceId)`, `ipc.ts:5602`):

```tsx
                        // The tooltip says which setting picks the model and that
                        // the call is outside the ledger — a one-shot outside any
                        // session never reaches it (§2b). No price: the model is
                        // whichever one AI autofill picks (docs-round #21).
                        title="Write it for me — drafts a message from your changes, using the model picked for Commit message in AI autofill (your default model unless you pick one there). Not counted in session costs."
```

- [ ] **Step 4: Run it, expect PASS**

`L=/tmp/vitest.log; npx vitest run tests/changes-panel-fixes.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

Expected: EXIT=0.

- [ ] **Step 5: Guide**

`docs/guide/src/content/docs/files-and-changes.md:80`
- Old: `- The wand, "Write it for me", drafts a message from your changes. It shows only when the **Commit message** job is on in [AI autofill](/docs/ai-autofill/) and a model is set up.`
- New: `- The wand, "Write it for me", drafts a message from your changes, using the model picked for **Commit message** in [AI autofill](/docs/ai-autofill/), or your default model. It shows only when that job is on and a model is set up.`

`docs/guide/src/content/docs/files-and-changes.md:126`
- Old: `…"This save includes files you probably didn’t mean to keep". **Add to .gitignore and save** leaves those folders out of this save and every later one. **Cancel** saves nothing.`
- New: `…"This save includes files you probably didn’t mean to keep". **Add to .gitignore and save** leaves those folders out of this save and every later one. **Save anyway** saves everything, those folders included. **Cancel** saves nothing.`

No guide page describes the command line at the panel's foot, so #32 needs no guide edit.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChangesPanel.tsx tests/changes-panel-fixes.test.ts docs/guide/src/content/docs/files-and-changes.md
git commit -s -F - <<'MSG'
fix(docs-round #31, #32, #21): Changes panel can save anyway, shows the command it ran, and names the wand's model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

**GUI assertions**
- **Changes panel**, in a repo with an untracked `node_modules/` that isn't in `.gitignore`: type a
  message and save. The dialog "This save includes files you probably didn’t mean to keep" offers
  **Cancel**, **Save anyway** and **Add to .gitignore and save**. **Save anyway** shows "Version saved.",
  and in a terminal `git show --stat HEAD` lists `node_modules/…`.
- **Changes panel**: with two changed files, stage one and save. The foot shows `$ git commit -m "…"`.
  With nothing staged it shows `$ git add -A && git commit -m "…"`. Using **▾** → amend with nothing
  staged, it shows `$ git add -A && git commit --amend -m "…"`.
- **Changes panel, then AI autofill**: hovering the wand shows "Write it for me — drafts a message from
  your changes, using the model picked for Commit message in AI autofill (your default model unless you
  pick one there). Not counted in session costs." The AI autofill page's row is titled
  **Commit message**.
- **Absence:**
  - **Save anyway** writes nothing to `.gitignore` (`git diff .gitignore` is empty).
  - A staged-only save's line has no `git add -A`.
  - The wand tooltip has no "$" figure.
- **Regression to try:** in the same junk repo, click **Add to .gitignore and save**. `.gitignore` gains
  the `node_modules/` line, the version saves without it, and the next save doesn't show the dialog again.

---

### Task 19a: Stats stops listing AGENTS.md among the app's own calls (docs-round #13)

**Files:**
- Modify: `src/renderer/src/components/DashboardView.tsx:176-178`, `:185`
- Modify: `src/main/analytics.ts:69-70` (comment)
- Test: `tests/oneshot-audit.test.ts` (existing, describe at `:228-239`)
- Guide: none — `docs/guide/src/content/docs/stats.md:30` already names only the three calls.

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** — in `tests/oneshot-audit.test.ts`, replace the closing of the `agents-md is not a one-shot kind` describe:

```ts
    expect(read("src/main/ipc.ts")).not.toMatch(/oneShot\("agents-md"/);
  });
});
```
with:
```ts
    expect(read("src/main/ipc.ts")).not.toMatch(/oneShot\("agents-md"/);
  });

  it("no surface still lists it among the app's own calls (docs round #13)", () => {
    // The scan above never looked at the Stats sentence or analytics' doc
    // comment, and both kept the fourth kind after it went.
    const stats = read("src/renderer/src/components/DashboardView.tsx");
    expect(stats).not.toMatch(/AGENTS\.md/);
    expect(read("src/main/analytics.ts")).not.toMatch(/AGENTS\.md/);
    expect(stats).toContain("(session titles, commit messages, PR drafts)");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/oneshot-audit.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: the new test fails with `expected '…' not to match /AGENTS\.md/`; the others still pass.

- [ ] **Step 3: Implement**

`src/renderer/src/components/DashboardView.tsx` — current:
```tsx
            {/* Round 15 — the model calls the app makes on your behalf: naming a
                session, drafting AGENTS.md, writing a commit message, drafting a
                pull request. They run with no session, so they carry no usage
```
replacement:
```tsx
            {/* Round 15 — the model calls the app makes on your behalf: naming a
                session, writing a commit message, drafting a pull request. They
                run with no session, so they carry no usage
```
current:
```tsx
                itself (session titles, AGENTS.md, commit messages, PR drafts) — roughly{" "}
```
replacement:
```tsx
                itself (session titles, commit messages, PR drafts) — roughly{" "}
```

`src/main/analytics.ts` — current:
```ts
   * Round 15 — the app's own `pi -p --no-session` calls (session titles, the
   * AGENTS.md draft, the commit message, the PR draft).
```
replacement:
```ts
   * Round 15 — the app's own `pi -p --no-session` calls (session titles, the
   * commit message, the PR draft).
```

- [ ] **Step 4: Run it, expect PASS** (same command).

- [ ] **Step 5: Guide** — none. `stats.md:30` already reads "naming a session, writing a commit message, drafting a pull request".

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/DashboardView.tsx src/main/analytics.ts tests/oneshot-audit.test.ts
  git commit -s -F - <<'MSG'
  fix(docs-round #13): Stats no longer lists AGENTS.md among the app's own model calls

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Stats** (The record → Stats), once any one-shot call has run (for example after a new session gets its title): the line under the tiles reads "Plus N model call(s) the app made itself (session titles, commit messages, PR drafts) — roughly …".
- Absence: the word "AGENTS.md" does not appear anywhere on the Stats page.
- Where it's owned: the **Audit log** lists the same calls. Every row there is "named a session", "wrote a commit message" or "drafted a pull request", matching the sentence.
- Regression to check: start a session, send one message, wait for the sidebar title to change, open Stats. The sentence must still appear, and its count must have gone up by one.

---

---

### Task 19b: MCP copy says what a change does to open sessions, the 🔌 tooltip names whose check it is, and the reload notice names its cause (docs-round #14)

**Spec note:** a built-in tool toggle reloads under reason `"skills"` (`ipc.ts:4260`), so a notice worded per reason would tell a Plan-mode toggle "skill changes". `ReloadReason` gains `"tools"`, and that one call site switches to it. A plugin install that brings skills, prompts and servers together still coalesces last-writer-wins (`ipc.ts:2729-2730`), so its notice names MCP. That was already documented as cosmetic, and I left it alone.

**Files:**
- Modify: `src/renderer/src/components/McpServersSection.tsx:168` (comment), `:293-294`, `:563`
- Modify: `src/renderer/src/hv.d.ts:1346` (comment)
- Modify: `src/renderer/src/mcpChip.ts:32` (append `mcpChipTitle`)
- Modify: `src/renderer/src/components/ChatView.tsx:26`, `:2859`, `:2866`
- Create: `src/renderer/src/reloadNotice.ts`
- Modify: `src/renderer/src/App.tsx:1794-1801` + one import line
- Modify: `src/main/ipc.ts:235-236`, `:2729`, `:4260`
- Test: `tests/mcp-reload-copy.test.ts` (new)
- Guide: `docs/guide/src/content/docs/session-view.md:48`

**Interfaces:** Produces:
- `mcpChipTitle(rows: McpRowLike[]): string` in `src/renderer/src/mcpChip.ts`
- `RELOAD_NOTICE: Record<string, string>` and `reloadNotice(reason: string): string` in `src/renderer/src/reloadNotice.ts` (import-free)
- `type ReloadReason = "mcp" | "skills" | "promptTemplates" | "tools"` in `ipc.ts`

Consumes: `activity.isIdle` / `pendingMcpReload` in `runMcpReloadPass` (unchanged; pinned by source scan).

- [ ] **Step 1: Write the failing test** — `tests/mcp-reload-copy.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mcpChipTitle } from "../src/renderer/src/mcpChip";
import { RELOAD_NOTICE, reloadNotice } from "../src/renderer/src/reloadNotice";

/**
 * docs round #14 — three MCP-adjacent strings described the wrong thing:
 * "new sessions only" (idle sessions restart at once), "connected for this
 * session" (the number is main's own app-wide probe), and a reload notice that
 * named MCP whatever caused the reload.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
/** Comments stripped, whitespace collapsed — JSX wraps prose across lines (tests/go-to.test.ts). */
const rendered = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ");
const row = (state: string) => ({ name: state, scope: "global" as const, workspaceId: null, state });

describe("the MCP pages say what a change does to open sessions", () => {
  test("the behaviour the copy describes: idle sessions restart now, busy ones defer", () => {
    // The copy is only true while runMcpReloadPass does exactly this.
    expect(read("src/main/ipc.ts")).toMatch(
      /if \(activity\.isIdle\(id\)\) await reloadSession\(id\);[^\n]*\n\s*else pendingMcpReload\.add\(id\);/,
    );
  });

  test("the list header and the add/edit dialog say it, and 'new sessions' is gone", () => {
    const s = rendered("src/renderer/src/components/McpServersSection.tsx");
    expect(s).toContain("Open sessions restart to pick up a change once they're idle");
    expect(s).toContain("Open sessions restart to pick it up once they're idle.");
    expect(s).not.toMatch(/new sessions/);
  });
});

describe("the 🔌 chip's tooltip names whose check the number is", () => {
  test("n of m, in the MCP page's own words", () => {
    expect(mcpChipTitle([row("connected"), row("failed")])).toBe("1 of 2 MCP servers answered HappyVibe's check");
    expect(mcpChipTitle([row("connected")])).toBe("1 of 1 MCP server answered HappyVibe's check");
    expect(mcpChipTitle([row("needs-auth"), row("checking")])).toBe("0 of 2 MCP servers answered HappyVibe's check");
  });

  test("ChatView renders it and no longer claims a session connection", () => {
    const c = read("src/renderer/src/components/ChatView.tsx");
    expect(c).toContain("title={mcpChipTitle(rows)}");
    expect(c).not.toContain("connected for this session");
  });
});

describe("the reload notice names the change that caused it", () => {
  const reasons = [...read("src/main/ipc.ts").match(/type ReloadReason = ([^;]+);/)![1].matchAll(/"(\w+)"/g)].map(
    (m) => m[1],
  );

  test("one line per ReloadReason, derived from ipc.ts", () => {
    expect(reasons.length).toBeGreaterThan(0); // guard: not vacuous
    expect(Object.keys(RELOAD_NOTICE).sort()).toEqual([...reasons].sort());
  });

  test("every line keeps the reset warning; only the MCP one names MCP", () => {
    for (const r of reasons) {
      expect(reloadNotice(r), r).toMatch(/permission grants and dangerous mode reset to safe defaults\.$/);
      expect(/MCP/.test(reloadNotice(r)), r).toBe(r === "mcp");
    }
    expect(reloadNotice("something-new")).toMatch(/^Reloading to apply your changes — /);
  });

  test("a built-in tool toggle reloads as 'tools', not 'skills'", () => {
    const ipc = read("src/main/ipc.ts");
    expect(ipc).toMatch(/ipcMain\.handle\("hv:builtins-set"[\s\S]{0,900}?scheduleRuntimeReload\("tools", "global", null\)/);
    expect(ipc).not.toContain('scheduleRuntimeReload("skills", "global", null)');
  });

  test("App renders the notice from the reason main sends", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toContain("text: reloadNotice(reason)");
    expect(app).not.toContain("Reloading to apply MCP server changes");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/mcp-reload-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: the file fails to load with `Failed to resolve import "../src/renderer/src/reloadNotice"`, and `mcpChipTitle` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/renderer/src/reloadNotice.ts` (new, import-free so both the renderer and vitest can import it):
```ts
/**
 * docs round #14 — the transcript notice when main respawns a session to apply
 * a config change (`hv:session-reloading`, ipc.ts reloadSession). One line per
 * ReloadReason; tests/mcp-reload-copy.test.ts derives the key set from that
 * type, so a new reason without its words fails there. Import-free: the
 * renderer and vitest both load it.
 */
const RESET = "permission grants and dangerous mode reset to safe defaults.";

export const RELOAD_NOTICE: Record<string, string> = {
  mcp: `Reloading to apply MCP server changes — ${RESET}`,
  skills: `Reloading to apply skill changes — ${RESET}`,
  promptTemplates: `Reloading to apply prompt changes — ${RESET}`,
  tools: `Reloading to apply built-in tool changes — ${RESET}`,
};

export function reloadNotice(reason: string): string {
  return RELOAD_NOTICE[reason] ?? `Reloading to apply your changes — ${RESET}`;
}
```

`src/renderer/src/App.tsx` — add after `import { rewindActions, tailToolCallIds, type RewindScope } from "./rewind";`:
```tsx
import { reloadNotice } from "./reloadNotice";
```
current:
```tsx
    // MCP config/auth changed → main respawns this session (resumed) to apply it.
    // The intentional exit clears the crash banner (onPiExit); note why it blinked.
    const offReloading = window.hv.onSessionReloading(({ sessionId }) => {
      appendItem(sessionId, {
        kind: "notice",
        text: "Reloading to apply MCP server changes — permission grants and dangerous mode reset to safe defaults.",
      });
    });
```
replacement:
```tsx
    // A config change (MCP, skills, prompts, built-in tools) → main respawns this
    // session (resumed) to apply it, and says which. The intentional exit clears
    // the crash banner (onPiExit); note why it blinked.
    const offReloading = window.hv.onSessionReloading(({ sessionId, reason }) => {
      appendItem(sessionId, { kind: "notice", text: reloadNotice(reason) });
    });
```

`src/main/ipc.ts` — current:
```ts
/** Which config source a live respawn is applying — cosmetic, shown in the renderer notice. */
type ReloadReason = "mcp" | "skills" | "promptTemplates";
```
replacement:
```ts
/** Which config source a live respawn is applying — cosmetic, shown in the renderer notice
    (one line per value in src/renderer/src/reloadNotice.ts, pinned by tests/mcp-reload-copy.test.ts). */
type ReloadReason = "mcp" | "skills" | "promptTemplates" | "tools";
```
current:
```ts
  // Reason for each pending/in-flight reload (mcp | skills | commands) —
```
replacement:
```ts
  // Reason for each pending/in-flight reload (mcp | skills | promptTemplates | tools) —
```
current (in `hv:builtins-set`):
```ts
    setBuiltinTools(t);
    scheduleRuntimeReload("skills", "global", null);
  });
```
replacement:
```ts
    setBuiltinTools(t);
    scheduleRuntimeReload("tools", "global", null);
  });
```

`src/renderer/src/mcpChip.ts` — append after `mcpChipLabel`:
```ts

/**
 * docs round #14 — the chip's tooltip. The number is main's own probe
 * (`hv:mcp-status`, app-wide), not this session's connection, so it says so,
 * in the words the MCP page uses for the same badge.
 */
export function mcpChipTitle(rows: McpRowLike[]): string {
  const up = rows.filter((r) => r.state === "connected").length;
  return `${up} of ${rows.length} MCP server${rows.length === 1 ? "" : "s"} answered HappyVibe's check`;
}
```

`src/renderer/src/components/ChatView.tsx` — current:
```tsx
import { mcpChipLabel, serversForWorkspace } from "../mcpChip";
```
replacement:
```tsx
import { mcpChipLabel, mcpChipTitle, serversForWorkspace } from "../mcpChip";
```
current (in `McpChip`):
```tsx
  const up = rows.filter((r) => r.state === "connected").length;
  return (
```
replacement:
```tsx
  return (
```
current:
```tsx
        title={`${up} of ${rows.length} MCP server${rows.length === 1 ? "" : "s"} connected for this session`}
```
replacement:
```tsx
        title={mcpChipTitle(rows)}
```

`src/renderer/src/components/McpServersSection.tsx` — current:
```tsx
 * Config read at session start — changes apply to new sessions.
```
replacement:
```tsx
 * Config read at session start — a change respawns open sessions once they're
 * idle (ipc.ts scheduleMcpReload).
```
current:
```tsx
        Model Context Protocol servers add external tools. Changes apply to new sessions only —
        every MCP call still goes through your permission rules.
```
replacement:
```tsx
        Model Context Protocol servers add external tools. Open sessions restart to pick up a change once
        they're idle — every MCP call still goes through your permission rules.
```
current:
```tsx
        <p className="text-sm text-ink-soft">Applies to new sessions. Every MCP call goes through your permission rules.</p>
```
replacement:
```tsx
        <p className="text-sm text-ink-soft">Open sessions restart to pick it up once they're idle. Every MCP call goes through your permission rules.</p>
```

`src/renderer/src/hv.d.ts` — current:
```ts
  // MCP server config (additive). Changes apply to new sessions.
```
replacement:
```ts
  // MCP server config (additive). A change restarts open sessions once they're idle.
```

- [ ] **Step 4: Run it, expect PASS** (same command). Then run `tests/mcp-chip.test.ts` the same way; `mcpChipLabel` didn't change, so it must stay green.

- [ ] **Step 5: Guide** — `session-view.md:48`:
  old: `- **🔌 MCP** reads like **2/3 MCP**: how many of this session's MCP servers (small programs that hand the agent extra tools) are connected. Click it to see each server's state, and **Manage…** to open [MCP](/docs/mcp/).`
  new: `- **🔌 MCP** reads like **2/3 MCP**: how many of your MCP servers (small programs that hand the agent extra tools) answered HappyVibe's own check, which the app runs itself, apart from this session. Hover over it for "2 of 3 MCP servers answered HappyVibe's check". Click it to see each server's state, and **Manage…** to open [MCP](/docs/mcp/).`
  `mcp.md:93` and `:95` already describe the fixed behaviour; leave them. No page quotes the reload notice. Run the `docs-reviewer` agent on `session-view.md` and fix what it finds.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/McpServersSection.tsx src/renderer/src/hv.d.ts src/renderer/src/mcpChip.ts src/renderer/src/components/ChatView.tsx src/renderer/src/reloadNotice.ts src/renderer/src/App.tsx src/main/ipc.ts tests/mcp-reload-copy.test.ts docs/guide/src/content/docs/session-view.md
  git commit -s -F - <<'MSG'
  fix(docs-round #14): MCP copy says open sessions restart when idle, the 🔌 tooltip names HappyVibe's check, and the reload notice names what changed

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions** (main changed: restart the dev server, then grep `out/main/index.js` for `scheduleRuntimeReload("tools"` before checking)
- **MCP** page (Abilities → MCP), under the server list header: "…Open sessions restart to pick up a change once they're idle — every MCP call still goes through your permission rules." Same text in a workspace's settings → MCP section.
- **Add server** dialog (and **Edit** on a server): the line under the title reads "Open sessions restart to pick it up once they're idle. Every MCP call goes through your permission rules."
- Absence: the words "new sessions" appear nowhere on the MCP page, in the add/edit dialog, or in the workspace settings MCP section.
- **Session top bar**: hovering the 🔌 chip shows "N of M MCP servers answered HappyVibe's check", where N and M match the dots on the MCP page's badges for global plus this workspace's servers. Absence: "connected for this session".
- **Session transcript**, with the session idle:
  - Turning a skill off on **Skills** adds "Reloading to apply skill changes — permission grants and dangerous mode reset to safe defaults."
  - Changing a row on **Built-in tools** adds "Reloading to apply built-in tool changes — …".
  - Approving or toggling a prompt on **Prompts** adds "Reloading to apply prompt changes — …".
  - Absence: none of those three shows "MCP server changes".
- Regression to check: open a session and let it go idle. Add a server on MCP, then go back to the session. The notice must read "Reloading to apply MCP server changes — …", the session must come back with its conversation intact, and the 🔌 chip must count the new server.

---

---

### Task 19c: the Agents page names only where agents actually come from (docs-round #15)

**Spec note:** the bridge's `source:` ternary (`happyvibe-bridge.ts:411`) still has a `"user"` arm. It's reachable only when `PI_CODING_AGENT_DIR` is unset, and `spawn.ts:258` always sets it from the app's agent dir. The derived test therefore allows "user" (it is a literal the bridge can emit), but the copy names only bundled and project, as specced. `AgentSource` and `SOURCE_TONE` keep all five values.

**Files:**
- Modify: `src/renderer/src/components/AgentsView.tsx:38` (new constants after `EDITABLE_SOURCES`), `:86`, `:93`
- Test: `tests/agents-renderer.test.ts` (existing: import line `:6`, new describe at end of file)
- Guide: none — `agents.md:24-28` already lists only **project** and **bundled**.

**Interfaces:** Produces `AGENTS_INTRO: string` and `AGENTS_LOADING_SUBTITLE: string`, exported from `src/renderer/src/components/AgentsView.tsx`.

- [ ] **Step 1: Write the failing test** — in `tests/agents-renderer.test.ts`, change line 6 from:
```ts
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE, EDITABLE_SOURCES, SOURCE_TONE } from "../src/renderer/src/components/AgentsView";
```
to:
```ts
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE, AGENTS_INTRO, AGENTS_LOADING_SUBTITLE, EDITABLE_SOURCES, SOURCE_TONE } from "../src/renderer/src/components/AgentsView";
```
and append at the end of the file:
```ts

// ── docs round #15: the page names only sources the bridge can emit ─────────
describe("the Agents page's own words about where agents come from", () => {
  const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
  const literals = (s: string): string[] => [...s.matchAll(/"(\w+)"/g)].map((m) => m[1]);
  // Every AgentSource value, from its declaration.
  const all = literals(read("pi-runtime/extensions/hv-agents.ts").match(/export type AgentSource = ([^;]+);/)![1]);
  // What twEnumerateAgents can actually put in `source`: the literals of its ternary.
  const emitted = new Set(literals(read("pi-runtime/extensions/happyvibe-bridge.ts").match(/source: ourDir[^\n]*/)![0]));
  const NAMES: Record<string, RegExp> = {
    builtin: /built-in|builtin|Pi runtime/i,
    bundled: /bundled/i,
    user: /\buser\b/i,
    project: /project/i,
    package: /package/i,
  };

  test("every source has a word to look for, and the bridge emits the two the copy names", () => {
    expect(Object.keys(NAMES).sort()).toEqual([...all].sort());
    expect(emitted.has("bundled")).toBe(true);
    expect(emitted.has("project")).toBe(true);
  });

  test("the intro and the loading subtitle name no source the bridge never emits", () => {
    for (const copy of [AGENTS_INTRO, AGENTS_LOADING_SUBTITLE]) {
      for (const s of all) if (!emitted.has(s)) expect(copy, s).not.toMatch(NAMES[s]);
      expect(copy).toMatch(NAMES.bundled);
      expect(copy).toMatch(NAMES.project);
    }
  });

  test("the view renders those constants, not inline copies", () => {
    const view = read("src/renderer/src/components/AgentsView.tsx");
    expect(view).toContain("{AGENTS_INTRO}");
    expect(view).toContain("? AGENTS_LOADING_SUBTITLE");
    expect(view).not.toMatch(/installed packages|Pi runtime/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/agents-renderer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: the two copy tests fail (`AGENTS_INTRO` is undefined, and the view has no `{AGENTS_INTRO}`); the first new test and every existing test pass.

- [ ] **Step 3: Implement** — `src/renderer/src/components/AgentsView.tsx`

current:
```tsx
/** Where `hv:write-agent` is path-confined to — the only rows Edit can serve. */
export const EDITABLE_SOURCES: ReadonlySet<string> = new Set(["bundled", "project"]);
```
replacement:
```tsx
/** Where `hv:write-agent` is path-confined to — the only rows Edit can serve. */
export const EDITABLE_SOURCES: ReadonlySet<string> = new Set(["bundled", "project"]);

/**
 * docs round #15 — the page's own words for where agents come from. DATA, so
 * tests/agents-renderer.test.ts can hold them to the sources the bridge's
 * twEnumerateAgents actually emits (bundled and project; upstream's defaults
 * are off and nothing is discovered from packages).
 */
export const AGENTS_INTRO =
  "Every subagent this workspace can delegate to — HappyVibe's bundled ones, copies you've made of them, and this project's own.";
export const AGENTS_LOADING_SUBTITLE = "Bundled and project subagents you can delegate to.";
```
current:
```tsx
        <p className="text-sm text-ink-soft mb-8">Every subagent this workspace can delegate to — yours, this project's, and the ones your Pi runtime and installed packages provide.</p>
```
replacement:
```tsx
        <p className="text-sm text-ink-soft mb-8">{AGENTS_INTRO}</p>
```
current:
```tsx
              ? "Bundled, built-in, project, user and package subagents you can delegate to."
```
replacement:
```tsx
              ? AGENTS_LOADING_SUBTITLE
```

- [ ] **Step 4: Run it, expect PASS** (same command).

- [ ] **Step 5: Guide** — none. `agents.md:6` ("This screen lists every subagent this workspace can delegate to.") and `:24-28` (only **project** and **bundled**) already describe the fixed page.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/AgentsView.tsx tests/agents-renderer.test.ts
  git commit -s -F - <<'MSG'
  fix(docs-round #15): the Agents page names only bundled and project agents, the ones it can list

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Agents** page (Abilities → Agents): the line under the "Agents" heading reads "Every subagent this workspace can delegate to — HappyVibe's bundled ones, copies you've made of them, and this project's own."
- Right after a fresh launch, before the list arrives: the section subtitle reads "Bundled and project subagents you can delegate to."
- Absence: "Pi runtime", "installed packages", "built-in", "user" and "package" appear nowhere in the page's intro or subtitle.
- Where it's owned: every row's source tag on the same page reads **bundled** or **project**, never anything else.
- Regression to check: open Agents with a session running. Once the list loads, the subtitle must switch to the "N on · about … tokens of context every turn" line, as before.

---

---

### Task 19d: Prompts say "prompts", and approval pointers link to their page (docs-round #16)

**Files:**
- Modify: `src/renderer/src/components/PromptTemplatesSection.tsx:5` (import), `:119-120`, `:311` (comment), `:483-484`
- Modify: `src/renderer/src/components/SkillsSection.tsx:5` (import), `:540`
- Test: `tests/go-to.test.ts` (existing, `DEAD` list at `:54-65` plus a new describe)
- Guide: `docs/guide/src/content/docs/prompts.md:23`

**Interfaces:** Consumes `GoTo` from `src/renderer/src/components/GoTo.tsx` (its labels come from the sidebar's `NAV`: `promptTemplates` → "Prompts", `skills` → "Skills").

- [ ] **Step 1: Write the failing test** — in `tests/go-to.test.ts`, current:
```ts
    // A sixth the audit missed, found while implementing: the cost panel's
    // unknown-price banner pointed at a settings page in prose too.
    "Settings → Custom endpoint",
  ];
```
replacement:
```ts
    // A sixth the audit missed, found while implementing: the cost panel's
    // unknown-price banner pointed at a settings page in prose too.
    "Settings → Custom endpoint",
    // docs round #16: the §24 rename left "commands" behind, and both approval
    // pointers named their page in prose.
    "from the Commands page",
    "from the Skills page",
    "which commands to import",
  ];
```
and append at the end of the file:
```ts

describe("approval pointers link to the page that approves (docs round #16)", () => {
  it("a workspace's inspector points at the global page with GoTo", () => {
    expect(rendered(path.join(R, "components/PromptTemplatesSection.tsx"))).toContain(
      'Approve this prompt on the <GoTo view="promptTemplates" /> page — a workspace can only turn a global prompt off for itself.',
    );
    expect(rendered(path.join(R, "components/SkillsSection.tsx"))).toContain(
      'Approve this skill on the <GoTo view="skills" /> page — a workspace can only turn a global skill off for itself.',
    );
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/go-to.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `none of them survives` fails with hits `PromptTemplatesSection.tsx: from the Commands page`, `PromptTemplatesSection.tsx: which commands to import` and `SkillsSection.tsx: from the Skills page`. The new describe fails on both `toContain` checks.

- [ ] **Step 3: Implement**

`src/renderer/src/components/PromptTemplatesSection.tsx` — current:
```tsx
import { SkillDiff, SOURCE_TONE, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";
```
replacement:
```tsx
import { SkillDiff, SOURCE_TONE, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";
import { GoTo } from "./GoTo";
```
current:
```tsx
          Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which
          commands to import.
```
replacement:
```tsx
          Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which
          prompts to import.
```
current:
```tsx
  /** false in workspace settings for a global command: inspectable, but approval only happens from the Commands page. */
```
replacement:
```tsx
  /** false in workspace settings for a global prompt: inspectable, but approval only happens on the Prompts page. */
```
current:
```tsx
                    Approve this command from the Commands page — a workspace can only turn a global command off for
                    itself.
```
replacement:
```tsx
                    Approve this prompt on the <GoTo view="promptTemplates" /> page — a workspace can only turn a global
                    prompt off for itself.
```

`src/renderer/src/components/SkillsSection.tsx` — current:
```tsx
import { stripSkillFrontMatter } from "../skillMd";
```
replacement:
```tsx
import { stripSkillFrontMatter } from "../skillMd";
import { GoTo } from "./GoTo";
```
current:
```tsx
                    Approve this skill from the Skills page — a workspace can only turn a global skill off for itself.
```
replacement:
```tsx
                    Approve this skill on the <GoTo view="skills" /> page — a workspace can only turn a global skill off for itself.
```

- [ ] **Step 4: Run it, expect PASS** (same command). Then run `tests/skills-view.test.ts` the same way: it imports `SkillsSection`, which now pulls in `GoTo` → `Sidebar`, and must stay green.

- [ ] **Step 5: Guide** — `prompts.md:23`:
  old: `- **Import from Git URL**: fetch prompts from a "Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which commands to import."`
  new: `- **Import from Git URL**: fetch prompts from a "Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which prompts to import."`
  No page quotes the approval pointer (`skills.md:118` paraphrases it and stays true). Run the `docs-reviewer` agent on `prompts.md`.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/PromptTemplatesSection.tsx src/renderer/src/components/SkillsSection.tsx tests/go-to.test.ts docs/guide/src/content/docs/prompts.md
  git commit -s -F - <<'MSG'
  fix(docs-round #16): Prompts say "prompts", and the approve pointer links to the Prompts (or Skills) page

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Prompts** page → **Import from Git URL**: the dialog reads "…you choose which prompts to import."
- **Workspace settings → Prompts**: open a global prompt that needs review (drop a new `.md` into the managed prompts folder). It reads "Approve this prompt on the Prompts page — a workspace can only turn a global prompt off for itself.", and "Prompts" is an underlined link.
- Same flow for a skill in **Workspace settings → Skills**: "Approve this skill on the Skills page — …", with "Skills" as a link.
- Absence: "Commands page" and "which commands to import" appear nowhere in the app.
- Where it's owned: clicking the link lands on **Prompts** (or **Skills**) in the sidebar's Abilities group, where the same prompt shows **Approve**.
- Regression to check: open the inspector from workspace settings and click the **Prompts** link. The app must navigate, and the inspector overlay must be gone, with no dimmed layer left blocking clicks. Then press back into the workspace's settings; it must still open normally.

---

---

### Task 19e: the rewind tooltip and dialog say what each choice rolls back (docs-round #17)

**Files:**
- Modify: `src/renderer/src/rewind.ts:16` (append `rewindDialogBody` after `rewindActions`)
- Modify: `src/renderer/src/components/Transcript.tsx:44`
- Modify: `src/renderer/src/components/ChatView.tsx:8` (import), `:1196` (comment), `:1201-1204`
- Test: `tests/rewind-scopes.test.ts` (existing: import at `:11`, new describe at end)
- Guide: `docs/guide/src/content/docs/first-session.md:104-105`

**Interfaces:** Produces `rewindDialogBody(scope: RewindScope): string` in `src/renderer/src/rewind.ts`. Consumes `rewindActions(scope).truncateChat` (same file).

- [ ] **Step 1: Write the failing test** — in `tests/rewind-scopes.test.ts`, current:
```ts
import { describe, expect, test } from "vitest";
import { hasRestorable, rewindActions, type RewindPreview } from "../src/renderer/src/rewind";
```
replacement:
```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasRestorable, rewindActions, rewindDialogBody, type RewindPreview } from "../src/renderer/src/rewind";
```
and append at the end of the file:
```ts

// ── docs round #17: the copy follows the scope, not a V1 that no longer exists ──
describe("rewind copy says what each scope does", () => {
  const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

  test("the body promises a truncated conversation exactly when the scope truncates it", () => {
    for (const scope of ["conversation", "both", "files"] as const) {
      const body = rewindDialogBody(scope);
      expect(/removed from the conversation/.test(body), scope).toBe(rewindActions(scope).truncateChat);
      expect(/moves back into the composer/.test(body), scope).toBe(rewindActions(scope).truncateChat);
    }
    expect(rewindDialogBody("files")).toMatch(/stay exactly as they are/);
  });

  test("the tooltip no longer says files are never rolled back", () => {
    const t = read("src/renderer/src/components/Transcript.tsx");
    expect(t).not.toMatch(/not rolled back/);
    expect(t).toContain('title="Rewind to this message — you choose whether files roll back too"');
  });

  test("the dialog renders the derived body, not a fixed paragraph", () => {
    const c = read("src/renderer/src/components/ChatView.tsx");
    expect(c).toContain("{rewindDialogBody(rewindScope)}");
    expect(c).not.toMatch(/moves back into the composer so you can edit/);
    expect(c).not.toMatch(/files are NOT rolled back/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/rewind-scopes.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `rewindDialogBody is not a function`, the tooltip `not.toMatch(/not rolled back/)` fails, and the ChatView `toContain` fails. The existing `hasRestorable` / `rewindActions` tests pass.

- [ ] **Step 3: Implement**

`src/renderer/src/rewind.ts` — current:
```ts
export function rewindActions(scope: RewindScope): RewindActions {
  return {
    truncateChat: scope !== "files",
    restoreFiles: scope !== "conversation",
  };
}
```
replacement:
```ts
export function rewindActions(scope: RewindScope): RewindActions {
  return {
    truncateChat: scope !== "files",
    restoreFiles: scope !== "conversation",
  };
}

/** docs round #17 — the confirm dialog's body, per scope. Derived from
    rewindActions so "Files only" can never promise a truncated conversation. */
export function rewindDialogBody(scope: RewindScope): string {
  return rewindActions(scope).truncateChat
    ? "Everything after this point is removed from the conversation and the agent's context, and this message moves back into the composer so you can edit and resend it."
    : "The conversation and the agent's context stay exactly as they are. Only files on disk roll back to before this message.";
}
```

`src/renderer/src/components/Transcript.tsx` — current:
```tsx
      title="Rewind to this message (removes everything after; files are not rolled back)"
```
replacement:
```tsx
      title="Rewind to this message — you choose whether files roll back too"
```

`src/renderer/src/components/ChatView.tsx` — current:
```tsx
import { hasRestorable, tailToolCallIds, type RewindScope } from "../rewind";
```
replacement:
```tsx
import { hasRestorable, rewindDialogBody, tailToolCallIds, type RewindScope } from "../rewind";
```
current:
```tsx
      {/* Round 3 #11: rewind confirm — files are NOT rolled back (chat-only V1). */}
```
replacement:
```tsx
      {/* Round 3 #11 / §9: rewind confirm — the chosen scope decides what rolls back (rewindActions). */}
```
current:
```tsx
            <p className="text-sm text-ink-soft mb-3">
              Everything after this point is removed from the conversation and the agent's context, and this
              message moves back into the composer so you can edit and resend it.
            </p>
```
replacement:
```tsx
            <p className="text-sm text-ink-soft mb-3">{rewindDialogBody(rewindScope)}</p>
```

- [ ] **Step 4: Run it, expect PASS** (same command).

- [ ] **Step 5: Guide** — `first-session.md`:
  - `:104` old: `2. Hover over your message and click the rewind icon beside the copy icon. Its tooltip starts "Rewind to this message".`
    new: `2. Hover over your message and click the rewind icon beside the copy icon. Its tooltip reads "Rewind to this message — you choose whether files roll back too".`
  - `:105` old: `3. The app asks "Rewind to this message?" and explains that everything after it is removed from the conversation, and your message moves back into the message box so you can edit and resend it.`
    new: `3. The app asks "Rewind to this message?" and explains what happens: everything after it is removed from the conversation, and your message moves back into the message box so you can edit and resend it. If you pick **Files only** below, the explanation changes to "The conversation and the agent's context stay exactly as they are. Only files on disk roll back to before this message."`
  Run the `docs-reviewer` agent on `first-session.md`.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/rewind.ts src/renderer/src/components/Transcript.tsx src/renderer/src/components/ChatView.tsx tests/rewind-scopes.test.ts docs/guide/src/content/docs/first-session.md
  git commit -s -F - <<'MSG'
  fix(docs-round #17): the rewind tooltip and dialog say what each choice rolls back

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Session view**: hovering the rewind icon on one of your messages shows "Rewind to this message — you choose whether files roll back too".
- **Rewind dialog**, on a message whose turn edited a file:
  - With **Conversation only** (the default) the body reads "Everything after this point is removed from the conversation…".
  - Click **Files only** and the body switches to "The conversation and the agent's context stay exactly as they are. Only files on disk roll back to before this message."
  - Click **Conversation and files** and it switches back.
- Absence: "files are not rolled back" appears nowhere. With **Files only** selected, the dialog never says the conversation is removed.
- Where it's owned: after confirming **Files only**, the transcript still shows every message after the anchor, the composer stays empty, and **Changes** shows the edited file restored.
- Regression to check: rewind with **Conversation only** on a message whose turn only read files (no file choices shown). The body must be the "Everything after this point…" sentence, and after **Rewind** the message must move back into the composer.

---

---

### Task 19f: the extended prompt cache names who ignores it, pinned against pi-ai (docs-round #18)

**Spec note:** the pinned reader set has five modules: `anthropic-messages`, `bedrock-converse-stream`, `openai-completions`, `openai-responses` and `pi-messages`. Bedrock is included because pi-ai reads the env var there; it just isn't in our catalog, and the copy doesn't name it, as specced. "Takes effect for new sessions." stays: the spec only asks for who ignores it.

**Files:**
- Modify: `src/renderer/src/components/ModelsView.tsx:69`
- Test: `tests/cache-retention.test.ts` (existing; its doc comment at `:7-12` names module paths that no longer exist, fixed here too)
- Guide: `docs/guide/src/content/docs/models.md:69`

**Interfaces:** Consumes Task 0's `pi-runtime/node_modules` (the pi-ai tree at `pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist`). Without it the contract describe skips; the copy test still runs.

- [ ] **Step 1: Write the failing test** — replace the header of `tests/cache-retention.test.ts`, current:
```ts
import { expect, test } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

/**
 * PI_CACHE_RETENTION is pi-ai's only knob for extended prompt caching
 * (providers/anthropic.js resolveCacheRetention, providers/openai-completions.js
 * buildParams) — so this pins the exact env var name against a pin bump, not
 * just our own plumbing.
 */
```
with:
```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

/**
 * PI_CACHE_RETENTION is pi-ai's only knob for extended prompt caching (each
 * api/*.js module's resolveCacheRetention; the set is pinned below) — so this
 * pins the exact env var name against a pin bump, not just our own plumbing.
 */
```
and append at the end of the file:
```ts

// ── docs round #18: who honours it, pinned against pi-ai itself ─────────────
const PI_AI = path.resolve(
  __dirname,
  "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist",
);
const HAVE_RUNTIME = fs.existsSync(path.join(PI_AI, "api"));
/** The pi-ai api modules that read PI_CACHE_RETENTION. A bump that adds or drops one fails here — re-check the Models copy. */
const READERS = [
  "anthropic-messages.js",
  "bedrock-converse-stream.js",
  "openai-completions.js",
  "openai-responses.js",
  "pi-messages.js",
];
/** Providers the Models copy names as ignoring it: catalog id → the word on screen. */
const IGNORES: Record<string, string> = { google: "Google", mistral: "Mistral", "openai-codex": "OpenAI Codex", xai: "xAI" };

describe.skipIf(!HAVE_RUNTIME)("PI_CACHE_RETENTION, as pi-ai reads it", () => {
  test("exactly these api modules read the env var", () => {
    const dir = path.join(PI_AI, "api");
    const readers = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(dir, f), "utf8").includes("PI_CACHE_RETENTION"))
      .sort();
    expect(readers).toEqual(READERS);
  });

  test("every provider the Models copy says ignores it really does", async () => {
    type M = { api: string; compat?: { supportsLongCacheRetention?: boolean } };
    const { MODELS } = (await import(pathToFileURL(path.join(PI_AI, "models.generated.js")).href)) as {
      MODELS: Record<string, Record<string, M>>;
    };
    const readerApis = new Set(READERS.map((f) => f.replace(/\.js$/, "")));
    for (const id of Object.keys(IGNORES)) {
      const models = Object.values(MODELS[id] ?? {});
      expect(models.length, `${id} is still in pi-ai's registry`).toBeGreaterThan(0);
      for (const m of models) {
        const honours = readerApis.has(m.api) && m.compat?.supportsLongCacheRetention !== false;
        expect(honours, `${id} (${m.api}) now gets long retention — the Models copy says it ignores it`).toBe(false);
      }
    }
  });
});

test("the Models copy names who ignores it, and no longer says everyone else does", () => {
  const src = fs
    .readFileSync(path.join(__dirname, "../src/renderer/src/components/ModelsView.tsx"), "utf8")
    .replace(/\s+/g, " ");
  expect(src).not.toContain("Other providers ignore it");
  for (const label of Object.values(IGNORES)) expect(src, label).toContain(label);
  expect(src).toContain("Most other providers get the same request; Google, Mistral, OpenAI Codex, xAI and a few others ignore it.");
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/cache-retention.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: only the copy test fails (`expected '…' not to contain 'Other providers ignore it'`). The two contract tests pass, since they pin today's upstream. Check that the log shows them as passed, not skipped. A skip means Task 0's runtime install is missing.

- [ ] **Step 3: Implement** — `src/renderer/src/components/ModelsView.tsx`, current:
```tsx
          you type continuously. Other providers ignore it. Takes effect for new sessions.
```
replacement:
```tsx
          you type continuously. Most other providers get the same request; Google, Mistral, OpenAI Codex, xAI and a
          few others ignore it. Takes effect for new sessions.
```
(The names are prose, not quoted ids. `tests/models-view.test.ts:48` bans `"<provider id>"` literals in this file.)

- [ ] **Step 4: Run it, expect PASS** (same command). Then run `tests/models-view.test.ts` the same way; it must stay green.

- [ ] **Step 5: Guide** — `models.md:69`:
  old: `With this on, it keeps it for an hour on Anthropic (24 hours on OpenAI). The catch,`
  new: `With this on, it keeps it for an hour on Anthropic (24 hours on OpenAI). Most other providers are asked for the same, though "Google, Mistral, OpenAI Codex, xAI and a few others ignore it." The catch,`
  (The rest of the paragraph is unchanged.) Run the `docs-reviewer` agent on `models.md`.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/ModelsView.tsx tests/cache-retention.test.ts docs/guide/src/content/docs/models.md
  git commit -s -F - <<'MSG'
  fix(docs-round #18): Extended prompt cache names the providers that ignore it, checked against Pi's own code

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Models** page, **Extended prompt cache** card: the text ends "…loses when you type continuously. Most other providers get the same request; Google, Mistral, OpenAI Codex, xAI and a few others ignore it. Takes effect for new sessions."
- Absence: "Other providers ignore it." is gone.
- Where it's owned: the same card's **Off**/**On** switch still flips, and the choice survives a relaunch (it's global config).
- Regression to check: nothing behavioural changed. Toggle it on and start a new session: the session must boot normally with the model you picked.

---

---

### Task 19g: the open-files switch says it also sends the browser pane's address (docs-round #19)

**Files:**
- Modify: `src/renderer/src/components/SystemPromptView.tsx:144-148` (doc comment), `:162-166`
- Test: `tests/open-files-copy.test.ts` (new)
- Guide: none — `system-prompt.md:32` already says it, and the fragment it quotes ("the terminal keeps running and you keep seeing it, but the agent may lose track of it.") survives unchanged.

**Interfaces:** Consumes the `if (getOpenFilesContext()) { … }` block in `src/main/ipc.ts:3610-3630`, which the test scans for its `build*Block(` calls.

- [ ] **Step 1: Write the failing test** — `tests/open-files-copy.test.ts`:

```ts
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * docs round #19 — the "Include open files and terminals" switch also gates the
 * browser pane's address (ipc.ts, the getOpenFilesContext() block), and its
 * copy never said so. DERIVED: every block sent under that switch must be named
 * by the switch's own words, so a fourth block added there fails here.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");
const rendered = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/&apos;/g, "'").replace(/\s+/g, " ");

const SAYS: Record<string, RegExp> = {
  OpenFiles: /which files you currently have open/,
  OpenTerminals: /terminals the agent itself started/,
  OpenBrowser: /address of the browser pane it opened/,
};

test("every block the switch gates is named in the switch's copy", () => {
  const ipc = read("src/main/ipc.ts");
  const start = ipc.indexOf("if (getOpenFilesContext()) {");
  const gate = ipc.slice(start, ipc.indexOf("// §9 rewind: the snapshot", start));
  const blocks = [...gate.matchAll(/\bbuild(\w+)Block\(/g)].map((m) => m[1]);
  expect(start).toBeGreaterThan(-1);
  expect([...new Set(blocks)].sort()).toEqual(Object.keys(SAYS).sort());

  const view = read("src/renderer/src/components/SystemPromptView.tsx");
  const toggle = rendered(view.slice(view.indexOf("function OpenFilesToggle")));
  for (const b of blocks) expect(toggle, b).toMatch(SAYS[b]);
  expect(toggle).toMatch(/never the page itself/);
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/open-files-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `OpenBrowser: expected '…' to match /address of the browser pane it opened/`.

- [ ] **Step 3: Implement** — `src/renderer/src/components/SystemPromptView.tsx`

current:
```tsx
 * a dev server and then lose track of it after a compaction.
 */
function OpenFilesToggle(): React.JSX.Element {
```
replacement:
```tsx
 * a dev server and then lose track of it after a compaction.
 *
 * §28 rides it too: the address of the browser pane this session opened
 * (agentBrowsers.buildOpenBrowserBlock), never the page's content.
 * tests/open-files-copy.test.ts holds the copy to every block this gates.
 */
function OpenFilesToggle(): React.JSX.Element {
```
current:
```tsx
          It also lists the terminals the agent itself started, so it can still find a dev server it opened earlier in
          a long conversation. Turning this off takes that away too — the terminal keeps running and you keep seeing
          it, but the agent may lose track of it.
```
replacement:
```tsx
          It also lists the terminals the agent itself started, and the address of the browser pane it opened (never
          the page itself), so it can still find a dev server or a page it opened earlier in a long conversation.
          Turning this off takes that away too — the terminal keeps running and you keep seeing it, but the agent may
          lose track of it.
```

- [ ] **Step 4: Run it, expect PASS** (same command).

- [ ] **Step 5: Guide** — none. `system-prompt.md:32` already reads "…and the address of the browser pane it opened, never the page's content.", and `:45` and `:49` include the browser pane.

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/SystemPromptView.tsx tests/open-files-copy.test.ts
  git commit -s -F - <<'MSG'
  fix(docs-round #19): the open-files switch says it also sends the address of the agent's browser pane

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **System prompt** page, **Open files and terminals** card: the second paragraph reads "It also lists the terminals the agent itself started, and the address of the browser pane it opened (never the page itself), so it can still find a dev server or a page it opened earlier in a long conversation. Turning this off takes that away too — …".
- Absence: the card never claims that page content is sent.
- Where it's owned: in a session, ask the agent to open a web page (`browser_open`), then send another message. The session's context panel, or the raw message, carries an `<open-browser>` line with that address. Turn the switch **Off**, navigate the pane, send a message, and no new `<open-browser>` line is added.
- Regression to check: the switch still flips **On**/**Off** and keeps its state after leaving and reopening the page.

---

### Task 20a: Permission guidance names the real buttons and the safe-tool default (docs-round #20)

**Files:**
- Modify: `src/renderer/src/components/HowItWorks.tsx:27, 52`
- Modify: `src/renderer/src/components/EmptyState.tsx:47`
- Modify: `src/renderer/src/components/PermissionRulesSection.tsx:109`
- Modify: `src/renderer/src/components/PermissionModal.tsx:40` (export only)
- Test: `tests/how-it-works.test.ts` (existing: `:52-57`, `:176-182`, plus a new block)
- Guide: `docs/guide/src/content/docs/permissions.md:20`

**Interfaces:** Produces the export `EXPANDED_CHOICES: PermissionChoice[]` from `PermissionModal.tsx`. Task 1 edits `PermissionModal.tsx:112`; the two don't overlap.

- [ ] **Step 1: Write the failing test.** In `tests/how-it-works.test.ts`, add to the imports:
```ts
import { EXPANDED_CHOICES } from "../src/renderer/src/components/PermissionModal";
import { EMPTY_COPY } from "../src/renderer/src/components/EmptyState";
import { SAFE_TOOLS, evaluate, type RulesFile } from "../pi-runtime/extensions/hv-rules";
```
Replace the test at `:52-57`:
```ts
  it("rules names the precedence and that silence never allows", () => {
    const b = HOWTO_COPY.rules.body;
    expect(b).toMatch(/deny beats ask/i);
    expect(b).toMatch(/ask beats allow/i);
    expect(b).toMatch(/asks you/i);
  });
```
with:
```ts
  it("rules names the precedence, and its no-match sentence is what the rule engine does", () => {
    const b = HOWTO_COPY.rules.body;
    expect(b).toMatch(/deny beats ask/i);
    expect(b).toMatch(/ask beats allow/i);
    // docs-round #20 — derived from hv-rules, never re-typed: with no rule, a SAFE_TOOLS call
    // runs and anything else asks. While SAFE_TOOLS is non-empty the copy must say both halves.
    expect(SAFE_TOOLS.size).toBeGreaterThan(0);
    const none: RulesFile = { global: [], workspaces: {} };
    expect(evaluate(none, { tool: [...SAFE_TOOLS][0], input: {}, workspace: "/ws" })).toEqual({ action: "allow", source: "safe-default" });
    expect(evaluate(none, { tool: "bash", input: { command: "ls" }, workspace: "/ws" })).toEqual({ action: "ask", source: "default" });
    expect(b).toContain("When no rule matches, a short list of safe tools runs on its own; everything else asks you.");
    expect(b).not.toMatch(/by silence/i);
  });
```
Replace `:178`:
```ts
    expect(b).toMatch(/Allow for this session/);
```
with:
```ts
    expect(b).toContain("“Allow for session”");
```
Append:
```ts
describe("docs-round #20 — a button named in guidance is a button the prompt has", () => {
  it("every quoted Allow/Always/Deny label in HOWTO_COPY is one of the modal's choices", () => {
    const quoted = Object.values(HOWTO_COPY).flatMap((v) =>
      [...v.body.matchAll(/“((?:Allow|Always|Deny)[^”]*)”/g)].map((m) => m[1]));
    expect(quoted.length).toBeGreaterThan(0); // not vacuous
    for (const q of quoted) expect(EXPANDED_CHOICES, q).toContain(q);
  });

  it("the rules empty state names a real button", () => {
    expect(EMPTY_COPY.rules.next).toBe("Add one below, or choose Always allow when the agent asks.");
    expect(EXPANDED_CHOICES.some((c) => EMPTY_COPY.rules.next.includes(`choose ${c} `))).toBe(true);
  });

  it("the rules subtitle says what the long form says", () => {
    const src = rendered(path.join(R, "components", "PermissionRulesSection.tsx"));
    expect(src).not.toContain("No match falls back to asking you.");
    expect(src).toContain("With no match, a short list of safe tools runs on its own and everything else asks you.");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/how-it-works.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `EXPANDED_CHOICES` is undefined (`TypeError … toContain`/`some`). With that fixed, the failures become the missing sentences and "Allow for this session" not being in the choices.

- [ ] **Step 3: Implement**

`PermissionModal.tsx:40`. Current: `const EXPANDED_CHOICES: PermissionChoice[] = [`
Replacement: `export const EXPANDED_CHOICES: PermissionChoice[] = [`

`HowItWorks.tsx:27`. Current substring:
`When no rule matches, the app asks you; nothing is ever allowed by silence. “Allow for this session” lives in memory only,`
Replacement:
`When no rule matches, a short list of safe tools runs on its own; everything else asks you. “Allow for session” lives in memory only,`

`HowItWorks.tsx:52`. Current substring:
`using the same rules as the agent's browser: “Allow for this session”, or a rule for that site, covers both from then on.`
Replacement:
`using the same rules as the agent's browser: “Allow for session”, or a rule for that site, covers both from then on.`

`EmptyState.tsx:47`. Current:
```ts
    next: "Add one below, or let the agent ask and choose Always.",
```
Replacement:
```ts
    next: "Add one below, or choose Always allow when the agent asks.",
```

`PermissionRulesSection.tsx:109`. Current:
```tsx
          : "Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). No match falls back to asking you."}
```
Replacement:
```tsx
          : "Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). With no match, a short list of safe tools runs on its own and everything else asks you."}
```

- [ ] **Step 4: Run it, expect PASS** (same command). Also `tests/empty-state.test.ts` (the no-dead-copy rule):
  `L=/tmp/vitest.log; npx vitest run tests/empty-state.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 5: Guide**
  - `permissions.md:20`. Old: `"Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). No match falls back to asking you."`
    New: `"Tool, path and command rules for every workspace. Workspace overrides layer on top — the most restrictive match wins (deny > ask > allow). With no match, a short list of safe tools runs on its own and everything else asks you." The safe tools are the ones that only read, such as reading and searching your project's files. The **Test a call** box below tells you which ones: it says "(safe tool default)".`

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/HowItWorks.tsx src/renderer/src/components/EmptyState.tsx src/renderer/src/components/PermissionRulesSection.tsx src/renderer/src/components/PermissionModal.tsx tests/how-it-works.test.ts docs/guide/src/content/docs/permissions.md
  git commit -s -F - <<'MSG'
  fix(docs-round #20): permission guidance names the real buttons and says safe tools run on their own

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Permissions page:** the subtitle ends "With no match, a short list of safe tools runs on its own and everything else asks you." **How rules combine** reads "When no rule matches, a short list of safe tools runs on its own; everything else asks you. “Allow for session” lives in memory only…".
- **Permissions page, with no global rules:** the empty box reads "Add one below, or choose Always allow when the agent asks."
- **Built-in tools page:** Web tools → **How web tools work** says "“Allow for session”, or a rule for that site, covers both".
- **Absence:** "Allow for this session", "by silence" and "choose Always." appear on none of these pages.
- **Session view:** the permission dialog still shows its five buttons (the export must not change the list).
- **Regression to check:** type `read` into **Test a call** → "(safe tool default)"; type `bash` → "(no rule matched — default is ask)". The copy now describes exactly these two.

---

---

### Task 20b: Per-OS copy for the terminal shell, crash reports and microphone settings (docs-round #22)

**Spec note:** on Windows the **Shell arguments** box still shows `-l`, because that's the saved default (`terminalSettings.ts:63`). Spawn drops it while the path is blank and the arguments are unchanged (`terminalSettings.ts:183-186` → `platform.ts:173`). The plan's Windows hint says exactly that, rather than changing the stored default (which would touch every Mac user's settings file). The ⇧Enter part of #22 is in another task.

**Files:**
- Modify: `src/renderer/src/platformCopy.ts:55` (append)
- Modify: `src/renderer/src/components/TerminalView.tsx:1-5 (imports), 225-234`
- Modify: `src/renderer/src/components/PrivacyView.tsx:1-4 (imports), 133`
- Modify: `src/renderer/src/components/VoiceView.tsx:2, 403`
- Test: `tests/mod-key-copy.test.ts` (existing)
- Guide: `docs/guide/src/content/docs/terminal.md:33, 36`, `privacy.md:38`, `voice.md:55-56`

**Interfaces:** Produces, from `src/renderer/src/platformCopy.ts`:
- `shellCopy(platform: string): { subtitle; pathHint; placeholder; argsHint }` and `SHELL_COPY`
- `micSettingsLabel(platform: string): string` and `MIC_SETTINGS_BUTTON`

- [ ] **Step 1: Write the failing test.** In `tests/mod-key-copy.test.ts`, change the platformCopy import (line 4) to:
```ts
import { micSettingsLabel, modKey, revealLabel, shellCopy, THIS_COMPUTER, YOUR_COMPUTER } from "../src/renderer/src/platformCopy";
```
Append:
```ts
describe("docs-round #22 — per-OS copy the Windows round missed", () => {
  it("the terminal Shell rows say what a blank path really starts, per OS", () => {
    const win = shellCopy("win32");
    expect(win.pathHint).toBe("Blank uses PowerShell 7, then Windows PowerShell, then the Command Prompt.");
    expect(win.placeholder).toBe("pwsh.exe");
    for (const s of Object.values(win)) expect(s).not.toMatch(/\$SHELL|login shell/);
    for (const p of ["darwin", "linux"]) {
      expect(shellCopy(p).pathHint, p).toBe("Blank uses your login shell ($SHELL).");
      expect(shellCopy(p).placeholder, p).toBe("$SHELL");
      expect(shellCopy(p).argsHint, p).toBe("Space-separated. -l starts a login shell, so your real PATH and version managers work.");
    }
    for (const p of ["darwin", "linux", "win32"]) {
      for (const s of Object.values(shellCopy(p))) expect(s, p).not.toContain("`"); // plain text, not markdown
    }
  });

  it("TerminalView renders them instead of its own literals", () => {
    const src = code(path.join(SRC, "components", "TerminalView.tsx"));
    for (const k of ["subtitle", "pathHint", "placeholder", "argsHint"]) expect(src).toContain(`SHELL_COPY.${k}`);
    expect(src).not.toContain("Blank uses $SHELL");
    expect(src).not.toContain("`-l`");
  });

  it("the microphone button names the OS's settings app; the crash-reports button names its file manager", () => {
    expect(micSettingsLabel("darwin")).toBe("Open System Settings");
    expect(micSettingsLabel("win32")).toBe("Open Settings");
    const voice = code(path.join(SRC, "components", "VoiceView.tsx"));
    expect(voice).toContain("{MIC_SETTINGS_BUTTON}");
    expect(voice).not.toContain("Open System Settings");
    const privacy = code(path.join(SRC, "components", "PrivacyView.tsx"));
    expect(privacy).toContain("{REVEAL_IN_FILE_MANAGER}");
    expect(privacy).not.toContain("Reveal crash reports");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/mod-key-copy.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `shellCopy is not a function` / `micSettingsLabel is not a function`.

- [ ] **Step 3: Implement**

`src/renderer/src/platformCopy.ts`, append after `MIC_DENIED_HINT` (end of file, `:55`):
```ts
/** The Voice page's button to the microphone setting. Windows calls its app "Settings"
    (MIC_DENIED_HINT above already does); hv:voice-open-mic-settings opens ms-settings there. */
export function micSettingsLabel(platform: string): string {
  return platform === "win32" ? "Open Settings" : "Open System Settings";
}
export const MIC_SETTINGS_BUTTON: string = micSettingsLabel(here);

/**
 * The terminal settings' Shell rows (docs-round #22). A blank path starts what
 * `terminalShell()` in src/main/platform.ts picks: `$SHELL` (else zsh/bash) on POSIX,
 * pwsh.exe → powershell.exe → COMSPEC/cmd.exe on Windows, which is never a login shell.
 * PowerShell rejects `-l`, so `terminalShellArgs()` drops the default while the path is blank.
 */
export function shellCopy(platform: string): { subtitle: string; pathHint: string; placeholder: string; argsHint: string } {
  if (platform === "win32") {
    return {
      subtitle: "What gets started, and in what environment. Leave the path blank to use the default shell.",
      pathHint: "Blank uses PowerShell 7, then Windows PowerShell, then the Command Prompt.",
      placeholder: "pwsh.exe",
      argsHint: "Space-separated. While the path is blank, the default shell starts without -l, because PowerShell rejects it.",
    };
  }
  return {
    subtitle: "What gets started, and in what environment. Leave the path blank to use your login shell.",
    pathHint: "Blank uses your login shell ($SHELL).",
    placeholder: "$SHELL",
    argsHint: "Space-separated. -l starts a login shell, so your real PATH and version managers work.",
  };
}
export const SHELL_COPY = shellCopy(here);
```

`TerminalView.tsx`: add to the imports:
```ts
import { SHELL_COPY } from "../platformCopy";
```
`TerminalView.tsx:225-234`. Current:
```tsx
      <Section icon="terminal" title="Shell" subtitle="What gets started, and in what environment. Leave the path blank to use your login shell.">
        <Row label="Shell path" hint={`Blank uses $SHELL. ${s.shellPath ? "" : "Currently: your login shell."}`} field="shellPath">
          <input
            value={s.shellPath ?? ""}
            placeholder="$SHELL"
            onChange={(e) => patch({ shellPath: e.target.value.trim() ? e.target.value : null })}
            className={`${input} w-64`}
          />
        </Row>
        <Row label="Shell arguments" hint="Space-separated. `-l` starts a login shell, so your real PATH and version managers work." field="shellArgs">
```
Replacement:
```tsx
      <Section icon="terminal" title="Shell" subtitle={SHELL_COPY.subtitle}>
        <Row label="Shell path" hint={SHELL_COPY.pathHint} field="shellPath">
          <input
            value={s.shellPath ?? ""}
            placeholder={SHELL_COPY.placeholder}
            onChange={(e) => patch({ shellPath: e.target.value.trim() ? e.target.value : null })}
            className={`${input} w-64`}
          />
        </Row>
        <Row label="Shell arguments" hint={SHELL_COPY.argsHint} field="shellArgs">
```

`PrivacyView.tsx`: add to the imports:
```ts
import { REVEAL_IN_FILE_MANAGER } from "../platformCopy";
```
`PrivacyView.tsx:133`. Current: `            Reveal crash reports`
Replacement: `            {REVEAL_IN_FILE_MANAGER}` (the section title, "Crash reports", carries the noun).

`VoiceView.tsx:2`. Current: `import { MIC_DENIED_HINT } from "../platformCopy";`
Replacement: `import { MIC_DENIED_HINT, MIC_SETTINGS_BUTTON } from "../platformCopy";`
`VoiceView.tsx:403`. Current: `                  Open System Settings`
Replacement: `                  {MIC_SETTINGS_BUTTON}`

- [ ] **Step 4: Run it, expect PASS** (same command).

- [ ] **Step 5: Guide**
  - `terminal.md:33`. Old: `"What gets started, and in what environment. Leave the path blank to use your login shell." Your login shell is the shell your computer starts for you, with your usual settings loaded.`
    New: `"What gets started, and in what environment. Leave the path blank to use your login shell." Your login shell is the shell your computer starts for you, with your usual settings loaded. On Windows the sentence ends "to use the default shell."`
  - `terminal.md:36`. Old: `- **Shell arguments**: "Space-separated. \`-l\` starts a login shell, so your real PATH and version managers work." On Windows, the default shell starts without \`-l\`, because PowerShell rejects it.`
    New: `- **Shell arguments**: "Space-separated. -l starts a login shell, so your real PATH and version managers work." On Windows it reads "Space-separated. While the path is blank, the default shell starts without -l, because PowerShell rejects it."`
  - `privacy.md:38`. Old: `- **Reveal crash reports** shows the folder where crash snapshots are kept on your computer, selected in Finder on macOS or File Explorer on Windows. On Linux it opens in your file manager.`
    New: `- **Reveal in Finder** (**Show in File Explorer** on Windows, **Show in file manager** on Linux) shows the folder where crash snapshots are kept on your computer.`
  - `voice.md:55`: no change ("**Open System Settings** takes you to the right page" is the macOS line).
  - `voice.md:56`. Old: `**Open System Settings** opens that page for you.` New: `**Open Settings** opens that page for you.`

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/platformCopy.ts src/renderer/src/components/TerminalView.tsx src/renderer/src/components/PrivacyView.tsx src/renderer/src/components/VoiceView.tsx tests/mod-key-copy.test.ts docs/guide/src/content/docs/terminal.md docs/guide/src/content/docs/privacy.md docs/guide/src/content/docs/voice.md
  git commit -s -F - <<'MSG'
  fix(docs-round #22): terminal, crash-report and microphone buttons use each OS's own words

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Terminal settings page (macOS):** Shell path reads "Blank uses your login shell ($SHELL)." with placeholder `$SHELL`. Shell arguments reads "Space-separated. -l starts a login shell, …" with no backticks.
- **Terminal settings page (Windows):** "Blank uses PowerShell 7, then Windows PowerShell, then the Command Prompt.", placeholder `pwsh.exe`, and the args hint names PowerShell. Absence: no `$SHELL` and no "login shell" anywhere in the Shell section.
- **Privacy page:** the button reads **Reveal in Finder** on macOS (**Show in File Explorer** on Windows) and opens the crash-reports folder with it selected.
- **Voice page (Windows, microphone denied in Settings → Privacy & security → Microphone):** the button reads **Open Settings** and opens that page. Absence: "Open System Settings" on Windows.
- **Regression to check:** type `/bin/bash` into Shell path and open a new terminal tab: it runs bash. Clear the field and open another: it runs the login shell again. Only the placeholder changed, not the value.

---

---

### Task 20c: Removing a plugin or an MCP server asks first (docs-round #24)

**Files:**
- Modify: `src/renderer/src/components/PluginsSection.tsx:26 (after), 271`
- Modify: `src/renderer/src/components/McpServersSection.tsx:21-23 (after statusKey), 226-230`
- Test: `tests/remove-confirm.test.ts` (new)
- Guide: `docs/guide/src/content/docs/plugins.md:65-68`, `docs/guide/src/content/docs/mcp.md:45`

**Interfaces:** Produces:
- `pluginRemoveMessage(p: { plugin: string; skills: string[]; commands: string[]; servers: string[] }): string` from `PluginsSection.tsx`
- `mcpRemoveMessage(s: { scope: "global" | "workspace"; name: string }): string` from `McpServersSection.tsx`

Task 2 edits other lines of `McpServersSection.tsx`.

- [ ] **Step 1: Write the failing test.** New `tests/remove-confirm.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pluginRemoveMessage } from "../src/renderer/src/components/PluginsSection";
import { mcpRemoveMessage } from "../src/renderer/src/components/McpServersSection";

/** docs-round #24. No DOM in this suite: the question is pinned as data, the order by source. */
const C = path.join(__dirname, "..", "src", "renderer", "src", "components");
const src = (f: string): string => fs.readFileSync(path.join(C, f), "utf8");

describe("Remove asks first, the way skill Delete does", () => {
  it("the plugin question names the plugin and everything that goes with it", () => {
    expect(pluginRemoveMessage({ plugin: "demo", skills: ["a", "b"], commands: ["c"], servers: ["s"] }))
      .toBe("Remove “demo”?\n\nThis deletes its 2 skills, 1 prompt and 1 MCP server. Open sessions restart once they're idle. You can install it again later.");
    expect(pluginRemoveMessage({ plugin: "x", skills: [], commands: [], servers: ["s", "t"] }))
      .toContain("This deletes its 2 MCP servers.");
  });

  it("the MCP question names the server and the file it leaves", () => {
    expect(mcpRemoveMessage({ scope: "global", name: "github" }))
      .toBe("Remove “github”?\n\nIt's taken out of your global mcp.json. Open sessions restart once they're idle.");
    expect(mcpRemoveMessage({ scope: "workspace", name: "db" })).toContain("this workspace's .mcp.json");
  });

  it("both Remove paths confirm BEFORE they act", () => {
    expect(src("SkillsSection.tsx")).toMatch(/if \(!window\.confirm\(msg\)\) return;/); // the pattern copied
    expect(src("PluginsSection.tsx")).toMatch(/onClick=\{\(\) => \{ if \(window\.confirm\(pluginRemoveMessage\(p\)\)\) remove\(p\.plugin\); \}\}/);
    expect(src("McpServersSection.tsx")).toMatch(
      /const remove = async \(s: McpServer\): Promise<void> => \{\s*if \(!window\.confirm\(mcpRemoveMessage\(s\)\)\) return;/,
    );
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**
  `L=/tmp/vitest.log; npx vitest run tests/remove-confirm.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
  Expected: `pluginRemoveMessage is not a function`.

- [ ] **Step 3: Implement**

`PluginsSection.tsx`, after `:26` (`const plural = …`), add:
```tsx
/** docs-round #24: Remove deletes files, so it asks first, the way skill Delete does (SkillsSection.tsx). */
export function pluginRemoveMessage(p: { plugin: string; skills: string[]; commands: string[]; servers: string[] }): string {
  const parts = [
    p.skills.length ? plural(p.skills.length, "skill") : null,
    p.commands.length ? plural(p.commands.length, "prompt") : null,
    p.servers.length ? plural(p.servers.length, "MCP server") : null,
  ].filter((x): x is string => x !== null);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Remove “${p.plugin}”?\n\nThis deletes its ${list}. Open sessions restart once they're idle. You can install it again later.`;
}
```
`PluginsSection.tsx:271`. Current:
```tsx
                  onClick={() => remove(p.plugin)}
```
Replacement:
```tsx
                  onClick={() => { if (window.confirm(pluginRemoveMessage(p))) remove(p.plugin); }}
```

`McpServersSection.tsx`, after `statusKey` (`:21-23`), add:
```tsx
/** docs-round #24: Remove asks first, the way skill Delete does (SkillsSection.tsx). */
export function mcpRemoveMessage(s: { scope: "global" | "workspace"; name: string }): string {
  const file = s.scope === "global" ? "your global mcp.json" : "this workspace's .mcp.json";
  return `Remove “${s.name}”?\n\nIt's taken out of ${file}. Open sessions restart once they're idle.`;
}
```
`McpServersSection.tsx:226-230`. Current:
```tsx
  const remove = async (s: McpServer): Promise<void> => {
    await window.hv.mcpSetServer(s.scope, s.scope === "workspace" ? workspaceId : null, s.name, null);
```
Replacement:
```tsx
  const remove = async (s: McpServer): Promise<void> => {
    if (!window.confirm(mcpRemoveMessage(s))) return;
    await window.hv.mcpSetServer(s.scope, s.scope === "workspace" ? workspaceId : null, s.name, null);
```
The editor's rename/scope-change path (`:543-545`) calls `mcpSetServer(…, null)` directly, not `remove`, so it still doesn't ask.

- [ ] **Step 4: Run it, expect PASS** (same command). Also `tests/plugin-sort.test.ts` (imports PluginsSection):
  `L=/tmp/vitest.log; npx vitest run tests/plugin-sort.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`

- [ ] **Step 5: Guide**
  - `plugins.md:65-68`. Old:
    ```
    1. Find it under **Installed**.
    2. Click **Remove**.

    HappyVibe removes every skill, prompt and MCP server that plugin brought, and nothing else. It happens right away, with no second check. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)). You can install it again any time.
    ```
    New:
    ```
    1. Find it under **Installed**.
    2. Click **Remove**.
    3. Confirm. HappyVibe asks first, "Remove “<name>”?", and says what goes with it, for example "This deletes its 2 skills, 1 prompt and 1 MCP server."

    HappyVibe removes every skill, prompt and MCP server that plugin brought, and nothing else. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)). You can install it again any time.
    ```
  - `mcp.md:45`. Old: `- **Remove**: take it off the list. It goes straight away, so the catalog card becomes clickable again.`
    New: `- **Remove**: take it off the list, after you confirm. The catalog card becomes clickable again.`

- [ ] **Step 6: Commit**
  ```bash
  git add src/renderer/src/components/PluginsSection.tsx src/renderer/src/components/McpServersSection.tsx tests/remove-confirm.test.ts docs/guide/src/content/docs/plugins.md docs/guide/src/content/docs/mcp.md
  git commit -s -F - <<'MSG'
  fix(docs-round #24): removing a plugin or an MCP server asks first

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
  MSG
  ```

**GUI assertions**
- **Plugins page:** **Remove** on an installed plugin opens a dialog reading "Remove “<plugin>”?" and naming its counts. **Cancel** keeps the plugin under Installed, and its skills are still on the **Skills** page. Absence: no "Removing…" and no session reload after Cancel.
- **Plugins page:** OK removes it. The Skills and Prompts pages no longer list its items, and the MCP page no longer lists its servers.
- **MCP page:** **Remove** opens "Remove “<server>”?" naming the file. Cancel keeps the row (and its sign-in: **Log out** still shows on a connected remote server). OK removes it, and its catalog card becomes clickable again.
- **Regression to check:** on the MCP page, **Edit** a server, change its name and **Save**. No confirmation appears, the old row is gone and the renamed row is there.

---

### Task 21: Whole-branch verification

**Files:**
- Modify: `docs/validation/docs-round.md` (status line: each item marked fixed, with its commit)
- Create: `.env` symlink (not committed; `.env` is gitignored)

- [ ] **Step 1: Gate.**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Expected: `EXIT=0`. `build` runs all three typechecks first. A `noUnusedLocals` failure here usually means a task emptied a `MOD` import without deleting it (Task 8).

- [ ] **Step 2: Live batch.** This branch changes `pi-runtime/extensions/` (Tasks 1, 3, 4, 10a), so it is required.

```bash
npm run live:why
```

Expected: prints at least `pi-runtime/extensions/happyvibe-bridge.ts` and `pi-runtime/extensions/hv-mcp.ts`. Then:

```bash
pgrep -fl "npm run dev"            # must print nothing: a running app is a third provider consumer
ln -s ~/Documents/Github/HappyVibe/.env .env
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"; tail -40 $L
```

Run it with `run_in_background`, and touch nothing under `src/` or `pi-runtime/` while it runs.

Expected: `EXIT=0` in about 7–8 minutes. A run that finishes in seconds means `.env` didn't link and everything skipped, so it proves nothing. Before believing a red:
1. Check that no dev server is running.
2. Check the account has balance (a `402` looks like a regression).
3. Rerun that one file alone.

The files that carry this branch's live cases: `tests/mcp-bridge.test.ts` (Task 1: an install asks, Deny, no `mcp.json` written), `tests/tw-child-prompt-bridge.test.ts` (Task 3) and `tests/tw-child-guard-bridge.test.ts` (the sub-agent audit pipe Task 10a extends; the new `bypass` field itself is pinned key-free in `tests/audit-filters.test.ts`).

- [ ] **Step 3: Guide build and review.**

```bash
(cd docs/guide && npm run build) > /tmp/guide.log 2>&1; echo "EXIT=$?"; tail -15 /tmp/guide.log
git diff --name-only main...HEAD -- docs/guide/src/content/docs/
```

Expected: `EXIT=0`. Run the `docs-reviewer` agent on every page the second command lists, and fix each finding in a follow-up commit (`docs(docs-round): reviewer fixes`).

- [ ] **Step 4: GUI pass.** Launch with `/devdoctor`, then `/uicheck` against the running app, after checking that no agent turn is running in the user's own app. Walk every task's **GUI assertions** block in task order, and record each assertion as seen or failed, with a screenshot for each page. These cannot be checked without the app:

  | Task | Check | Where |
  |---|---|---|
  | 1 | The agent asking to install an MCP server raises a dialog whose headline names the URL and the target. After **Deny**, the MCP page lists no new server. | a session, then **MCP** |
  | 2 | After a plugin install, its server shows **off** on the MCP page, and the agent's `mcp({})` server list doesn't name it. **Connect** turns it on, and the list names it after the session restarts. | **Plugins**, **MCP**, a session |
  | 3 | A sub-agent's own prompt title reads "Sub-agent worker wants to run something", with **no** model-written task text. | a session delegating to a sub-agent |
  | 4 | With bypass on, a **new** session and a **restarted** session both show the red banner. | a session |
  | 6 | A paste of two lines asks, by keyboard **and** by right-click (with right-click paste enabled). A single line never asks. | a terminal tab and the agent terminal card |
  | 8 | On Windows and Linux (the `win1.md`/`lin1.md` machines), the tooltips read "Ctrl+K", never "CtrlK". After rebinding Find a session, its tooltip shows the new keys. | sidebar, file tab, terminal exit bar |
  | 15 | Forgetting a workspace mid-turn stops its Pi process, and re-adding the folder restores its sessions unarchived. | sidebar |

  The Windows and Linux rows need those machines. If they aren't available, say so in the round's close-out instead of marking the checks passed.

- [ ] **Step 5: Close out the spec.** In `docs/validation/docs-round.md`, change the intro's status to "**Fixed 2026-MM-DD** on `guiguito/fixes`", with each item's commit hash after its number (`git log --oneline main..HEAD`). Record any GUI assertion that failed, or couldn't be run, under a new `## Open after the fix round` heading, instead of deleting it.

```bash
git add docs/validation/docs-round.md
git commit -s -F - <<'MSG'
docs(docs-round): mark the round fixed, with commits and open checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LVLqgXXjrZ35V6zfXoNauT
MSG
```

- [ ] **Step 6: Stop for `/land`.** Don't push or open a PR from this plan. `/land` owns the hygiene gate, the commit audit and the PR.
