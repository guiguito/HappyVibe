/**
 * PRD §33 — the spawn seam. The ABSENCE assertions are the point: an absent
 * HV_MEMORY_WORKSPACE_DIR is how "workspace memory is off here" reaches the bridge, and an
 * absent HV_MEMORY_GLOBAL_DIR is how "memory is off" does.
 */
import { expect, test } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");
const ON = { plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, web: true, document: true, memory: true, memoryAppend: "" };

test("both dirs present ⇒ both env keys", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, {
    memoryGlobalDir: "/ad/memory",
    memoryWorkspaceDir: "/ad/memory/workspaces/abc123",
  });
  expect(spec.env.HV_MEMORY_GLOBAL_DIR).toBe("/ad/memory");
  expect(spec.env.HV_MEMORY_WORKSPACE_DIR).toBe("/ad/memory/workspaces/abc123");
});

test("workspace memory off ⇒ HV_MEMORY_WORKSPACE_DIR is ABSENT, not empty", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { memoryGlobalDir: "/ad/memory" });
  expect(spec.env.HV_MEMORY_GLOBAL_DIR).toBe("/ad/memory");
  expect("HV_MEMORY_WORKSPACE_DIR" in spec.env).toBe(false);
});

test("memory off ⇒ neither key (the utility client's shape too)", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, {});
  expect("HV_MEMORY_GLOBAL_DIR" in spec.env).toBe(false);
  expect("HV_MEMORY_WORKSPACE_DIR" in spec.env).toBe(false);
});

test("HV_BUILTINS carries memory and memoryAppend EXPLICITLY", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, {
    builtinTools: { ...ON, memory: false, memoryAppend: "never save food" },
  });
  const b = JSON.parse(spec.env.HV_BUILTINS!) as Record<string, unknown>;
  expect(b.memory).toBe(false);
  expect(b.memoryAppend).toBe("never save food");
  // the neighbours are untouched — this is the "a new toggle that is not listed never reaches
  // the bridge" rule working in the other direction
  expect(b.document).toBe(true);
  expect(b.web).toBe(true);
});

test("the default builtins object carries memory: true", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { builtinTools: ON });
  expect(JSON.parse(spec.env.HV_BUILTINS!).memory).toBe(true);
});
