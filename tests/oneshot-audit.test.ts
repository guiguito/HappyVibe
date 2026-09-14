import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHARS_PER_TOKEN, estimateTokens, logOneShot } from "../src/main/oneShotLog";
import { aggregate } from "../src/main/analytics";
import { toAuditRow } from "../src/renderer/src/components/AuditView";
import type { LogEvent } from "../src/main/log";

/**
 * Round 15 — the model calls the app makes on the user's behalf stop being
 * invisible: session titles, the commit message, the PR draft. Asked directly
 * ("which costs are not tracked? where should it appear? does it appear in the
 * audit log?"), so the answers are pinned here.
 *
 * There are THREE, not the four this file used to name (PRD §11/§19, corrected
 * 2026-08-30). The AGENTS.md draft is a delegation, not a one-shot — it runs on
 * the session's own model, enters the transcript, and is gated and audited as a
 * delegation. Its `agents-md` row type was wired on 2026-08-16 into a handler
 * that had already been dead for a month, so no such row was ever emitted.
 */

const sink = (): { rows: Array<Record<string, unknown>>; append: (e: Record<string, unknown>) => void } => {
  const rows: Array<Record<string, unknown>> = [];
  return { rows, append: (e) => void rows.push(e) };
};

describe("estimateTokens", () => {
  it("is prompt + output over the chars-per-token rule of thumb", () => {
    expect(estimateTokens(400, 0)).toBe(400 / CHARS_PER_TOKEN);
    expect(estimateTokens(10, 10)).toBe(5);
  });

  it("rounds up — a call that happened never reports zero tokens", () => {
    expect(estimateTokens(1, 0)).toBe(1);
  });

  it("treats nonsense as nothing rather than producing NaN", () => {
    expect(estimateTokens(-5, -5)).toBe(0);
  });
});

describe("logOneShot", () => {
  it("records what ran, which model, and the estimate", () => {
    const s = sink();
    const ev = logOneShot(s, {
      kind: "commit-message",
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      promptChars: 4_000,
      outputChars: 200,
      ok: true,
      workspaceId: "/ws",
    });
    expect(ev).toEqual({ kind: "commit-message", model: "deepseek/deepseek-v4-flash", estTokens: 1_050, ok: true, appended: false });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ type: "assistant.oneshot", workspaceId: "/ws" });
    expect(s.rows[0].data).toMatchObject({ kind: "commit-message", estTokens: 1_050, ok: true });
  });

  it("records a FAILED call too — a draft that did not arrive still cost a spawn", () => {
    const s = sink();
    const ev = logOneShot(s, {
      kind: "pr-draft",
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      promptChars: 100,
      outputChars: 0,
      ok: false,
    });
    expect(ev.ok).toBe(false);
    expect(s.rows[0].data).toMatchObject({ ok: false });
  });

  it("carries NO dollar figure, deliberately", () => {
    // §19 ruling 3: a price invented from a table main does not have is worse
    // than no price. If this ever fails, read src/main/oneShotLog.ts first.
    const s = sink();
    logOneShot(s, {
      kind: "title",
      model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      promptChars: 100,
      outputChars: 100,
      ok: true,
    });
    expect(Object.keys(s.rows[0].data as object)).toEqual(["kind", "model", "estTokens", "ok", "appended"]);
  });

  it("never throws when there is nowhere to log — a draft must not fail on logging", () => {
    expect(() =>
      logOneShot(null, {
        kind: "title",
        model: { provider: "p", modelId: "m" },
        promptChars: 1,
        outputChars: 1,
        ok: true,
      }),
    ).not.toThrow();
    const broken = { append: () => { throw new Error("disk full"); } };
    expect(() =>
      logOneShot(broken, {
        kind: "title",
        model: { provider: "p", modelId: "m" },
        promptChars: 1,
        outputChars: 1,
        ok: true,
      }),
    ).not.toThrow();
  });
});

const ev = (type: string, data: Record<string, unknown>, ts = "2026-08-16T12:00:00.000Z"): LogEvent =>
  ({ ts, type, workspaceId: "/ws", data }) as LogEvent;

describe("Stats counts them beside the cost, never inside it", () => {
  it("sums count and estimated tokens", () => {
    const a = aggregate([
      ev("assistant.oneshot", { kind: "title", model: "m", estTokens: 100, ok: true }),
      ev("assistant.oneshot", { kind: "commit-message", model: "m", estTokens: 250, ok: true }),
      ev("assistant.oneshot", { kind: "pr-draft", model: "m", estTokens: 40, ok: false }),
    ]);
    expect(a.oneShot).toEqual({ count: 3, failed: 1, estTokens: 390 });
  });

  it("adds NOTHING to the session cost or token totals", () => {
    // The ledger keeps meaning what sessions cost (§19 ruling 1).
    const a = aggregate([ev("assistant.oneshot", { kind: "title", model: "m", estTokens: 5_000, ok: true })]);
    expect(a.cost).toBe(0);
    expect(a.tokens).toEqual({ input: 0, output: 0 });
    expect(a.totalSessions).toBe(0);
  });

  it("is zero when the app has made no calls of its own", () => {
    expect(aggregate([]).oneShot).toEqual({ count: 0, failed: 0, estTokens: 0 });
  });
});

