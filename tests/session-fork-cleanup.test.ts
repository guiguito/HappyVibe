// Unit: a failed fork must not leave the intermediate full copy behind (no Pi boot).
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forkSessionFile } from "../src/main/sessionFork";

const fake = (copy: string, cancelled: boolean) => () => ({
  start: async () => {},
  stop: () => {},
  send: async (cmd: { type: string }) => ({ data: cmd.type === "fork" ? { cancelled } : { sessionFile: copy } }),
}) as never;

test("cancelled fork: error thrown and the intermediate copy deleted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-forkclean-"));
  const copy = path.join(dir, "copy.jsonl");
  fs.writeFileSync(copy, "{}\n");
  await expect(forkSessionFile({} as never, dir, "e1", fake(copy, true))).rejects.toThrow("Pi cancelled the fork.");
  expect(fs.existsSync(copy)).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("duplicate keeps the copy it returns", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-forkclean-"));
  const copy = path.join(dir, "copy.jsonl");
  fs.writeFileSync(copy, "{}\n");
  expect(await forkSessionFile({} as never, dir, undefined, fake(copy, false))).toBe(copy);
  expect(fs.existsSync(copy)).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});
