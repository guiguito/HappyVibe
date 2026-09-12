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

/**
 * §12 FR4 — the child guard rides the PI_SUBAGENT_PI_BINARY wrapper.
 *
 * This is the one injection point a capability ceiling's `denyExtensions` cannot
 * strip, because the wrapper runs after pi-args has finished building argv. If
 * any of these regress, children run with no HappyVibe permission gate at all —
 * and that failure is silent from the app's side, which is why it is pinned here
 * rather than left to the live batch.
 */
test("the wrapper injects the child guard BEFORE the positional task", () => {
  const sh = fs.readFileSync(path.join(runtime, "bin", "pi-node.sh"), "utf8");
  const execs = sh.split("\n").filter((l) => l.includes("exec ") && l.includes("$CLI"));
  expect(execs.length, "both the packaged and the dev exec paths").toBe(2);
  for (const line of execs) {
    expect(line, "guard is passed").toContain('--extension "$GUARD"');
    // pi-args appends the task as a trailing positional (`Task: …` or `@file`),
    // so the flag must precede "$@" — a flag after a positional is not something
    // to bet the permission gate on.
    expect(line.indexOf('--extension "$GUARD"'), line).toBeLessThan(line.indexOf('"$@"'));
  }
});

test("the guard file the wrapper names actually exists in the vendored tree", () => {
  // The same class of check as the owner-seed test above: a wrapper naming a
  // missing extension would leave children ungated.
  expect(fs.existsSync(path.join(runtime, "extensions", "hv-child-guard.ts"))).toBe(true);
});

test("GUARD resolves under the runtime dir, so a packaged app finds it too", () => {
  const sh = fs.readFileSync(path.join(runtime, "bin", "pi-node.sh"), "utf8");
  expect(sh).toMatch(/GUARD="\$RUNTIME\/extensions\/hv-child-guard\.ts"/);
});

test("upstream still passes wrapper argv through untouched", () => {
  // getPiSpawnCommand returning `args` unchanged is what makes prepending safe.
  // If a bump ever rewrites argv here, the guard could be dropped or reordered.
  const src = fs.readFileSync(
    path.join(runtime, "node_modules", "pi-subagents", "src", "runs", "shared", "pi-spawn.ts"), "utf8");
  expect(src).toContain("return { command: piBinary, args }");
});

test("the child audit dir is passed only when asked for, and reaches the child's env", () => {
  const plain = resolvePiSpawn("/ws", "/sess", runtime, {});
  expect(plain.env.HV_CHILD_AUDIT_DIR).toBeUndefined();
  const withDir = resolvePiSpawn("/ws", "/sess", runtime, { childAuditDir: "/tmp/hv-audit" });
  expect(withDir.env.HV_CHILD_AUDIT_DIR).toBe("/tmp/hv-audit");
});

/**
 * §35: a read-only scheduled run is clamped by the ENVIRONMENT, not by anything
 * inside the session — so this is the only place the clamp can be switched on,
 * and an absent flag must mean an ordinary session rather than a quiet default.
 */
test("HV_READONLY=1 only for a read-only scheduled run", () => {
  expect(resolvePiSpawn("/ws", "/sessions", runtime).env.HV_READONLY).toBeUndefined();
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { readonly: false }).env.HV_READONLY).toBeUndefined();
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { readonly: true }).env.HV_READONLY).toBe("1");
});
