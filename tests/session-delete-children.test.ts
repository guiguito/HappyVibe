/**
 * §5 — deleting a session deletes its SUB-AGENT data too.
 *
 * Before this, `deleteSessionFile` removed only the session's own `.jsonl`: it is
 * `rmSync(file, {force:true})` with no `recursive`, and it is handed a FILE path,
 * so the sibling `<stem>/` directory of child Pi session files survived — and
 * `subagent-artifacts/`, which pi-subagents writes flat into our session dir, was
 * referenced nowhere in src/ at all. Measured on a real install 2026-08-29: 18
 * orphaned child directories and 13 artifact run-ids belonging to no surviving
 * session. `_output.md` carries the child's whole answer and `_transcript.jsonl`
 * its thinking, so that is content the user believed deleting had removed.
 *
 * The assertions that matter most here are the ABSENCES: that a second session's
 * data survives (the fix must not become a wildcard) and that an unreadable
 * session file stops the sweep dead (deleting on partial knowledge is worse than
 * leaking). Key-free; stays in the non-live suite.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import {
  deleteSessionChildren,
  deleteSessionFile,
  sweepOrphanedSubagentData,
} from "../src/main/store";

let dir: string;
const artifacts = () => path.join(dir, "subagent-artifacts");

/** A session with `runIds` children: parent .jsonl, child session files, artifacts. */
function makeSession(stem: string, runIds: string[]): string {
  const parent = path.join(dir, `${stem}.jsonl`);
  const body = runIds.map((id) =>
    JSON.stringify({ type: "message", result: { details: { asyncId: id, runId: id } } }));
  fs.writeFileSync(parent, `${body.join("\n")}\n`);
  for (const id of runIds) {
    const runDir = path.join(dir, stem, id, "run-0");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "session.jsonl"), "{}\n");
    for (const suffix of ["input.md", "output.md", "meta.json", "transcript.jsonl"]) {
      fs.writeFileSync(path.join(artifacts(), `${id}_code-explorer_${suffix}`), "x");
    }
  }
  return parent;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-session-delete-"));
  fs.mkdirSync(artifacts(), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("deleting a session takes its sub-agent data with it", () => {
  it("removes the child session files and that run's artifacts", () => {
    const parent = makeSession("2026-08-29T10-00-00-000Z_aaa", ["run-aaaaaaaa"]);
    deleteSessionChildren(dir, parent);
    deleteSessionFile(dir, parent);

    expect(fs.existsSync(parent), "the session file").toBe(false);
    expect(fs.existsSync(path.join(dir, "2026-08-29T10-00-00-000Z_aaa")), "the child dir").toBe(false);
    expect(fs.readdirSync(artifacts()), "its artifacts").toHaveLength(0);
  });

  it("leaves ANOTHER session's children and artifacts completely alone", () => {
    // The absence assertion that keeps this from becoming a wildcard delete.
    const doomed = makeSession("2026-08-29T10-00-00-000Z_aaa", ["run-aaaaaaaa"]);
    makeSession("2026-08-29T11-00-00-000Z_bbb", ["run-bbbbbbbb"]);

    deleteSessionChildren(dir, doomed);

    expect(fs.existsSync(path.join(dir, "2026-08-29T11-00-00-000Z_bbb", "run-bbbbbbbb")), "survivor's child dir").toBe(true);
    const left = fs.readdirSync(artifacts());
    expect(left.every((n) => n.startsWith("run-bbbbbbbb_")), `only the survivor's remain: ${left}`).toBe(true);
    expect(left).toHaveLength(4);
  });

  it("matches artifacts on an exact `<id>_` prefix, never a partial one", () => {
    // `run-aaaaaaaa` must not take `run-aaaaaaaaaa` with it.
    const doomed = makeSession("2026-08-29T10-00-00-000Z_aaa", ["run-aaaaaaaa"]);
    fs.writeFileSync(path.join(artifacts(), "run-aaaaaaaaaa_code-explorer_output.md"), "x");
    deleteSessionChildren(dir, doomed);
    expect(fs.existsSync(path.join(artifacts(), "run-aaaaaaaaaa_code-explorer_output.md"))).toBe(true);
  });

  it("deletes nothing when the session file points outside the session dir", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hv-outside-"));
    const evil = path.join(outside, "victim.jsonl");
    fs.writeFileSync(evil, "{}\n");
    fs.mkdirSync(path.join(outside, "victim"), { recursive: true });

    deleteSessionChildren(dir, evil);

    expect(fs.existsSync(evil), "confinement holds").toBe(true);
    expect(fs.existsSync(path.join(outside, "victim"))).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("survives a session that never delegated", () => {
    const parent = path.join(dir, "2026-08-29T10-00-00-000Z_ccc.jsonl");
    fs.writeFileSync(parent, "{}\n");
    expect(() => deleteSessionChildren(dir, parent)).not.toThrow();
  });
});

describe("the call sites keep the order the ids depend on", () => {
  const IPC = path.join(__dirname, "..", "src", "main", "ipc.ts");

  it("every delete site runs deleteSessionChildren BEFORE deleteSessionFile", () => {
    // Not style. `_meta.json` records the run and the agent but never the parent
    // session, so an artifact's owner is only knowable from ids inside the parent
    // .jsonl. Delete that first and the association is gone for good — which is
    // exactly how 13 unreferenced artifact sets ended up on disk.
    const src = readFileSync(IPC, "utf8");
    const children = [...src.matchAll(/deleteSessionChildren\(sessionDir\(\), ([\w.]+)\)/g)];
    const files = [...src.matchAll(/deleteSessionFile\(sessionDir\(\), ([\w.]+)\)/g)];
    expect(children.length, "every delete site is covered").toBe(files.length);
    expect(files.length, "the three delete sites").toBeGreaterThanOrEqual(3);
    for (const [i, f] of files.entries()) {
      expect(children[i][1], "same session on both calls").toBe(f[1]);
      expect(children[i].index!, `site ${i}: children before file`).toBeLessThan(f.index!);
    }
  });

  it("the sweep runs at startup and cannot throw into boot", () => {
    const src = readFileSync(IPC, "utf8");
    expect(src).toMatch(/sweepOrphanedSubagentData\(sessionDir\(\)\)/);
    const at = src.indexOf("sweepOrphanedSubagentData(sessionDir())");
    expect(src.slice(Math.max(0, at - 200), at), "guarded").toContain("try {");
  });
});

describe("sweeping data whose session is already gone", () => {
  it("removes an orphaned child dir and keeps one whose session is alive", () => {
    makeSession("2026-08-29T10-00-00-000Z_aaa", ["run-aaaaaaaa"]);
    makeSession("2026-08-29T11-00-00-000Z_bbb", ["run-bbbbbbbb"]);
    // Orphan the first the way the old delete did: file gone, children left.
    fs.rmSync(path.join(dir, "2026-08-29T10-00-00-000Z_aaa.jsonl"));

    const out = sweepOrphanedSubagentData(dir);

    expect(out.dirs).toBe(1);
    expect(fs.existsSync(path.join(dir, "2026-08-29T10-00-00-000Z_aaa")), "orphan dir").toBe(false);
    expect(fs.existsSync(path.join(dir, "2026-08-29T11-00-00-000Z_bbb")), "live session's dir").toBe(true);
  });

  it("removes artifacts referenced by no surviving session", () => {
    makeSession("2026-08-29T10-00-00-000Z_aaa", ["run-aaaaaaaa"]);
    makeSession("2026-08-29T11-00-00-000Z_bbb", ["run-bbbbbbbb"]);
    fs.rmSync(path.join(dir, "2026-08-29T10-00-00-000Z_aaa.jsonl"));

    const out = sweepOrphanedSubagentData(dir);

    expect(out.artifacts).toBe(4);
    const left = fs.readdirSync(artifacts());
    expect(left.every((n) => n.startsWith("run-bbbbbbbb_")), `${left}`).toBe(true);
  });

  it("deletes NOTHING from the artifacts when a session file is unreadable", () => {
    // Partial knowledge is the one case where leaking beats deleting: an id we
    // failed to read looks exactly like an id nobody references.
    makeSession("2026-08-29T11-00-00-000Z_bbb", ["run-bbbbbbbb"]);
    const unreadable = path.join(dir, "2026-08-29T12-00-00-000Z_ddd.jsonl");
    fs.writeFileSync(unreadable, "{}\n");
    fs.chmodSync(unreadable, 0o000);

    const out = sweepOrphanedSubagentData(dir);

    expect(out.artifacts, "no artifact deleted on partial knowledge").toBe(0);
    expect(fs.readdirSync(artifacts())).toHaveLength(4);
    fs.chmodSync(unreadable, 0o600);
  });

  it("never touches a file that is not an artifact — upstream keeps bookkeeping here", () => {
    // Found on a real install: pi-subagents writes `.last-cleanup` (a retention
    // timestamp) into subagent-artifacts/. It has no `_`, so an indexOf-based
    // split yields -1 and `slice(0, -1)` produces a plausible-looking id — which
    // would have deleted a file we do not own. Every fixture had an underscore,
    // so only real data caught it.
    makeSession("2026-08-29T11-00-00-000Z_bbb", ["run-bbbbbbbb"]);
    fs.writeFileSync(path.join(artifacts(), ".last-cleanup"), "1787932100643");

    sweepOrphanedSubagentData(dir);

    expect(fs.existsSync(path.join(artifacts(), ".last-cleanup")), "upstream's bookkeeping survives").toBe(true);
  });

  it("ignores a directory that is not a session stem", () => {
    fs.mkdirSync(path.join(dir, "not-a-session"), { recursive: true });
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(path.join(dir, "not-a-session"))).toBe(true);
  });

  it("never touches the artifacts directory itself", () => {
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(artifacts())).toBe(true);
  });
});

