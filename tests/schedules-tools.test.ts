import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeScheduleCall, parseScheduleEnvelope, permissionSummary, renderScheduleList } from "../src/main/scheduleEnvelopes";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import type { Schedule } from "../src/main/schedules";

const inp = (p: unknown): { method: string; title: string } => ({ method: "input", title: JSON.stringify(p) });
const draft = { title: "T", prompt: "p", repeat: { kind: "daily" }, at: "09:00" };
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("parseScheduleEnvelope", () => {
  it("parses the four kinds", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-list" }))).toEqual({ kind: "hv.schedule-list" });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft }))).toEqual({ kind: "hv.schedule-create", draft });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-update", id: "x", patch: { at: "10:00" } }))).toEqual({ kind: "hv.schedule-update", id: "x", patch: { at: "10:00" } });
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-delete", id: "x" }))).toEqual({ kind: "hv.schedule-delete", id: "x" });
  });

  it("REFUSES a workspaceId anywhere — the model cannot name a workspace, and a silently dropped field is worse", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-list", workspaceId: "/other" }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, workspaceId: "/other" } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-update", id: "x", patch: { workspaceId: "/other" } }))).toBeNull();
  });

  it("drops every field that is not on the allowlist — a new schedule is enabled by the USER pressing Create", () => {
    const env = parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, enabled: true, bypass: true, failStreak: 99, runs: [] } }));
    expect(env && "draft" in env && Object.keys(env.draft).sort()).toEqual(["at", "prompt", "repeat", "title"]);
  });

  it("accepts a minutes repeat, and bounds it", () => {
    const at = (every: number): unknown =>
      parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, repeat: { kind: "minutes", every } } }));
    expect(at(15)).toMatchObject({ draft: { repeat: { kind: "minutes", every: 15 } } });
    expect(at(1)).toBeTruthy();
    expect(at(0)).toBeNull();
    expect(at(60)).toBeNull(); // 60+ is an hours schedule
    expect(at(1.5)).toBeNull();
  });

  it("accepts an end date and refuses a malformed one", () => {
    const u = (until: unknown): unknown =>
      parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, until } }));
    expect(u("2026-12-01")).toMatchObject({ draft: { until: "2026-12-01" } });
    expect(u("next week")).toBeNull();
    expect(u(7)).toBeNull();
  });

  it("refuses a malformed time, an unknown repeat, a bad mode and an empty weekly", () => {
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, at: "9am" } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, at: "25:00" } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, repeat: { kind: "cron", expr: "* * * * *" } } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, repeat: { kind: "weekly", days: [] } } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { ...draft, mode: "bypass" } }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-create", draft: { title: "T" } }))).toBeNull();
  });

  it("refuses a non-input method, non-JSON, an unknown kind and an empty patch", () => {
    expect(parseScheduleEnvelope({ method: "notify", title: JSON.stringify({ kind: "hv.schedule-list" }) })).toBeNull();
    expect(parseScheduleEnvelope({ method: "input", title: "{nope" })).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-explode" }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-update", id: "x", patch: {} }))).toBeNull();
    expect(parseScheduleEnvelope(inp({ kind: "hv.schedule-delete" }))).toBeNull();
  });
});

const S = (o: Partial<Schedule> = {}): Schedule => ({
  id: "s1", title: "Daily change review", prompt: "p", workspaceId: "/w",
  repeat: { kind: "weekdays" }, at: "09:00", mode: "readonly", reuseSession: false,
  notifyOnDone: true, catchUp: "ask", enabled: true, createdAt: "c", nextRunAt: null,
  failStreak: 0, runs: [], ...o,
});

describe("describeScheduleCall", () => {
  it("names the schedule and its recurrence — the FACTUAL display, never the model's intent", () => {
    expect(describeScheduleCall({ kind: "hv.schedule-delete", id: "x" }, S())).toBe("Delete schedule “Daily change review” (Weekdays at 9:00)");
    // The end date is part of what you are approving.
    expect(describeScheduleCall({ kind: "hv.schedule-delete", id: "x" }, S({ until: "2026-10-03" })))
      .toBe("Delete schedule “Daily change review” (Weekdays at 9:00 until Oct 3)");
    expect(describeScheduleCall({ kind: "hv.schedule-create", draft: { ...draft, title: "New" } as never })).toBe("Create schedule “New” (Every day at 9:00)");
  });

  it("degrades to a sentence rather than to a raw id when the schedule is gone", () => {
    expect(describeScheduleCall({ kind: "hv.schedule-delete", id: "x" })).toBe("Delete a schedule");
  });
});

/**
 * The half that was missing: describeScheduleCall existed and had tests, and
 * NOTHING in src/ called it — so the delete prompt shipped showing a uuid while
 * these assertions stayed green. This is the production route.
 */
describe("permissionSummary — what main rewrites the delete prompt to", () => {
  const env = { kind: "hv.permission", tool: "schedule_delete", summary: "schedule x", scheduleId: "x" };

  it("turns the bridge's id into the schedule's name and recurrence", () => {
    expect(permissionSummary(env, () => S())).toBe("Delete schedule “Daily change review” (Weekdays at 9:00)");
  });

  it("still answers a sentence when the schedule is already gone", () => {
    expect(permissionSummary(env, () => undefined)).toBe("Delete a schedule");
  });

  it("leaves every other prompt alone", () => {
    expect(permissionSummary({ kind: "hv.permission", tool: "bash", summary: "ls" }, () => S())).toBeNull();
    // No id on the envelope: an older bridge, or a shape we do not recognise.
    expect(permissionSummary({ kind: "hv.permission", tool: "schedule_delete", summary: "schedule x" }, () => S())).toBeNull();
    expect(permissionSummary({ kind: "hv.audit", tool: "schedule_delete", scheduleId: "x" }, () => S())).toBeNull();
  });
});

