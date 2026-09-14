import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { CONFINED_WRITE_TOOLS, escapesWorkspace } from "../pi-runtime/extensions/hv-child-guard";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * CONTRACT TEST — PRD §12, key-free.
 *
 * A sub-agent's work belongs in the workspace, and nothing enforced that.
 * `childDecision` matches on the TOOL NAME only, so a rule of
 * `{layer:"tool", pattern:"write", action:"allow"}` reached the entire
 * filesystem. Structural, and older than any pin — but 0.63's macOS task file
 * is what made a child actually exercise it: once the child could read
 * its task out of a `pi-subagent-<rand>` tempdir, the model began writing its
 * OUTPUT next to the task instead of into the workspace, and the user's file
 * was simply not there. Measured on tests/child-guard-bridge.test.ts:
 *
 *   13 runs before the read exemption — every write relative or in-workspace
 *    6 runs after                     — two landed in the tempdir
 *
 * The audit row said `allow` both times, which is the shape this whole layer
 * exists to prevent: a decision that reads fine and a file that is elsewhere.
 */

const TOOLS = path.join(
  __dirname,
  "..",
  "pi-runtime",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "tools",
);
const src = (f: string) => fs.readFileSync(path.join(TOOLS, f), "utf8");

const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-confine-ws-")));
const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-confine-out-")));
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

import { CAN_SYMLINK } from "./canSymlink";

