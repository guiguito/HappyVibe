import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rowView, relativeChecked } from "../src/renderer/src/components/UpdateRow";
import { UPDATE_COPY } from "../src/renderer/src/components/updateCopy";
import { initialState, type UpdateGate, type UpdatePhase } from "../src/main/update/state";

/**
 * PRD §38 — what the composer-stack row says. The renderer suite has no DOM, so
 * the mapping is exported as data and the absences are source scans.
 */
const clear: UpdateGate = { blockedBy: [], terminalsOpen: false, armed: false };
const s = (phase: UpdatePhase, gate: UpdateGate = clear) => ({ ...initialState("auto", true), phase, gate });

describe("rowView", () => {
  it("nothing to say → no row (idle, checking, and errors — background or manual)", () => {
    for (const p of [
      { k: "idle" },
      { k: "idle", upToDate: true },
      { k: "checking", manual: false },
      { k: "error", message: "x", manual: false },
      { k: "error", message: "x", manual: true },
    ] as UpdatePhase[])
      expect(rowView(s(p))).toBeNull();
  });
  it("ready and clear → Restart to update", () => {
    expect(rowView(s({ k: "ready", version: "0.3.0" }))).toEqual({
      text: "HappyVibe 0.3.0 is ready",
      action: { label: "Restart to update", kind: "install" },
    });
  });
  it("ready but blocked → the waiting sentence, singular and plural", () => {
    expect(rowView(s({ k: "ready", version: "0.3.0" }, { ...clear, blockedBy: ["A"] }))!.action!.label).toBe(
      "Restart when the running session finishes",
    );
    expect(rowView(s({ k: "ready", version: "0.3.0" }, { ...clear, blockedBy: ["A", "B"] }))!.action!.label).toBe(
      "Restart when the 2 running sessions finish",
    );
  });
  it("armed → no button to press again, just what will happen", () => {
    const v = rowView(s({ k: "ready", version: "0.3.0" }, { blockedBy: ["A"], terminalsOpen: false, armed: true }))!;
    expect(v.action).toBeUndefined();
    expect(v.note).toBe("Will restart when they finish");
  });
  it("open terminals add a note", () => {
    expect(rowView(s({ k: "ready", version: "0.3.0" }, { ...clear, terminalsOpen: true }))!.note).toBe("open terminals will close");
  });
  it("available → Download, never Restart", () => {
    const v = rowView(s({ k: "available", version: "0.3.0" }))!;
    expect(v).toEqual({ text: "HappyVibe 0.3.0 is out", action: { label: "Download", kind: "download" } });
    expect(JSON.stringify(v)).not.toMatch(/Restart/);
  });
  it("downloading shows progress with no action", () => {
    expect(rowView(s({ k: "downloading", version: "0.3.0", percent: 41.6 }))).toEqual({ text: "Downloading HappyVibe 0.3.0 — 42%" });
  });
  it("a dev build (disabled) never shows a row", () => {
    expect(rowView({ ...s({ k: "ready", version: "0.3.0" }), mode: "disabled" })).toBeNull();
  });
});

describe("relativeChecked", () => {
  const now = 10 * 3600_000;
  it.each([
    [null, "Not checked yet"],
    [now - 20_000, "Last checked just now"],
    [now - 12 * 60_000, "Last checked 12 min ago"],
    [now - 3 * 3600_000, "Last checked 3 h ago"],
  ])("%s → %s", (at, out) => expect(relativeChecked(at, now)).toBe(out));
});

describe("copy and look — §20, §38", () => {
  const read = (f: string) => readFileSync(path.join(__dirname, "..", "src/renderer/src/components", f), "utf8");
  const row = read("UpdateRow.tsx");
  const page = read("ChangelogView.tsx");
  it("no dead copy", () => {
    const all = row + page;
    expect(Object.keys(UPDATE_COPY).filter((k) => !all.includes(`C.${k}`))).toEqual([]);
  });
  it("no ⌘ and no 'your Mac' in any string", () => {
    const words = Object.values(UPDATE_COPY)
      .map((v) => (typeof v === "function" ? (v as (...a: never[]) => string)(...(["0.3.0", 2] as never[])) : v))
      .join(" ");
    expect(words).not.toMatch(/⌘|your Mac/);
  });
  // The row is a quiet line like the pulse, never an alarm and never a layer.
  it("is not a Banner, a dialog or a floating surface", () => {
    expect(row).not.toMatch(/Banner/);
    expect(row).not.toMatch(/hv-overlay|hv-dialog/);
    expect(row).not.toMatch(/className="[^"]*\b(fixed|absolute)\b/);
  });
  it("borrows the pulse's line — same wrapper classes", () => {
    expect(row).toContain('"flex items-center justify-center gap-2 px-6 text-sm"');
  });
  it("the page uses the shared Toggle, not a hand-rolled checkbox", () => {
    expect(page).toMatch(/<Toggle/);
    expect(page).not.toMatch(/type="checkbox"/);
  });
  it("ChatView mounts the row just above the pulse", () => {
    const chat = read("ChatView.tsx");
    expect(chat.indexOf("<UpdateRow")).toBeGreaterThan(-1);
    expect(chat.indexOf("<UpdateRow")).toBeLessThan(chat.indexOf("<SessionPulse"));
  });
});
