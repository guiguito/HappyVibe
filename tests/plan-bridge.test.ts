import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";

// Tiny .env loader — keeps tests dependency-free
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";
let client: PiClient;
afterEach(() => client?.stop());

/** §23: enter plan mode → a write attempt is blocked → plan_complete round-trips. */
test.skipIf(!KEY)("plan mode blocks writes and completes via the blocking plan-write envelope", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plan-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ...PROVIDER_ENV } as Record<string, string>,
    cwd: tmp,
  });

  // Collect all bridge notifies; auto-answer blocking requests so the run never hangs.
  const notifies: Record<string, unknown>[] = [];
  let planWriteAnswered = false;
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try { notifies.push(JSON.parse(r.message ?? "")); } catch { /* not JSON */ }
      return; // notifies are fire-and-forget
    }
    if (r.method === "input") {
      // The blocking plan-write envelope — answer with a fake workspace path
      // (main writes the real file; the bridge only needs the path back).
      try {
        const t = JSON.parse(r.title ?? "");
        if (t?.kind === "hv.plan-write") {
          planWriteAnswered = true;
          client.respondUi(r.id, { value: ".agents/plans/001-test.md" });
          return;
        }
      } catch { /* fall through */ }
      client.respondUi(r.id, { cancelled: true });
      return;
    }
    if (r.method === "select") client.respondUi(r.id, { value: "Deny" }); // no permission prompt expected in plan mode
  });

  await client.start();

  // 1) Enter plan mode (slash command — no model turn) and confirm the notify.
  await client.send({ type: "prompt", message: "/hv-plan on" });
  await new Promise((r) => setTimeout(r, 500));
  expect(notifies.some((n) => n.kind === "hv.plan" && n.enabled === true)).toBe(true);

  // 2) A non-allowlisted bash command must hit the clamp.
  //
  // This used to ask for `touch forbidden.txt` and was the suite's most stubborn
  // failure — not because the clamp broke, but because the plan-mode system
  // prompt had ALREADY told the model it is read-only, so it declined to call
  // bash at all and the turn ended in prose. Observed directly: no
  // tool_execution_start, no gate decision, nothing to assert on. Re-asking
  // three times and arguing with the prompt both failed; the model is doing
  // what it was told.
  //
  // `curl` reads as inspection, so the model issues it in plan mode without
  // hesitation — and it is not in READ_ONLY_COMMANDS, so it takes the SAME
  // `isSafeCommand` → block branch a `touch` would. The mutating-vs-allowlisted
  // table itself is covered exhaustively and deterministically in
  // tests/hv-plan.test.ts; what only a live run can prove is the wire —
  // clamp → hv.plan.blocked + an audit stamped source:"plan" → turn continues —
  // and it now proves it on a call the model actually makes.
  // (`-o /dev/null` and the block-before-execute order mean no network happens.)
  const blocked = await askUntil(
    () => client.send({
      type: "prompt",
      message:
        "Before planning, check network reachability: use the bash tool to run exactly " +
        "`curl -sS -o /dev/null -w '%{http_code}' https://example.com`. This is a read-only check. Run it now.",
    }),
    () => notifies.some((n) => n.kind === "hv.plan.blocked"),
  );
  expect(blocked, "model never issued a blockable bash call across 3 attempts").toBe(true);
  // The clamp decided, and said so: plan mode, not the rule engine or a prompt.
  expect(notifies).toContainEqual(
    expect.objectContaining({ kind: "hv.audit", tool: "bash", decision: "deny", source: "plan" }),
  );

  // 3) The model finalizes the plan → plan_complete → blocking plan-write round-trip.
  const completed = await askUntil(
    () => client.send({
      type: "prompt",
      message:
        "Stop exploring. Call the plan_complete tool now with a short markdown plan that has a '# Title', " +
        "a '## Tasks' section with one '- [ ] do the thing' item, and a '## Verification' section. Call it alone.",
    }),
    () => planWriteAnswered,
  );
  expect(completed, "model never called plan_complete across 3 attempts").toBe(true);
}, 300_000); // two re-asked steps, up to 3 × 45 s each, plus spawn
