import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { PULSE_COPY } from "../src/renderer/src/sessionPulse";

const chat = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
const app = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
const pulse = fs.readFileSync("src/renderer/src/components/SessionPulse.tsx", "utf8");

/**
 * The renderer suite has no DOM, so the pulse's placement and its two absences
 * are pinned as a source scan — an absence is exactly what a render test would
 * not fail on.
 */
describe("§34 pulse wiring", () => {
  it("the pulse is NOT a Banner (§20 keeps those for things that are wrong)", () => {
    expect(pulse).not.toMatch(/<Banner/);
    expect(pulse).not.toMatch(/Dismiss/); // Banner's word, not this row's
  });

  it("it renders in the banner stack and yields to both banners", () => {
    const at = chat.indexOf("<SessionPulse");
    expect(at).toBeGreaterThan(chat.indexOf("suggestCompact && ("));
    expect(chat.slice(at - 400, at)).toMatch(/crashed === null && !suggestCompact/);
  });

  it("App decides with pulseDecision, on the turn beat, and never from dev mode", () => {
    expect(app).toMatch(/pulseDecision\(/);
    expect(app).toMatch(/feedbackInfo\.fastPulse \? PULSE_TIMING\.fast : PULSE_TIMING\.normal/);
    expect(app).not.toMatch(/import\.meta\.env\.DEV[^\n]*[Pp]ulse/);
  });

  it("asked is written at SHOW, from the component's first render", () => {
    expect(pulse).toMatch(/useEffect\(\(\) => \{\s*onAsked\(\);/);
    expect(app).toMatch(/onAsked: \(\) => void window\.hv\.sessionPulseAsked\(sid\)/);
  });

  it("dismiss sends nothing — no IPC anywhere in its handler", () => {
    const at = pulse.indexOf("const dismiss");
    const body = pulse.slice(at, at + 200);
    expect(body).not.toMatch(/window\.hv\./);
  });

  it("the reported context is the GAUGE's figure, never the cumulative total", () => {
    const at = app.indexOf("contextTokens:");
    expect(app.slice(at, at + 120)).toMatch(/contextUsage/);
    expect(app.slice(at, at + 120)).not.toMatch(/stats\.tokens|\.tokens\?\.total/);
  });

  it("no dead copy in PULSE_COPY (§20 rule)", () => {
    const unused = Object.keys(PULSE_COPY).filter((k) => !pulse.includes(`PULSE_COPY.${k}`) && !pulse.includes(`C.${k}`));
    expect(unused).toEqual([]);
  });

  it("the copy never says telemetry", () => {
    expect(Object.values(PULSE_COPY).join(" ")).not.toMatch(/telemetry/i);
  });
});
