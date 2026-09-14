import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { isOwnTaskRead, taskFileFromArgv } from "../pi-runtime/extensions/hv-child-guard";

/**
 * CONTRACT TEST — part of the Pi pin-bump gate, key-free.
 *
 * pi-subagents 0.63.0 (#1793, "keep macOS subagent tasks out of argv by
 * delivering them through temporary files") added one clause to
 * `shouldDeliverTaskViaFile`:
 *
 *   0.58.0: delivery === "file" ||                          task.length > TASK_ARG_LIMIT
 *   0.64.0: delivery === "file" || platform === "darwin" || task.length > TASK_ARG_LIMIT
 *
 * That flipped the task file from a >8,000-char rarity to EVERY delegation on
 * macOS — HappyVibe's own platform. The file sits outside the workspace, so the
 * parent's rules resolve a read of it to `ask`, and `ask` means deny inside the
 * child guard: the child was refused its own instructions and did nothing,
 * while the audit row looked like an agent snooping a temp file. It surfaced
 * only when the model called `read` on the literal rather than Pi expanding the
 * `@` itself, so it failed 2 runs in 3 — intermittent, which is worse than
 * always.
 *
 * There is no opt-out: `SubagentTaskDelivery` is `"auto" | "file"` and there is
 * no `"argv"` value, so on darwin `auto` resolves to file. Hence the exemption
 * in hv-child-guard.ts, and hence this test in two halves:
 *   1. the exemption is exactly one path and cannot be widened by shape;
 *   2. upstream still delivers the way we read it — DERIVED from the vendored
 *      source, so a change in the positional's shape fails here rather than
 *      silently disarming the exemption (which would restore the original bug).
 */

const SUBAGENTS = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents");
const ARGS_SRC = fs.readFileSync(path.join(SUBAGENTS, "src", "runs", "shared", "pi-args.ts"), "utf8");

// The measured argv of a real child (child-guard-bridge, pi-subagents 0.64.0),
// trimmed to the parts that matter.
const REAL_ARGV = [
  "/usr/bin/node",
  "/repo/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  "--extension",
  "/repo/pi-runtime/extensions/hv-child-guard.ts",
  "--mode",
  "json",
  "-p",
  "--tools",
  "read,write",
  "--no-extensions",
  "--system-prompt",
  "/var/folders/xx/T/pi-subagent-ltj8yX/writer.md",
  "@/var/folders/xx/T/pi-subagent-ltj8yX/task.md",
];
const TASK = path.resolve("/var/folders/xx/T/pi-subagent-ltj8yX/task.md");

describe("the child's own task file is read from argv, never matched by shape", () => {
  it("finds the trailing @<abs path> positional", () => {
    expect(taskFileFromArgv(REAL_ARGV)).toBe(TASK);
  });

  it("is undefined when there is no positional — the exemption must never arm blind", () => {
    // 0.58's argv shape: the task was `Task: …`, a plain positional.
    expect(taskFileFromArgv(["/usr/bin/node", "cli.js", "-p", "Task: do the thing"])).toBeUndefined();
    expect(taskFileFromArgv([])).toBeUndefined();
  });

  it("does not mistake the system prompt in the SAME directory for the task", () => {
    // Both files live in <tmpdir>/pi-subagent-<rand>/, so a directory-shaped
    // match would have exempted writer.md too.
    expect(taskFileFromArgv(["@/var/folders/xx/T/pi-subagent-ltj8yX/writer.md"])).toBeUndefined();
  });

  it("exempts that one path, and only for read", () => {
    expect(isOwnTaskRead("read", { path: TASK }, TASK)).toBe(true);
    // A write to the very same file is still a write, and still gated.
    expect(isOwnTaskRead("write", { path: TASK }, TASK)).toBe(false);
    expect(isOwnTaskRead("bash", { command: `cat ${TASK}` }, TASK)).toBe(false);
  });

  it("refuses a CONCURRENT run's task file — the reason it is not a pattern", () => {
    // Same shape, different run: a sibling delegation's prompt must stay private.
    const sibling = "/var/folders/xx/T/pi-subagent-OTHER1/task.md";
    expect(isOwnTaskRead("read", { path: sibling }, TASK)).toBe(false);
  });

  it("refuses anything else, including near-misses", () => {
    expect(isOwnTaskRead("read", { path: "/etc/passwd" }, TASK)).toBe(false);
    expect(isOwnTaskRead("read", { path: `${TASK}.bak` }, TASK)).toBe(false);
    expect(isOwnTaskRead("read", { path: path.dirname(TASK) }, TASK)).toBe(false);
    // Never arms when argv carried no positional.
    expect(isOwnTaskRead("read", { path: TASK }, undefined)).toBe(false);
  });

  it("normalises the candidate, so .. cannot dodge or forge the match", () => {
    const dodge = `${path.dirname(TASK)}/./task.md`;
    expect(isOwnTaskRead("read", { path: dodge }, TASK)).toBe(true);
    const escape = `${path.dirname(TASK)}/../pi-subagent-OTHER1/task.md`;
    expect(isOwnTaskRead("read", { path: escape }, TASK)).toBe(false);
  });

  it("survives junk input without throwing", () => {
    for (const bad of [{}, { path: "" }, { path: 42 }, { path: null }, { path: ["a"] }]) {
      expect(isOwnTaskRead("read", bad as Record<string, unknown>, TASK)).toBe(false);
    }
  });
});