// ── `outputs/<runId>/` is a run's data too (2026-08-29, round 2) ────────────
//
// pi-subagents also writes a per-run OUTPUT DIRECTORY inside the artifacts dir:
// `subagent-artifacts/outputs/<runId>/…` (observed on a real install for a
// `scout` run, which declares `output: context.md`). Both cleanup halves keyed
// on the flat `<runId>_<agent>_*` filenames and skipped anything without an
// underscore — a guard that exists for a good reason (pi-subagents keeps
// `.last-cleanup` there) but which also made `outputs/` permanently invisible.
// So a deleted session left the child's written output behind, and the sweep
// never collected it: the same "delete means delete" gap the flat artifacts had.
describe("a run's outputs/ directory is cleaned up like its other artifacts", () => {
  const outputsFor = (id: string): string => path.join(artifacts(), "outputs", id);

  it("deleting a session removes its children's outputs/ directories", () => {
    const parent = makeSession("2026-08-29T12-00-00-000Z_out", ["run-outputs1"]);
    fs.mkdirSync(outputsFor("run-outputs1"), { recursive: true });
    fs.writeFileSync(path.join(outputsFor("run-outputs1"), "context.md"), "the child's answer");
    deleteSessionChildren(dir, parent);
    expect(fs.existsSync(outputsFor("run-outputs1"))).toBe(false);
  });

  it("the startup sweep collects an orphaned outputs/ directory", () => {
    // No session file references this id at all.
    fs.mkdirSync(outputsFor("run-orphaned1"), { recursive: true });
    fs.writeFileSync(path.join(outputsFor("run-orphaned1"), "context.md"), "x");
    const swept = sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(outputsFor("run-orphaned1"))).toBe(false);
    expect(swept.artifacts).toBeGreaterThan(0);
  });

  it("keeps an outputs/ directory whose session is alive", () => {
    makeSession("2026-08-29T13-00-00-000Z_live", ["run-alive001"]);
    fs.mkdirSync(outputsFor("run-alive001"), { recursive: true });
    fs.writeFileSync(path.join(outputsFor("run-alive001"), "context.md"), "keep me");
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(outputsFor("run-alive001"))).toBe(true);
  });

  it("never removes the outputs/ container itself, only what is inside it", () => {
    // Deleting the container would make upstream recreate it, and a future
    // entry could land while we were mid-sweep.
    fs.mkdirSync(outputsFor("run-orphaned2"), { recursive: true });
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(path.join(artifacts(), "outputs"))).toBe(true);
  });

  it("leaves pi-subagents' own bookkeeping alone", () => {
    // The underscore guard exists for this; widening to outputs/ must not
    // widen to `.last-cleanup`, which is upstream's retention timestamp.
    fs.writeFileSync(path.join(artifacts(), ".last-cleanup"), "1");
    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(path.join(artifacts(), ".last-cleanup"))).toBe(true);
  });
});

