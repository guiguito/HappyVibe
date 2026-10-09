import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sessionCalls } from "../src/main/sessionLedger";

// §17 round 28: a fork's file starts with a copy of the original's history. Those calls were billed
// to the original; the fork's own spend is only what comes after `forkedFrom.at`.
test("sessionCalls(since) drops the inherited calls and keeps a non-fork whole", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ledger-fork-"));
  const base = fs.readFileSync(path.join(__dirname, "fixtures", "pi-session.jsonl"), "utf8").trimEnd().split("\n");
  const assistant = JSON.parse(base.find((l) => l.includes('"role":"assistant"'))!);
  assistant.message.timestamp += 60_000;
  const file = path.join(dir, "fork.jsonl");
  fs.writeFileSync(file, [...base, JSON.stringify(assistant)].join("\n") + "\n");

  const all = sessionCalls(dir, file, new Set())!;
  expect(all).toHaveLength(2);
  const cut = sessionCalls(dir, file, new Set(), undefined, all[0].ts)!;
  expect(cut.map((c) => c.ts)).toEqual([all[1].ts]);
  expect(sessionCalls(dir, file, new Set(), undefined, undefined)).toHaveLength(2);
});
