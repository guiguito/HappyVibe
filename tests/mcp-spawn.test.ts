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