describe("a child write is confined to the workspace", () => {
  it("allows a relative path — the common case, and what passed all along", () => {
    expect(escapesWorkspace("write", { path: "ok.txt" }, ws)).toBeUndefined();
    expect(escapesWorkspace("write", { path: "src/deep/ok.txt" }, ws)).toBeUndefined();
    expect(escapesWorkspace("write", { path: "./ok.txt" }, ws)).toBeUndefined();
  });

  it("allows an absolute path inside the workspace, and the root itself", () => {
    expect(escapesWorkspace("write", { path: path.join(ws, "ok.txt") }, ws)).toBeUndefined();
    expect(escapesWorkspace("write", { path: ws }, ws)).toBeUndefined();
  });

  it("REFUSES the tempdir write that this test exists for", () => {
    const tempTask = path.join(os.tmpdir(), "pi-subagent-TDh4HY", "ok.txt");
    expect(escapesWorkspace("write", { path: tempTask }, ws)).toBeTruthy();
  });

  it("refuses `..` traversal, however deep", () => {
    expect(escapesWorkspace("write", { path: "../ok.txt" }, ws)).toBeTruthy();
    expect(escapesWorkspace("write", { path: "src/../../ok.txt" }, ws)).toBeTruthy();
    expect(escapesWorkspace("write", { path: "/etc/hosts" }, ws)).toBeTruthy();
  });

  it("refuses a SIBLING whose name merely starts with the workspace's", () => {
    // The reason the check is `=== root || startsWith(root + sep)` and never a
    // bare startsWith: /tmp/ws-evil must not read as inside /tmp/ws.
    const sibling = `${ws}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    try {
      expect(escapesWorkspace("write", { path: path.join(sibling, "ok.txt") }, ws)).toBeTruthy();
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it.skipIf(!CAN_SYMLINK)("refuses a SYMLINK planted inside the workspace that points out of it", () => { // symlink fixture needs elevation on Windows
    // A string-only check passes this: the path looks like it is under ws.
    const link = path.join(ws, "escape");
    fs.symlinkSync(outside, link, "dir");
    try {
      expect(escapesWorkspace("write", { path: "escape/ok.txt" }, ws)).toBeTruthy();
      expect(escapesWorkspace("write", { path: path.join(link, "ok.txt") }, ws)).toBeTruthy();
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it.skipIf(!CAN_SYMLINK)("resolves through links for a path that does not exist yet", () => { // symlink fixture needs elevation on Windows
    // The file being written is by definition usually absent, so the resolution
    // has to work off the nearest EXISTING ancestor.
    const link = path.join(ws, "escape2");
    fs.symlinkSync(outside, link, "dir");
    try {
      expect(escapesWorkspace("write", { path: "escape2/a/b/c/new.txt" }, ws)).toBeTruthy();
      expect(escapesWorkspace("write", { path: "real/a/b/c/new.txt" }, ws)).toBeUndefined();
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it("ALLOWS pi-subagents' own per-run artifacts dir when spawn.ts hands it over", () => {
    // Upstream calls this path "authoritative for this run. Ignore any other
    // output path", and it is outside the workspace by design. Measured in the
    // running app: without the exemption the child's write was DENIED and it
    // burned a turn recovering. Main creates and sweeps this location, so it is
    // app state, not somewhere the agent chose.
    const artifacts = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-confine-art-")));
    try {
      const out = path.join(artifacts, "outputs", "run-1", "context.md");
      expect(escapesWorkspace("write", { path: out }, ws, [artifacts])).toBeUndefined();
      // …and only that subtree. A sibling of it is still outside.
      expect(escapesWorkspace("write", { path: `${artifacts}-evil/x.md` }, ws, [artifacts])).toBeTruthy();
      // Unset ⇒ no exemption. Absent config must fail SAFE, i.e. stay confined.
      expect(escapesWorkspace("write", { path: out }, ws, [])).toBeTruthy();
      expect(escapesWorkspace("write", { path: out }, ws)).toBeTruthy();
      // Junk roots are ignored rather than widening anything.
      expect(escapesWorkspace("write", { path: out }, ws, ["", undefined as unknown as string])).toBeTruthy();
    } finally {
      fs.rmSync(artifacts, { recursive: true, force: true });
    }
  });

  it("still refuses the TASK tempdir even with the artifacts root allowed", () => {
    // The two exemptions must not blur: the task dir is readable, never writable.
    const artifacts = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hv-confine-art2-")));
    try {
      const temp = path.join(os.tmpdir(), "pi-subagent-TDh4HY", "ok.txt");
      expect(escapesWorkspace("write", { path: temp }, ws, [artifacts])).toBeTruthy();
    } finally {
      fs.rmSync(artifacts, { recursive: true, force: true });
    }
  });

  it("covers edit exactly like write", () => {
    expect(escapesWorkspace("edit", { path: "ok.txt", edits: [] }, ws)).toBeUndefined();
    expect(escapesWorkspace("edit", { path: "/etc/hosts", edits: [] }, ws)).toBeTruthy();
  });

  it("leaves other tools alone — including read, or the task file breaks again", () => {
    const tempTask = path.join(os.tmpdir(), "pi-subagent-TDh4HY", "task.md");
    expect(escapesWorkspace("read", { path: tempTask }, ws)).toBeUndefined();
    expect(escapesWorkspace("ls", { path: "/etc" }, ws)).toBeUndefined();
    // bash CANNOT be path-confined — a documented limit of the gate, not an
    // omission. It is absent from the set on purpose.
    expect(escapesWorkspace("bash", { command: "echo hi > /etc/x" }, ws)).toBeUndefined();
    expect(CONFINED_WRITE_TOOLS.has("bash")).toBe(false);
  });

  it("leaves a malformed path to Pi rather than inventing a verdict", () => {
    for (const bad of [{}, { path: "" }, { path: 42 }, { path: null }, { path: ["a"] }]) {
      expect(escapesWorkspace("write", bad as Record<string, unknown>, ws)).toBeUndefined();
    }
  });
});

describe("the confined set is derived from Pi's own tool schemas", () => {
  it("write and edit both declare a string `path`", () => {
    for (const f of ["write.js", "edit.js"]) {
      expect(src(f), `${f} should declare path`).toMatch(/path:\s*Type\.String\(/);
    }
    expect([...CONFINED_WRITE_TOOLS].sort()).toEqual(["edit", "write"]);
  });

  it("and no OTHER builtin writer takes a path we are failing to confine", () => {
    // If a future Pi adds a path-taking fs writer, it must be added to the set
    // or land outside the workspace unchecked. Non-writers are listed so the
    // reason each one is excluded is visible rather than assumed.
    const nonWriters = new Set(["read.js", "ls.js", "grep.js", "find.js"]);
    const writers = fs
      .readdirSync(TOOLS)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".map"))
      .filter((f) => !nonWriters.has(f))
      .filter((f) => /path:\s*Type\.String\(/.test(src(f)))
      .map((f) => f.replace(/\.js$/, ""));
    expect(writers.sort()).toEqual([...CONFINED_WRITE_TOOLS].sort());
  });
});

describe("spawn.ts hands the artifacts root to the guard", () => {
  it("sets HV_ARTIFACTS_DIR under the session dir, where upstream actually writes", () => {
    // Observed on a real delegation:
    //   <sessionDir>/subagent-artifacts/outputs/<runId>/context.md
    // so the root has to be <sessionDir>/subagent-artifacts and nothing shorter —
    // handing over the sessionDir itself would exempt every session file too.
    const spec = resolvePiSpawn("/ws", "/sessions", path.join(__dirname, "..", "pi-runtime"), {});
    expect(spec.env?.HV_ARTIFACTS_DIR).toBe(path.join("/sessions", "subagent-artifacts"));
  });

  it("is always set, so the exemption never depends on an optional flag", () => {
    const spec = resolvePiSpawn("/ws", "/sessions", path.join(__dirname, "..", "pi-runtime"), { bypass: true });
    expect(spec.env?.HV_ARTIFACTS_DIR).toBeTruthy();
  });
});
