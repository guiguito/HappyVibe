import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CATCH_UP_LABELS, lastRunLabel, missedLabel, MODE_CARDS, nextRunLabel, scheduleSubtitle, TEMPLATES } from "../src/renderer/src/schedulesCopy";
import { EMPTY_COPY } from "../src/renderer/src/components/EmptyState";
import { nextFire, type Schedule } from "../src/main/schedules";
import { NAV, groupFor } from "../src/renderer/src/components/Sidebar";

const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
/**
 * Source with its comments removed.
 *
 * The word scans below are about what the USER reads. A comment that names an
 * absence ("deliberately absent: cron text, a host picker") is the opposite of
 * a violation, and failing on it would push the reasoning out of the file that
 * needs it most.
 */
const copyOf = (p: string): string => R(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const S = (o: Partial<Schedule> = {}): Schedule => ({
  id: "s", title: "T", prompt: "p", workspaceId: "/w", repeat: { kind: "daily" }, at: "09:00",
  mode: "full", reuseSession: false, notifyOnDone: true, catchUp: "ask", enabled: true,
  createdAt: "c", nextRunAt: null, failStreak: 0, runs: [], ...o,
});

describe("the copy is data, and it is the only copy", () => {
  it("exactly two mode cards — a third is how read-only stops meaning read-only", () => {
    expect(Object.keys(MODE_CARDS)).toEqual(["full", "readonly"]);
  });

  it("three catch-up settings, and Ask me leads", () => {
    expect(Object.keys(CATCH_UP_LABELS)).toEqual(["ask", "always", "never"]);
  });

  it("four templates, all read-only, and every one of them actually schedulable", () => {
    expect(TEMPLATES).toHaveLength(4);
    for (const t of TEMPLATES) {
      expect(t.mode, t.title).toBe("readonly");
      expect(nextFire(t.repeat, t.at, new Date()), t.title).not.toBeNull();
      // A template is where a beginner meets this feature — its prompt has to
      // stand alone, because nobody is watching the run it produces.
      expect(t.prompt.length, t.title).toBeGreaterThan(80);
    }
  });

  it("the app says Schedules — never automation, cron or job", () => {
    const src = ["src/renderer/src/schedulesCopy.ts", "src/renderer/src/components/SchedulesView.tsx",
      "src/renderer/src/components/ScheduleDrawer.tsx", "src/renderer/src/components/MissedRunsDialog.tsx"]
      .map(copyOf).join("\n");
    expect(src.toLowerCase()).not.toMatch(/automation|cron|\bjob\b/);
  });

  it("EMPTY_COPY.schedules exists and names BOTH ways in", () => {
    expect(EMPTY_COPY.schedules.headline).toBe("No schedules yet");
    expect(EMPTY_COPY.schedules.next).toMatch(/template/i);
    expect(EMPTY_COPY.schedules.next).toMatch(/Repeat this on a schedule/);
  });
});

describe("the row's labels", () => {
  const now = new Date(2026, 8, 11, 19, 0);

  it("the sidebar subtitle counts what is active and names the next one", () => {
    expect(scheduleSubtitle([], now)).toBeNull();
    expect(scheduleSubtitle([S({ enabled: false })], now)).toBeNull();
    expect(scheduleSubtitle([S({ nextRunAt: new Date(2026, 8, 11, 21, 0).toISOString() }), S({ enabled: false })], now))
      .toBe("1 active · next 21:00");
  });

  it("a question waiting on the user OUTRANKS a count of what is healthy", () => {
    const list = [S({ missed: { slotAt: "x" }, nextRunAt: new Date(2026, 8, 12).toISOString() }), S({ missed: { slotAt: "y" } })];
    expect(scheduleSubtitle(list, now)).toBe("2 missed · decide");
  });

  it("last run: a cost it does not know is omitted, never shown as $0.00", () => {
    expect(lastRunLabel(S())).toBe("— never ran");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "ok", durationMs: 125_000, costUsd: 0.03 }] }))).toBe("✓ 2 min · $0.03");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "ok", durationMs: 125_000 }] }))).toBe("✓ 2 min");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "ok", durationMs: 1000, costUsd: 0 }] }))).toBe("✓ 1 min");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "failed", reason: "402" }] }))).toBe("✕ failed: 402");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "needs_you" }] }))).toBe("⚠ needs you");
    expect(lastRunLabel(S({ runs: [{ firedAt: "f", outcome: "skipped", reason: "busy" }] }))).toBe("– skipped: busy");
  });

  it("next run distinguishes a fail-PAUSE from the user's own switch", () => {
    expect(nextRunLabel(S({ nextRunAt: new Date(2026, 8, 12, 9).toISOString() }), now)).toBe("in 14 h");
    expect(nextRunLabel(S({ nextRunAt: new Date(2026, 8, 11, 19, 30).toISOString() }), now)).toBe("in 30 min");
    expect(nextRunLabel(S({ enabled: false, failStreak: 3 }), now)).toBe("paused");
    expect(nextRunLabel(S({ enabled: false }), now)).toBe("off");
    expect(nextRunLabel(S({ repeat: { kind: "once", date: "2026-09-01" } }), now)).toBe("once, done");
  });

  it("the missed line says when it was due, in words", () => {
    expect(missedLabel(new Date(2026, 8, 10, 9, 0).toISOString())).toMatch(/^was due \w{3} 9:00$/);
  });
});