describe("upstream still delivers the task the way the exemption reads it", () => {
  it("writes task.md into a pi-subagent- tempdir and passes it as @<path>", () => {
    expect(ARGS_SRC).toContain('path.join(tempDir, "task.md")');
    expect(ARGS_SRC).toContain("args.push(`@${taskFilePath}`)");
    expect(ARGS_SRC).toContain('fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"))');
  });

  it("still has no way to opt out on darwin — the reason we exempt rather than configure", () => {
    // If a third delivery value ever appears, prefer configuring over exempting.
    expect(ARGS_SRC).toMatch(/export type SubagentTaskDelivery = "auto" \| "file";/);
    // The clause 0.63.0 added. When this stops matching, re-measure whether the
    // exemption is still needed before deleting it.
    expect(ARGS_SRC).toMatch(/delivery === "file" \|\| platform === "darwin" \|\| task\.length > TASK_ARG_LIMIT/);
  });

  it("and this really is our platform, so the path is not hypothetical", () => {
    // Recorded rather than asserted: on Linux CI the clause simply does not fire.
    expect(["darwin", "linux", "win32"]).toContain(os.platform());
  });
});

describe("the task positional is recognised whatever separators it uses", () => {
  /**
   * PRD §4 (Windows round). The matcher was `startsWith("@/")` +
   * `endsWith("/task.md")`, both POSIX-only — so on Windows the child's own task file
   * was never recognised. That is not cosmetic: an unrecognised task file means the
   * child's read of its own instructions is judged by the parent's rules, lands
   * outside the workspace, and `ask` means DENY in the guard. The child is refused
   * the task it exists to do, and the audit row reads like it was snooping a tempdir.
   *
   * pi-args only takes the file route on Windows for tasks over 8,000 chars
   * (`platform === "darwin" || task.length > 8000`), which made it rare, not absent.
   */
  it("finds a Windows-shaped positional", () => {
    const argv = ["--extension", "guard.ts", "@C:\\Users\\G\\AppData\\Local\\Temp\\pi-subagent-A1\\task.md"];
    expect(taskFileFromArgv(argv)).toBe(path.resolve("C:\\Users\\G\\AppData\\Local\\Temp\\pi-subagent-A1\\task.md"));
  });

  it("finds a POSIX-shaped positional", () => {
    expect(taskFileFromArgv(["@/tmp/pi-subagent-A1/task.md"])).toBe(path.resolve("/tmp/pi-subagent-A1/task.md"));
  });

  it("still refuses a RELATIVE positional — absolute is what the @/ prefix was testing", () => {
    expect(taskFileFromArgv(["@sub/task.md"])).toBeUndefined();
    expect(taskFileFromArgv(["@task.md"])).toBeUndefined();
  });

  it("still refuses a sibling file in the same tempdir", () => {
    // writer.md rides the same directory as --system-prompt; a directory-shaped
    // match would exempt it too.
    expect(taskFileFromArgv(["@C:\\T\\pi-subagent-A1\\writer.md"])).toBeUndefined();
  });
});
