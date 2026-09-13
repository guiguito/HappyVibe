import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCHEDULE_EVENT_LABELS } from "../src/renderer/src/components/AuditView";

/**
 * §35 source scans — the repo's own pattern for pinning an ABSENCE, which no
 * render test can fail on and which the no-DOM suite cannot see any other way.
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("the Built-in tools row", () => {
  it("renders a Schedules switch bound to builtins.schedules", () => {
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    expect(src).toContain("builtins.schedules");
    expect(src).toMatch(/builtinsSet\(\{ schedules: on \}\)/);
  });

  it("says the scheduler keeps running — the toggle takes tools from the AGENT, not schedules from the user", () => {
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    const row = src.slice(src.indexOf("function SchedulesRow"), src.indexOf("export function BuiltinToolsBlock"));
    expect(row).toMatch(/schedules keep running/i);
  });
});

describe("a schedule can never carry its own permission bypass (§5.1)", () => {
  it("the Schedule type has no bypass or dangerous field", () => {
    const src = R("src/main/schedules.ts");
    const iface = src.slice(src.indexOf("export interface Schedule {"), src.indexOf("export const FAIL_PAUSE_AT"));
    expect(iface.toLowerCase()).not.toMatch(/bypass|dangerous/);
  });
});

describe("main wires the scheduler to paths it already owns", () => {
  const ipc = R("src/main/ipc.ts");

  it("a scheduled run is prompted through the SAME function a person's keystrokes take", () => {
    // A second implementation would drift: @file mentions, prompt-template
    // expansion, document conversion and the rewind snapshot all live in that
    // body, and a schedule whose /review stopped expanding would read as the
    // model ignoring instructions.
    expect(ipc).toMatch(/const promptSession = async \(/);
    expect(ipc).toMatch(/promptSession\(sessionId, text, undefined, undefined, undefined, undefined, undefined, \{ source: "schedule" \}\)/);
  });

  it("a schedule prompting its own run does not count as the user using it", () => {
    // lastUsedAt has to keep meaning "a human touched this" — archivePreviousRun
    // reads exactly that to decide whether a run was adopted and should stay.
    expect(ipc).toMatch(/if \(!bySchedule\) index\.touch\(sessionId\)/);
  });

  it("the busy gate is the workspace's, not the session's", () => {
    expect(ipc).toMatch(/sessionsOfWorkspace\(index\.list\(\), ws\)\.every\(/);
  });

  it("the tick is a 60 s interval plus a powerMonitor resume — setInterval does not fire while the Mac sleeps", () => {
    expect(ipc).toMatch(/setInterval\(\(\) => void scheduler\.tick\(\)/);
    expect(ipc).toMatch(/powerMonitor\.on\("resume", catchUpAndTick\)/);
  });

  it("no cron library was added", () => {
    const pkg = JSON.parse(R("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(all)) expect(name, name).not.toMatch(/cron|scheduler|later|agenda/i);
  });

  it("Run all / Skip all is the renderer calling one handler per id — main keeps one decision path", () => {
    expect(ipc).toMatch(/ipcMain\.handle\("hv:schedule-missed-answer"/);
    expect(ipc).not.toMatch(/hv:schedules-missed-answer-all/);
  });

  it("openAtLogin is only ever set from the one handler, and hidden in development", () => {
    expect(ipc.match(/setLoginItemSettings\(/g)).toHaveLength(1);
    expect(ipc).toMatch(/available: app\.isPackaged/);
    expect(ipc).toMatch(/if \(!app\.isPackaged\) throw new Error/);
  });

  it("a run's cost comes from the session ledger, and unknown stays unknown", () => {
    const fn = ipc.slice(ipc.indexOf("const runCost ="), ipc.indexOf("const showScheduleNotification"));
    expect(fn).toMatch(/sessionCalls\(/);
    expect(fn).toMatch(/return undefined/);
    expect(fn).not.toMatch(/\?\? 0/);
  });

  it("Notification is constructed in exactly one place", () => {
    expect(ipc.match(/new Notification\(/g)).toHaveLength(1);
  });

  it("the read-only clamp is re-derived at every spawn rather than stored on the session", () => {
    expect(ipc).toMatch(/readonly: readonlyForSession\(sessionId\)/);
    expect(ipc).toMatch(/scheduleStore\.get\(scheduleId\)\?\.mode === "readonly"/);
  });
});

describe("the audit log reads as sentences", () => {
  it("every schedule event main emits has a label — a new one fails HERE, not on screen", () => {
    const emitted = new Set(
      [...(R("src/main/ipc.ts") + R("src/main/scheduler.ts")).matchAll(/"(schedule\.[a-z]+)"/g)].map((m) => m[1]!),
    );
    expect(emitted.size).toBeGreaterThanOrEqual(7);
    for (const type of emitted) expect(Object.keys(SCHEDULE_EVENT_LABELS), type).toContain(type);
  });

  it("analytics NAMES them rather than falling through — a run's spend is already in the ledger", () => {
    const a = R("src/main/analytics.ts");
    for (const type of Object.keys(SCHEDULE_EVENT_LABELS)) expect(a, type).toContain(`case "${type}":`);
  });

  it("no label is a raw event type", () => {
    for (const [type, label] of Object.entries(SCHEDULE_EVENT_LABELS)) {
      expect(label, type).not.toContain(".");
      expect(label, type).toMatch(/^[a-z]/);
    }
  });
});

describe("the Built-in tools rows keep their own trailers", () => {
  it("every row's disclosure sits INSIDE it, above the divider", () => {
    // Rendered after <PromptRow/> one lands below the line and reads as the
    // heading of the row beneath it — invisible until §35 added a row there,
    // and true of Plan mode's for just as long.
    const src = R("src/renderer/src/components/BuiltinToolsBlock.tsx");
    expect(src).toMatch(/footer=\{<HowItWorks copy="memory" \/>\}/);
    expect(src).toMatch(/footer=\{<HowItWorks copy="planMode" \/>\}/);
    expect(src).not.toMatch(/\/>\s*<div className="px-4 pb-3 -mt-1">\s*<HowItWorks/);
    // The slot renders inside PromptRow's own bordered container.
    const pr = R("src/renderer/src/components/PromptRow.tsx");
    const root = pr.indexOf('<div className="border-b border-line last:border-b-0">');
    expect(pr.indexOf("{footer && <div")).toBeGreaterThan(root);
    expect(pr.indexOf("{footer && <div")).toBeLessThan(pr.lastIndexOf("</div>"));
  });
});

describe("a scheduled run shows the prompt it was given", () => {
  const ipc = R("src/main/ipc.ts");

  it("main announces the prompt it sent, because no composer did", () => {
    // The renderer only draws a user bubble for its OWN send or for a queue
    // delivery. A prompt main sends has neither, so a scheduled run's
    // transcript opened straight into the reply — and the restore that would
    // have filled it in from the session file is refused by the "don't clobber
    // a live conversation" guard, because the assistant had already streamed.
    expect(ipc).toMatch(/if \(bySchedule\) send\("hv:session-prompted", \{ sessionId, text: msg \}\)/);
  });

  it("it is announced BEFORE the send, so it cannot land after the first token", () => {
    const i = ipc.indexOf('send("hv:session-prompted"');
    const j = ipc.indexOf("await client.send(promptCommand(outgoing, behavior, images))");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });

  it("it carries the TYPED text, not the outgoing one with its @file blocks", () => {
    expect(ipc).toMatch(/text: msg \}\)/);
    expect(ipc).not.toMatch(/hv:session-prompted", \{ sessionId, text: outgoing/);
  });

  it("the renderer appends it as the user's own message", () => {
    const app = R("src/renderer/src/App.tsx");
    expect(app).toMatch(/onSessionPrompted\(\(\{ sessionId, text \}\) => \{/);
    expect(app).toMatch(/appendItem\(sessionId, \{ kind: "user", text, ts: Date\.now\(\) \}\)/);
  });
});

describe("an edit clears what the drawer cleared", () => {
  it("the save handler patches through editPatch, never the raw validated record", () => {
    const src = R("src/main/ipc.ts");
    const h = src.slice(src.indexOf('ipcMain.handle("hv:schedule-save"'));
    const body = h.slice(0, h.indexOf("});"));
    // Passing `v` straight to update() is the bug: validate drops absent
    // optional keys and update merges with a spread, so Reschedule, "No end"
    // and "Same as this project" all saved and changed nothing.
    expect(body).toContain("editPatch(v)");
    expect(body).not.toMatch(/scheduleStore\.update\(input\.id,\s*v\s*,/);
  });
});

describe("the delete prompt names the schedule, not its uuid", () => {
  it("the bridge ships the id as its own envelope field", () => {
    const src = R("pi-runtime/extensions/happyvibe-bridge.ts");
    expect(src).toMatch(/schedule_delete" && typeof input\.id === "string" \? \{ scheduleId: input\.id \}/);
  });

  it("main rewrites the headline in stampPrompt — the one choke point, replay included", () => {
    const src = R("src/main/ipc.ts");
    const fn = src.slice(src.indexOf("const nameSchedule ="), src.indexOf("const stampPrompt ="));
    expect(fn).toContain("permissionSummary(");
    // stampPrompt is what the replay path re-stamps through, so the rewrite
    // has to live inside it rather than beside one send site.
    const stamp = src.slice(src.indexOf("const stampPrompt ="), src.indexOf("const stampPrompt =") + 900);
    expect(stamp).toContain("nameSchedule(r.title)");
  });

  it("describeScheduleCall has a production caller — it shipped with none", () => {
    expect(R("src/main/scheduleEnvelopes.ts")).toMatch(/permissionSummary[\s\S]*describeScheduleCall\(/);
    expect(R("src/main/ipc.ts")).toContain("permissionSummary");
  });
});

describe("clicking a notification lands somewhere (§5.4)", () => {
  const ipc = (): string => R("src/main/ipc.ts");
  const handler = (): string => {
    const s = ipc();
    const i = s.indexOf('n.on("click"');
    return s.slice(i, s.indexOf("n.show();", i));
  };

  it("opens a window when there is none — the case a scheduled run is FOR", () => {
    // macOS keeps the app alive with every window closed, which is exactly the
    // state a 3 a.m. run finishes in. Reusing windows.primary() alone would
    // click into nothing.
    expect(handler()).toContain("windows.primary() ?? openWindow()");
    expect(handler()).toMatch(/w\.show\(\);\s*w\.focus\(\);/);
  });

  it("routes by kind: the missed nudge opens the dialog, a finished run opens its session", () => {
    expect(handler()).toContain("hv:schedules-missed");
    expect(handler()).toContain("hv:show-session");
    expect(handler()).toMatch(/workspaceId: s\.workspaceId/);
  });
});

describe("the schedule tools are the parent session's alone", () => {
  it("they are registered by the bridge, which children never load", () => {
    // §12: children run under pi-node.sh + hv-child-guard; the bridge is an
    // `-e` on the PARENT spawn only. Structural, and pinned here because every
    // other §35 invariant is and this one was not.
    const spawn = R("src/main/pi/spawn.ts");
    for (const t of ["schedule_list", "schedule_create", "schedule_update", "schedule_delete"]) {
      expect(R("pi-runtime/extensions/happyvibe-bridge.ts")).toContain(t);
      expect(spawn).not.toContain(t);
    }
    expect(R("pi-runtime/extensions/hv-child-guard.ts")).not.toContain("schedule_");
  });
});
