import { expect, test } from "vitest";
import fs from "node:fs";
import { withCompaction } from "../src/main/subagentSettings";

test("withCompaction sets compaction.enabled and keeps every other key", () => {
  const s = { agentOverrides: { x: { enabled: false } }, compaction: { reserveTokens: 9000 } };
  expect(withCompaction(s, false)).toEqual({ agentOverrides: { x: { enabled: false } }, compaction: { reserveTokens: 9000, enabled: false } });
  expect(withCompaction({}, true)).toEqual({ compaction: { enabled: true } });
});

test("the switch is applied live to every running session", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const h = ipc.slice(ipc.indexOf('"hv:set-auto-compaction"'), ipc.indexOf('"hv:set-auto-compaction"') + 600);
  expect(h).toContain('type: "set_auto_compaction"');
  expect(h).toContain("writePiCompactionSetting()");
});