describe("where it lives", () => {
  it("Schedules is a TOP-LEVEL row, not a NAV destination in a group", () => {
    // NAV lives under the collapsible Settings toggle; a row hidden in a shut
    // group fails discovery for the person who has never made a schedule.
    expect(NAV.some((n) => (n.view as string) === "schedules")).toBe(false);
    expect(groupFor("schedules" as never)).toBeNull();
  });

  it("the row sits above the workspace tree, INSIDE the scroll region, and the collapsed rail keeps it", () => {
    const sb = R("src/renderer/src/components/Sidebar.tsx");
    const row = sb.indexOf("data-hv-schedules-row");
    expect(row).toBeGreaterThan(0);
    expect(sb).toMatch(/data-hv-schedules-rail/);
    // It scrolls WITH the destinations rather than sitting in the fixed header:
    // the header is chrome you act with (wordmark, search, collapse), this is a
    // place you go. So it is after the search block and before the workspaces
    // label, inside the tree's own scroll container.
    expect(row).toBeGreaterThan(sb.indexOf("§7 round 18: hidden at rest"));
    expect(row).toBeGreaterThan(sb.indexOf('className="flex-1 min-h-32 overflow-y-auto px-4 pb-2"'));
    expect(row).toBeLessThan(sb.indexOf('text-ink-soft">workspaces</span>'));
  });

  it("navigating there does NOT open the Settings group", () => {
    expect(R("src/renderer/src/App.tsx")).toMatch(/t\.view !== "chat" && t\.view !== "schedules"\) setSettingsOpen\(true\)/);
  });

  it("a run's session row carries the clock glyph", () => {
    expect(R("src/renderer/src/components/Sidebar.tsx")).toMatch(/session\.scheduleId && \(/);
  });
});

