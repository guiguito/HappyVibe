import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceRegistry } from "../src/main/store";

const registry = (): WorkspaceRegistry =>
  new WorkspaceRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdstore-")), "workspaces.json"));

test("stores only explicit command-activation overrides, and null clears them", () => {
  const reg = registry();
  reg.add("/ws");
  expect(reg.getCommandsActive("/ws")).toEqual({});

  reg.setCommandActive("/ws", "/ws/.agents/prompts/a.md", false);
  reg.setCommandActive("/ws", "/ws/.agents/prompts/b.md", true);
  expect(reg.getCommandsActive("/ws")).toEqual({
    "/ws/.agents/prompts/a.md": false,
    "/ws/.agents/prompts/b.md": true,
  });

  reg.setCommandActive("/ws", "/ws/.agents/prompts/a.md", null);
  expect(reg.getCommandsActive("/ws")).toEqual({ "/ws/.agents/prompts/b.md": true });
});

test("an emptied override map is dropped from the entry, not left as {}", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdstore-")), "workspaces.json");
  const reg = new WorkspaceRegistry(file);
  reg.add("/ws");
  reg.setCommandActive("/ws", "/x.md", false);
  reg.setCommandActive("/ws", "/x.md", null);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))[0]).toEqual({ path: "/ws" });
});

// V2.A: workspace paths are dialog-provided strings; the setModel normalization
// bug bit this repo before — a "/ws/" write must hit the "/ws" entry.
test("a trailing-slash workspace path hits the same entry", () => {
  const reg = registry();
  reg.add("/ws");
  reg.setCommandActive("/ws/", "/x.md", false);
  expect(reg.getCommandsActive("/ws")).toEqual({ "/x.md": false });
  expect(reg.getCommandsActive("/ws/")).toEqual({ "/x.md": false });
});

test("commands and skills activation are independent maps", () => {
  const reg = registry();
  reg.add("/ws");
  reg.setSkillActive("/ws", "/skills/pdf", false);
  reg.setCommandActive("/ws", "/x.md", true);
  expect(reg.getSkillsActive("/ws")).toEqual({ "/skills/pdf": false });
  expect(reg.getCommandsActive("/ws")).toEqual({ "/x.md": true });
});

test("setting on an unknown workspace is a no-op", () => {
  const reg = registry();
  reg.setCommandActive("/nope", "/x.md", true);
  expect(reg.getCommandsActive("/nope")).toEqual({});
});
