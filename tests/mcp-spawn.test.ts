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
    path.join(runtime, PI_SUBAGENTS_RELPATH),
    path.join(runtime, PI_MCP_ADAPTER_RELPATH),
    path.join(runtime, "extensions/happyvibe-bridge.ts"),
  ]);
});

test("pinned adapter entry file exists in the vendored tree", () => {
  expect(fs.existsSync(path.join(runtime, PI_MCP_ADAPTER_RELPATH))).toBe(true);
});
