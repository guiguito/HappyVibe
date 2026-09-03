import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceFolder } from "../src/main/files";

/**
 * §22 onboarding round (2026-09-01) — the "Start fresh…" door.
 *
 * The north-star persona has no repo, so first run has to be able to make one.
 * `name` is a single path SEGMENT rather than a path, which is what makes this
 * safe without a registry to confine against: nothing here can resolve outside
 * `parent`. A rejected name is an error the user reads — never a name quietly
 * sanitised into a folder they did not ask for.
 */

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "hv-fresh-"));

describe("createWorkspaceFolder", () => {
  it("creates the folder under the given parent and returns its path", () => {
    const parent = tmp();
    const p = createWorkspaceFolder("my first vibe", parent);
    expect(p).toBe(path.join(parent, "my first vibe"));
    expect(fs.statSync(p).isDirectory()).toBe(true);
  });

  it("creates the parent on demand — a fresh Mac has no ~/Documents/HappyVibe", () => {
    const parent = path.join(tmp(), "HappyVibe");
    expect(fs.existsSync(createWorkspaceFolder("x", parent))).toBe(true);
  });

  it("trims, so a trailing space cannot make two folders that look identical", () => {
    const parent = tmp();
    expect(createWorkspaceFolder("  spaced  ", parent)).toBe(path.join(parent, "spaced"));
  });

  it("refuses a name that could escape the parent", () => {
    const parent = tmp();
    for (const bad of ["../evil", "a/b", "/abs", "", "   ", ".", "..", "a\\b"]) {
      expect(() => createWorkspaceFolder(bad, parent), JSON.stringify(bad)).toThrow();
    }
    // Nothing was created on the way to those refusals.
    expect(fs.readdirSync(parent)).toEqual([]);
  });

  it("refuses to take over an existing folder", () => {
    const parent = tmp();
    createWorkspaceFolder("dup", parent);
    expect(() => createWorkspaceFolder("dup", parent)).toThrow(/already/i);
  });

  it("defaults to ~/Documents/HappyVibe", () => {
    // The default is the locked decision, so it is asserted rather than trusted.
    const src = fs.readFileSync(path.resolve(__dirname, "../src/main/files.ts"), "utf8");
    expect(src.includes('path.join(os.homedir(), "Documents", "HappyVibe")')).toBe(true);
  });
});

describe("the hv:create-workspace-folder handler", () => {
  const IPC = fs.readFileSync(path.resolve(__dirname, "../src/main/ipc.ts"), "utf8");

  it("registers the new folder as a workspace, or the door creates an orphan", () => {
    const i = IPC.indexOf('ipcMain.handle("hv:create-workspace-folder"');
    expect(i, "handler exists").toBeGreaterThan(-1);
    const body = IPC.slice(i, i + 400);
    expect(body.includes("createWorkspaceFolder("), "calls the confined creator").toBe(true);
    expect(body.includes("workspaces.add("), "registers it").toBe(true);
  });
});