// ── The sweep must see BOTH id spaces (2026-08-30) ─────────────────────────
//
// Found by watching a child transcript disappear across an app restart while its
// session was still open. `sessionRunIds` takes a UNION of the `<stem>/<runId>/`
// directory names and the asyncId/runId strings inside the parent file, with a
// comment saying the two "only sometimes coincide" and that deriving one from the
// other silently misses files. The SWEEP read only the second, so any artifact
// filed under a child run id the parent never names was treated as orphaned and
// deleted at every startup — including transcripts the run card reads.
describe("the sweep counts a child directory as a reference too", () => {
  it("keeps artifacts filed under a run id that only appears as a child directory", () => {
    const stem = "2026-08-30T09-00-00-000Z_union";
    // A live session whose parent file does NOT mention the child's run id.
    fs.writeFileSync(path.join(dir, `${stem}.jsonl`), JSON.stringify({ type: "message" }) + "\n");
    const runDir = path.join(dir, stem, "child-run-01", "run-0");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "session.jsonl"), "{}\n");
    const transcript = path.join(artifacts(), "child-run-01_code-explorer_transcript.jsonl");
    fs.writeFileSync(transcript, "x");

    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(transcript), "a live session's child transcript survives").toBe(true);
  });

  it("still collects an artifact whose session is genuinely gone", () => {
    // The sweep must not become a no-op: widening `referenced` too far would
    // simply stop it collecting anything.
    const orphan = path.join(artifacts(), "dead-run-99_code-explorer_transcript.jsonl");
    fs.writeFileSync(orphan, "x");
    const swept = sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(swept.artifacts).toBeGreaterThan(0);
  });

  it("does not resurrect references from a directory whose session file is gone", () => {
    // Half 1 removes `<stem>/` when `<stem>.jsonl` is missing. If half 2 read
    // those names first, a deleted session's ids would protect its own artifacts.
    const stem = "2026-08-30T10-00-00-000Z_dead";
    const runDir = path.join(dir, stem, "ghost-run-01", "run-0");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "session.jsonl"), "{}\n"); // no <stem>.jsonl
    const artifact = path.join(artifacts(), "ghost-run-01_code-explorer_transcript.jsonl");
    fs.writeFileSync(artifact, "x");

    sweepOrphanedSubagentData(dir);
    expect(fs.existsSync(artifact), "an orphaned session's artifacts still go").toBe(false);
  });
});
