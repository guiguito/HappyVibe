import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { resolvePiSpawn, PI_MCP_ADAPTER_RELPATH, PI_SUBAGENTS_RELPATH } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

const extensionArgs = (args: string[]): string[] => args.filter((_, i) => args[i - 1] === "-e");

// The gate must be LAST. Pi dispatches tool_call handlers in extension load
// order and `event.input` is mutable — "Later tool_call handlers see earlier
// mutations. No re-validation is performed after mutation."
// (pi-coding-agent dist/core/extensions/types.d.ts:678). A gate that ran before
// a mutating handler would prompt with the args we display and execute others,
// so the permission prompt could no longer be trusted to describe what runs.
test("the bridge is the LAST -e extension, so the permission gate sees final tool input", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime);
  expect(extensionArgs(spec.args)).toEqual([
    path.join(runtime, "extensions/hv-owner-seed.ts"),
    path.join(runtime, PI_SUBAGENTS_RELPATH),
    path.join(runtime, PI_MCP_ADAPTER_RELPATH),
    path.join(runtime, "extensions/happyvibe-bridge.ts"),
  ]);
});

// The seed only works if it runs BEFORE pi-subagents registers, because that is
// when the completion-owner id is minted (its index.ts, `completionOwnerId:
// currentCompletionOwnerId()`) and Pi loads -e extensions strictly sequentially
// in argv order — import + factory, one at a time (core/extensions/loader.js).
// Note the invariant above is that the GATE is last, not that nothing precedes
// it: the seed registers no tools and no tool_call handler, so it cannot change
// what the gate sees. See pi-runtime/extensions/hv-owner-seed.ts.
test("the owner seed precedes pi-subagents, the only ordering that can work", () => {
  const e = extensionArgs(resolvePiSpawn("/ws", "/sessions", runtime).args);
  expect(e.indexOf(path.join(runtime, "extensions/hv-owner-seed.ts")))
    .toBeLessThan(e.indexOf(path.join(runtime, PI_SUBAGENTS_RELPATH)));
});

test("the seed file the spawn names actually exists in the vendored tree", () => {
  // A missing -e path is a per-session load error, and the seed is the one
  // extension whose absence is silent: delegations still work, they just stop
  // surviving a respawn.
  expect(fs.existsSync(path.join(runtime, "extensions/hv-owner-seed.ts"))).toBe(true);
});

// A session with no id is the utility client ($HOME, no workspace, no session) —
// it never delegates, so it gets no claim and upstream mints its own id. Fail open.
test("no session id means no owner claim", () => {
  expect(resolvePiSpawn("/ws", "/sessions", runtime).env.HV_SUBAGENT_OWNER).toBeUndefined();
});

test("a session id becomes an owner claim that is stable across respawn", () => {
  const first = resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "abc-123" });
  expect(first.env.HV_SUBAGENT_OWNER).toBe("hv-abc-123");
  // Stability IS the requirement: the same session resumed must claim the same
  // id, or the respawned parent is refused its own child's result.
  const resumed = resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "abc-123", resumeFile: "/sessions/abc-123.jsonl" });
  expect(resumed.env.HV_SUBAGENT_OWNER).toBe(first.env.HV_SUBAGENT_OWNER);
  // And two different sessions must NOT share one, or they would answer for each
  // other's children — the thing #1225 exists to prevent.
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "def-456" }).env.HV_SUBAGENT_OWNER)
    .not.toBe(first.env.HV_SUBAGENT_OWNER);
});

test("pinned adapter entry file exists in the vendored tree", () => {
  expect(fs.existsSync(path.join(runtime, PI_MCP_ADAPTER_RELPATH))).toBe(true);
});
