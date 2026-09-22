import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { crashText, toAuditRow } from "../src/renderer/src/components/AuditView";

const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
const analytics = fs.readFileSync("src/main/analytics.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");
const crash = fs.readFileSync("src/main/crash/index.ts", "utf8");
const seam = fs.readFileSync("src/main/crash/client.ts", "utf8");

/**
 * §37 — a crash report is the one thing the app sends WITHOUT a click, so the
 * audit row is not bookkeeping, it is the whole reason that is acceptable.
 * This file pins the two halves: exactly one writer, and a payload that cannot
 * carry content even by accident.
 *
 * Clone of tests/feedback-audit.test.ts, one feature over, for the same reason:
 * the renderer suite has no DOM and the payload's shape is decided in main.
 */
describe("§37 crash.sent audit row", () => {
  it("ONE writer, in the crash module, and the Audit page reads the type back", () => {
    // One payload, two moments — the live append and the buffered drain — and
    // both live in the electron-free seam so nothing else can grow a third.
    expect((seam.match(/type: "crash\.sent"/g) ?? []).length).toBe(2);
    expect((crash.match(/recordCrashSent\(/g) ?? []).length).toBe(1);
    // ipc READS the type (for the Audit page) but never APPENDS one: the row
    // is main's own record of a send, and `onSent` is the only thing that knows
    // a send happened.
    expect(ipc).not.toMatch(/log\.append\(\{[^}]*type: "crash\.sent"/);
    expect(ipc).toMatch(/log\.read\(\{ type: "crash\.sent"/);
  });

  it("the row is built from ids and counts — never a message, frames or context", () => {
    const at = crash.indexOf("const row: CrashRow = {");
    expect(at).toBeGreaterThan(-1);
    const row = crash.slice(at, crash.indexOf("};", at));
    expect(row).toMatch(/reportId|groupId/);
    // The negative is the point: `envelope` is in scope here with the message
    // and the frames on it, so nothing but the allowlist may be read off it.
    expect(row).not.toMatch(/message|frames|context|stderr|exception/);
  });

  it("the buffered drain writes the SAME payload as the live one", () => {
    // A boot crash is written before the EventLog exists, which is exactly the
    // crash we most want a row for. Two code paths, one shape.
    expect(seam).toMatch(/export function attachCrashAudit/);
    expect(seam).toMatch(/pending\.splice\(0\)/);
    expect(ipc).toMatch(/attachCrashAudit\(log\)/);
  });

  it("analytics names it as a no-op — the switch stays an inventory of what main writes", () => {
    expect(analytics).toMatch(/case "crash\.sent":/);
  });

  it("every §37 IPC channel is in BOTH preload and ipc", () => {
    // The handlers live in the crash module, not in ipc.ts — see crash/client.ts
    // for why ipc.ts must not reach that import.
    for (const ch of ["hv:get-crash-reports", "hv:set-crash-reports", "hv:crash-info", "hv:crash-reveal", "hv:crash-test"]) {
      expect(preload, ch).toContain(`"${ch}"`);
      expect(crash, ch).toContain(`"${ch}"`);
    }
    expect(preload).toContain('"hv:crash-sent"');
    expect(crash).toContain('"hv:crash-sent"');
  });

  it("toAuditRow discriminates on the EVENT TYPE, never on data.kind", () => {
    // The payload carries its own `kind` ("exception", "child-exit"…), and
    // reading THAT is the bug this function was extracted to fix.
    const r = toAuditRow({
      ts: "2026-09-21T00:00:00.000Z",
      type: "crash.sent",
      data: { reportId: "rep_1", groupId: "grp_1", isNewGroup: true, kind: "exception", bytes: 2048, channel: "dev" },
    } as never);
    expect(r.row).toBe("crash");
    expect(ipc.length).toBeGreaterThan(0);
  });

  it("the row's words name the kind and nothing else", () => {
    const base = { ts: "", reportId: "rep_1", groupId: "g", bytes: 0, channel: "dev" };
    expect(crashText({ ...base, kind: "exception", isNewGroup: true })).toBe("Sent a crash report · exception · new");
    expect(crashText({ ...base, kind: "child-exit", isNewGroup: false })).toBe("Sent a crash report · child-exit");
  });

  it("the crash module never reaches back into ipc.ts — the audit log is handed to it", () => {
    // An import the other way is a cycle: ipc.ts imports the crash module for
    // captureCrash, and the crash module needs the log ipc.ts constructs.
    expect(crash).not.toMatch(/from "\.\.\/ipc"/);
    expect(seam).not.toMatch(/from "\.\.\/ipc"/);
  });
});
