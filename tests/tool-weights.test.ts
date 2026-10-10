// The weights the kit and Built-in tools show are measured, never typed (PRD §13, §22
// Decision 2026-10-09). This boots ONE all-on key-free Pi and fails when the file is stale.
import { expect, test } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TOOL_WEIGHTS } from "../src/main/toolWeights.generated";
import { measure, piVersion, RUNTIME } from "../tools/tool-weights/measure";

const near = (a: number, b: number, pct: number): boolean => Math.abs(a - b) <= Math.max(10, (b * pct) / 100);
const STALE = "stale — run `npm run catalog:tool-weights`";

test("the weights file matches the pinned Pi", async () => {
  expect(TOOL_WEIGHTS.pi, STALE).toBe(piVersion());
  const pi = await import(pathToFileURL(path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
  expect(TOOL_WEIGHTS.compactionReserve, STALE).toBe(pi.DEFAULT_COMPACTION_SETTINGS.reserveTokens);
});

test("an all-on session still declares the tools, sizes and total the file says", async () => {
  const m = await measure();
  const shells = new Set(["bash", "powershell"]);
  const names = (o: Record<string, number>): string[] => Object.keys(o).filter((n) => !shells.has(n)).sort();
  // A tool added or removed anywhere (bridge, Pi, tintinweb) changes this list.
  expect(names(m.toolChars), STALE).toEqual(names(TOOL_WEIGHTS.tools));
  for (const [name, chars] of Object.entries(TOOL_WEIGHTS.tools)) {
    if (name in m.toolChars) expect(near(m.toolChars[name], chars, 2), `${name}: ${STALE}`).toBe(true);
  }
  // Absolute total carries cwd/install paths, which differ by machine.
  expect(near(Math.round(m.totalChars / 4), TOOL_WEIGHTS.total, 3), `total: ${STALE}`).toBe(true);
}, 90_000);

test("MCP with no server weighs nothing — why it is not a kit tile", () => {
  expect(TOOL_WEIGHTS.families.mcp).toBe(0);
});
