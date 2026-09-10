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

  /**
   * The one that shipped a white window. App has a component-level early return
   * (`keyState === "loading"`), and a hook placed after it changes the hook
   * COUNT between renders — React then unmounts the entire app. No test in this
   * suite renders App, so the position is pinned as a source fact instead.
   */
  it("the pulse effect sits ABOVE App's early return, or React tears the app down", () => {
    const effect = app.indexOf("useEffect(() => {\n    if (!feedbackInfo.available) return;");
    const earlyReturn = app.indexOf('if (keyState === "loading") {');
    expect(effect).toBeGreaterThan(0);
    expect(earlyReturn).toBeGreaterThan(0);
    expect(effect).toBeLessThan(earlyReturn);
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

  /**
   * The second bug the GUI pass caught. Hiding the row while the agent streams
   * was implemented by UNMOUNTING it, so the next turn remounted a fresh
   * component: the row reappeared to someone who had just rated it, and
   * `pulseAskedAt` was re-stamped. The outcome has to outlive the component.
   */
  it("streaming HIDES the pulse, it does not unmount it, and 'done' is remembered by App", () => {
    // The mount decision must not mention busy — only `hidden` may.
    expect(app).toMatch(/show: !!pulseShow\[sid\] && !pulseDone\[sid\]/);
    expect(app).toMatch(/hidden: !!busy\[sid\]/);
    // App owns the outcome, so a remount cannot forget it.
    expect(app).toMatch(/onDone: \(\) => setPulseDone/);
    // The component renders nothing while hidden rather than returning early
    // from a lifecycle: its hooks still run.
    expect(pulse).toMatch(/if \(hidden \|\| phase\.k === "gone"/);
    // Both exits report done.
    expect(pulse.slice(pulse.indexOf("const dismiss"), pulse.indexOf("const pick"))).toMatch(/onDone\(\)/);
    expect(pulse.slice(pulse.indexOf("const pick"), pulse.indexOf("if (hidden"))).toMatch(/onDone\(\)/);
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