describe("the audit breakdown folds the bypass rename", () => {
  it("counts pre-round-15 'dangerous' rows as 'bypass'", () => {
    // Otherwise one fact appears as two half-sized buckets across the rename.
    const a = aggregate([
      ev("permission.decision", { decision: "allow", source: "dangerous" }),
      ev("permission.decision", { decision: "allow", source: "bypass" }),
      ev("permission.decision", { decision: "deny", source: "rule" }),
    ]);
    expect(a.permissions.bySource).toEqual({ bypass: 2, rule: 1 });
    expect(a.permissions.byDecision).toEqual({ allow: 2, deny: 1 });
  });
});

describe("the bridge emits bypass, and what the rules would have said", () => {
  // Source-scanned: the branch lives inside the tool_call handler, which needs a
  // live Pi child to exercise — that path is covered by the live rules-bridge
  // test. What must not drift silently is the SHAPE, which is what this pins.
  const BRIDGE = readFileSync(
    path.join(import.meta.dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"),
    "utf8",
  );

  it("no longer emits the source that made every row identical", () => {
    expect(BRIDGE).not.toContain('source: "dangerous"');
  });

  it("emits bypass, with the engine's own verdict alongside", () => {
    expect(BRIDGE).toContain('source: "bypass"');
    expect(BRIDGE).toContain("wouldHave: shadow.action");
  });

  it("still evaluates the rules under a bypass — the verdict has to come from somewhere", () => {
    // Matched across lines and without pinning the argument list: the call gained
    // `caseInsensitivePaths` in the Windows round, and what this test is FOR is that
    // a bypass still evaluates the rules — not how many fields the call passes.
    expect(BRIDGE).toMatch(/const shadow = evaluate\(\s*rules,\s*\{[^}]*tool: permTool,[^}]*workspace: process\.cwd\(\)/);
  });

  it("types wouldHave as the ENGINE's action, which has an 'ask' that AuditDecision does not", () => {
    expect(BRIDGE).toContain("wouldHave?: RuleAction;");
  });
});

describe("toAuditRow discriminates on the event TYPE, not the payload", () => {
  /**
   * The regression this exists for, found by a GUI pass and by nothing else:
   * the first version tested `data.kind`, and EVERY permission decision has one
   * — the bridge's envelope is `{kind:"hv.audit", …}` and main stores that
   * payload verbatim. So every decision was read as a one-shot, the renderer
   * called `.toLocaleString()` on an absent `estTokens`, and the Audit page
   * rendered as a blank cream rectangle.
   *
   * Fixtures are the REAL shapes: `data` carries `kind:"hv.audit"` on a
   * decision, because that is what is on disk.
   */
  const decision = {
    ts: "2026-08-16T12:00:00.000Z",
    type: "permission.decision",
    sessionId: "s1",
    workspaceId: "/ws",
    data: { kind: "hv.audit", tool: "bash", summary: "ls", decision: "allow", source: "bypass", wouldHave: "ask" },
  };
  const oneshot = {
    ts: "2026-08-16T12:00:01.000Z",
    type: "assistant.oneshot",
    workspaceId: "/ws",
    data: { kind: "commit-message", model: "deepseek/deepseek-v4-flash", estTokens: 1_050, ok: true },
  };

  it("a permission decision stays a decision even though its payload has a `kind`", () => {
    const r = toAuditRow(decision as never);
    expect(r.row).toBe("decision");
    expect(r).toMatchObject({ tool: "bash", decision: "allow", source: "bypass", wouldHave: "ask" });
  });

  it("a one-shot is a one-shot, with the numbers the row renders", () => {
    const r = toAuditRow(oneshot as never);
    expect(r.row).toBe("oneshot");
    // The exact field whose absence blanked the page.
    expect((r as { estTokens: number }).estTokens).toBe(1_050);
  });

  it("every row the page renders has the fields that row's branch reads", () => {
    for (const e of [decision, oneshot]) {
      const r = toAuditRow(e as never);
      if (r.row === "oneshot") expect(typeof r.estTokens).toBe("number");
      else expect(typeof r.decision).toBe("string");
    }
  });
});

// ── PRD §15 (2026-08-30): the AGENTS.md draft is an agent, not a one-shot ────

describe("agents-md is not a one-shot kind", () => {
  const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

  it("has no kind, no label and no handler left behind", () => {
    // A source scan, not a behavioural test, because what this pins is an
    // ABSENCE — and an absence is exactly what a behavioural test cannot fail
    // on. Same shape as tests/modal-layer.test.ts.
    // The KIND literal, not the word: the comment there explains why it went.
    expect(read("src/main/oneShotLog.ts")).not.toMatch(/"agents-md"/);
    expect(read("src/renderer/src/components/AuditView.tsx")).not.toMatch(/drafted AGENTS\.md/);
    expect(read("src/main/ipc.ts")).not.toMatch(/oneShot\("agents-md"/);
  });
});

// ── §19 (2026-08-30): an append is recorded, not silent ─────────────────────

describe("the audit row says when the prompt was appended to", () => {
  const model = { provider: "p", modelId: "m" };

  it("records appended:true so the token estimate is not silently inflated", () => {
    // oneShotLog measures CHARACTERS, so an append raises estTokens with
    // nothing on the row explaining why. This flag is that explanation.
    const s = sink();
    logOneShot(s, { kind: "title", model, promptChars: 100, outputChars: 20, ok: true, appended: true });
    expect(s.rows[0].data).toMatchObject({ appended: true });
  });

  it("defaults to false — an untouched prompt claims nothing", () => {
    const s = sink();
    logOneShot(s, { kind: "pr-draft", model, promptChars: 10, outputChars: 5, ok: true });
    expect(s.rows[0].data).toMatchObject({ appended: false });
  });
});

