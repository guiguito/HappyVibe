/**
 * FR4 end to end, against a real child Pi process.
 *
 * This is the test that proves the whole enforcement chain rather than its parts:
 *
 *  1. an agent declaring `write` is approved, so the bridge WIDENS the session
 *     capability ceiling — otherwise the child would not even have the tool;
 *  2. the child therefore launches with `write` in its `--tools`;
 *  3. `pi-node.sh` injected `hv-child-guard.ts` into it;
 *  4. the guard clamps the write's `ask` to a DENY and records it.
 *
 * Asserted on the guard's own AUDIT FILE, not on a Pi event. `tool_execution_start`
 * fires BEFORE tool_call handlers, so it can never prove a call was blocked — a
 * test asserting on it passes either way. The audit row is written by the code
 * path that made the decision, so it is the only honest witness.
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");

/** An agent that DECLARES write — so approving it must widen the ceiling. */
const WRITER_AGENT = `---
name: writer
description: Test agent that declares a write-capable toolset.
tools: read, write
---
You are a test agent. Do exactly what the task says, using your tools.
`;

let agentDir: string;
let workDir: string;
let sessionDir: string;
let auditDir: string;
let rulesFile: string;
let client: PiClient | undefined;

type Ui = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type Ev = { type?: string; [k: string]: unknown };
const uis: Ui[] = [];
const events: Ev[] = [];

const waitFor = (pred: () => boolean, ms: number, what: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve(); }
      else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timeout: ${what}`)); }
    }, 250);
  });

/** Every row the guard has written, across all runs. */
function auditRows(): Array<Record<string, unknown>> {
  if (!fs.existsSync(auditDir)) return [];
  return fs.readdirSync(auditDir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => fs.readFileSync(path.join(auditDir, f), "utf8").split("\n").filter(Boolean))
    .flatMap((l) => { try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; } });
}

beforeAll(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-dir-"));
  fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
  for (const f of fs.readdirSync(path.join(runtime, "agents"))) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(runtime, "agents", f), path.join(agentDir, "agents", f));
  }
  fs.writeFileSync(path.join(agentDir, "agents", "writer.md"), WRITER_AGENT);
  // async:false keeps the whole thing inside one turn, so the test does not also
  // depend on the triggered-delivery turn (which is this suite's flakiest wait).
  fs.mkdirSync(path.join(agentDir, "extensions", "subagent"), { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "extensions", "subagent", "config.json"),
    JSON.stringify({ asyncByDefault: false, completionBatch: { enabled: false } }),
  );

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-cwd-"));
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-sess-"));
  auditDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-audit-")), "child-audit");

  // Allow the DELEGATION (so no prompt stalls the run) but write NO rule for
  // `write` — so the parent would ask, and the child must therefore deny.
  rulesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-guard-rules-")), "permission-rules.json");
  fs.writeFileSync(rulesFile, JSON.stringify({
    global: [{ layer: "tool", pattern: "subagent*", action: "allow" }],
    workspaces: {},
  }));
});

afterAll(() => client?.stop());

test.skipIf(!KEY)(
  "a child gets the tool its boundary was widened for, and the guard denies the write",
  async () => {
    const spec = resolvePiSpawn(workDir, sessionDir, runtime, {
      agentDir,
      providerEnv: PROVIDER_ENV,
      rulesFile,
      childAuditDir: auditDir,
      model: MODEL,
    });
    expect(spec.env.HV_CHILD_AUDIT_DIR, "the guard needs somewhere to write").toBe(auditDir);
    expect(spec.env.HV_RULES_FILE, "…and rules to apply").toBe(rulesFile);

    client = new PiClient(spec);
    client.on("ui-request", (m) => uis.push(m as Ui));
    client.on("event", (e) => events.push(e as Ev));
    await client.start();

    await client.send({
      type: "prompt",
      message:
        "Use the subagent tool right now with async false to delegate to the agent named 'writer'. " +
        "Give it exactly this task: 'create a file called note.txt containing the word HI'. " +
        "Do not do anything else yourself.",
    });

    // The guard wrote at least one row ⇒ hv-child-guard.ts LOADED in the child.
    // That alone is the wrapper-injection proof; the pi-node.sh path being wrong
    // would leave this directory empty forever.
    await waitFor(() => auditRows().length > 0, 240_000, "the child guard wrote an audit row");

    const rows = auditRows();
    const denied = rows.filter((r) => r.decision === "deny");

    // The child attempted the write it was given tools for, and was refused.
    const write = denied.find((r) => r.tool === "write" || r.tool === "edit" || r.tool === "multi_edit");
    expect(write, `no write was denied; rows: ${JSON.stringify(rows)}`).toBeTruthy();
    expect(write!.wouldHave, "the parent would have PROMPTED — that is what got clamped").toBe("ask");
    expect(write!.source).toBe("child");
    expect(typeof write!.runId).toBe("string");
    expect(typeof write!.ts).toBe("string");

    // …and the file really was not created. The audit row could in principle lie;
    // the filesystem cannot.
    expect(fs.existsSync(path.join(workDir, "note.txt")), "the denied write must not have happened").toBe(false);
  },
  300_000,
);