describe("the drawer", () => {
  const dr = R("src/renderer/src/components/ScheduleDrawer.tsx");

  it("offers no cron field, no host picker, no timeout and no per-schedule bypass", () => {
    const copy = copyOf("src/renderer/src/components/ScheduleDrawer.tsx");
    expect(copy.toLowerCase()).not.toMatch(/cron|\bhost\b|timeout|max.?runs/);
    // The word "bypass" DOES appear — as the warning that this workspace already
    // bypasses permissions. What must not exist is a control that sets one.
    expect(copy).not.toMatch(/setBypass|bypass:|dangerous/i);
  });

  it("says out loud when the workspace already bypasses permissions", () => {
    expect(dr).toContain("BYPASS_WARNING");
  });

  it("uses the platform's own time and date inputs", () => {
    expect(dr).toContain('type="time"');
    expect(dr).toContain('type="date"');
  });

  it("answers a tool-opened request on BOTH Create and Cancel — a missed answer hangs the bridge", () => {
    expect(dr.match(/scheduleDrawerAnswer\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(dr).toMatch(/if \(requestId\) window\.hv\.scheduleDrawerAnswer\(requestId, \{ cancelled: true \}\)/);
    expect(dr).toMatch(/if \(requestId\) window\.hv\.scheduleDrawerAnswer\(requestId, \{ saved \}\)/);
    // Esc is a cancel, and it must answer too.
    expect(dr).toMatch(/e\.key === "Escape"/);
  });
});

describe("the run, on screen", () => {
  const cv = R("src/renderer/src/components/ChatView.tsx");

  it("a read-only run shows its own pill", () => {
    expect(cv).toContain("Read-only run");
    expect(cv).toMatch(/\{readonlyRun && \(/);
  });

  it("and hides the Plan toggle — nothing in the run can lift its clamp", () => {
    expect(cv).toMatch(/\{onTogglePlan && !readonlyRun && \(/);
  });

  it("“Repeat this on a schedule…” is in the tab menu and the composer ＋ menu, and NOT on the session row", () => {
    expect(R("src/renderer/src/components/TabStrip.tsx")).toContain("Repeat this on a schedule…");
    expect(cv).toContain("Repeat this on a schedule…");
    expect(R("src/renderer/src/components/Sidebar.tsx")).not.toContain("Repeat this on a schedule");
  });

  it("the tab menu's entry acts on mousedown — a blur-dismissed menu loses its own clicks", () => {
    const ts = R("src/renderer/src/components/TabStrip.tsx");
    const item = ts.slice(ts.indexOf("onRepeatOnSchedule && sessionOf"), ts.indexOf("Repeat this on a schedule…"));
    expect(item).toContain("onMouseDown");
    expect(item).toContain("e.preventDefault()");
  });
});

describe("the page", () => {
  const sv = R("src/renderer/src/components/SchedulesView.tsx");

  it("the page header's action is outlined, not a dialog's honey fill", () => {
    // The honey fill is a DIALOG's primary action, where it is the one thing to
    // press. On a page header it shouts over the title.
    const sv = R("src/renderer/src/components/SchedulesView.tsx");
    const header = sv.slice(sv.indexOf("New schedule") - 400, sv.indexOf("New schedule"));
    expect(header).not.toContain("bg-honey");
    expect(header).toContain("border-line");
  });

  it("shows the open-at-login toggle only when main says it is available", () => {
    expect(sv).toMatch(/loginItem\?\.available && \(/);
  });

  it("expands a row to its own runs instead of adding a Runs console", () => {
    expect(sv).toMatch(/expanded === s\.id/);
    expect(fs.existsSync(path.join(process.cwd(), "src/renderer/src/components/RunsView.tsx"))).toBe(false);
  });

  it("the mode pill flips without opening the drawer", () => {
    expect(sv).toMatch(/const flipMode/);
    expect(sv).toMatch(/mode: s\.mode === "readonly" \? "full" : "readonly"/);
  });

  it("a busy Run now explains itself rather than failing silently", () => {
    expect(sv).toMatch(/r\.reason === "busy"/);
    expect(sv).toMatch(/setNotice\(/);
  });
});

describe("the missed dialog", () => {
  const md = R("src/renderer/src/components/MissedRunsDialog.tsx");

  it("is ONE dialog for all of them, with Run all and Skip all", () => {
    expect(md).toContain("Run all");
    expect(md).toContain("Skip all");
    expect(md).toMatch(/for \(const s of missed\) answer\(s\.id, a\)/);
  });

  it("sits on the app's dialog layer", () => {
    expect(md).toContain("hv-overlay");
    // The FLOW variant, because this card is centred by flex: hv-dialog's
    // keyframes carry a translate, which would yank a flex-centred card to the
    // viewport's corner for the length of the animation.
    expect(md).toContain("hv-dialog-flow");
  });

  it("its rows come from the LIST, so answering one makes it leave", () => {
    expect(R("src/renderer/src/App.tsx")).toMatch(/missed=\{schedules\.filter\(\(s\) => s\.missed\)\}/);
  });
});