describe("renderScheduleList", () => {
  it("says so plainly when there are none", () => {
    expect(renderScheduleList([], () => undefined)).toBe("No schedules in this workspace.");
  });

  it("carries the id the writers need, and omits a cost it does not know", () => {
    const line = renderScheduleList([S({ runs: [{ firedAt: "f", outcome: "ok" }] })], () => undefined);
    expect(line).toContain("[s1]");
    expect(line).toContain("Weekdays at 9:00");
    expect(line).not.toContain("$");
    expect(renderScheduleList([S({ runs: [{ firedAt: "f", outcome: "ok" }] })], () => 0.03)).toContain("($0.03)");
  });

  it("a paused schedule says paused rather than showing a next run", () => {
    expect(renderScheduleList([S({ enabled: false })], () => undefined)).toContain("paused");
  });
});

describe("where the four tools sit in the gate", () => {
  it("only schedule_delete raises a permission prompt — the other three confirm elsewhere", () => {
    // list is a read. create and update are safe-DEFAULT for the ask_user
    // reason: their only effect is to open the drawer, and main refuses to
    // write without it. A modal in front of a confirmation dialog asks the same
    // question twice and teaches people to click through both — which a live
    // run proved, by denying the modal and never reaching the drawer at all.
    for (const t of ["schedule_list", "schedule_create", "schedule_update"]) expect(SAFE_TOOLS.has(t), t).toBe(true);
    // Delete has no second dialog, so it keeps the prompt.
    expect(SAFE_TOOLS.has("schedule_delete")).toBe(false);
  });

  it("the delete prompt names the schedule factually, never the model's intent", () => {
    const src = R("pi-runtime/extensions/happyvibe-bridge.ts");
    const fn = src.slice(src.indexOf("function summarize("), src.indexOf("function summarize(") + 900);
    expect(fn).toMatch(/toolName === "schedule_delete"/);
    expect(fn).not.toMatch(/input\.intent/);
  });

  it("the three writers require an intent; the read does not", () => {
    const src = R("pi-runtime/extensions/happyvibe-bridge.ts");
    const intent = /const INTENT_TOOLS = \[([^\]]*)\]/.exec(src)![1]!;
    for (const t of ["schedule_create", "schedule_update", "schedule_delete"]) expect(intent, t).toContain(`"${t}"`);
    expect(intent).not.toContain('"schedule_list"');
  });

  it("all four register only under builtins.schedules", () => {
    const src = R("pi-runtime/extensions/happyvibe-bridge.ts");
    const block = src.slice(src.indexOf("if (builtins.schedules) {"), src.indexOf("} // builtins.schedules"));
    for (const t of ["schedule_list", "schedule_create", "schedule_update", "schedule_delete"]) expect(block, t).toContain(`name: "${t}"`);
    expect(src.match(/name: "schedule_/g)).toHaveLength(4);
  });

  it("no bundled agent asks for one — a delegated child has no business editing schedules", () => {
    const dir = path.join(process.cwd(), "pi-runtime/agents");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/schedule_/);
    }
  });
});

describe("main answers every envelope — an unanswered one hangs the bridge", () => {
  const handler = (): string => {
    const ipc = R("src/main/ipc.ts");
    return ipc.slice(ipc.indexOf("const sched = parseScheduleEnvelope(r"), ipc.indexOf("// end schedule envelopes"));
  };

  it("every branch resolves, including the declines and the errors", () => {
    const h = handler();
    for (const s of ['"declined"', '"not found"', '"deleted"', "ERROR:"]) expect(h, s).toContain(s);
    // list, delete×2, update-not-found, declined, created/updated, error
    expect(h.match(/answer\(/g)!.length).toBeGreaterThanOrEqual(7);
  });

  it("scoping is main's: a foreign id is not found, and the compare is normalised", () => {
    const h = handler();
    expect(h).toMatch(/normPath\(s\.workspaceId\) === normPath\(ws\)/);
    expect(h).toContain('if (!s) return answer("not found")');
  });

  it("create and update NEVER write without the drawer, bypass or no bypass", () => {
    const h = handler();
    expect(h).toContain("requestScheduleDrawer(");
    expect(h).not.toMatch(/scheduleStore\.(create|update)\(/);
  });

  it("a drawer request with no window left to answer it resolves as declined rather than hanging", () => {
    const ipc = R("src/main/ipc.ts");
    const fn = ipc.slice(ipc.indexOf("const requestScheduleDrawer"), ipc.indexOf('ipcMain.on("hv:schedule-drawer-answer"'));
    expect(fn).toMatch(/windows\.all\(\)\.length === 0/);
    expect(fn).toContain("resolve({ cancelled: true })");
  });

  it("an agent-confirmed write is audited as the agent's", () => {
    expect(handler()).toMatch(/source: "agent"/);
  });
});
