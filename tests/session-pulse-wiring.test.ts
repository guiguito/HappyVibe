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

  it("it sits directly ABOVE THE COMPOSER, not in the banner rail, and still yields to banners", () => {
    const at = chat.indexOf("<SessionPulse");
    // Below the banner block it yields to...
    expect(at).toBeGreaterThan(chat.indexOf("suggestCompact && ("));
    // ...and immediately before the composer form, which is where the user is looking.
    const form = chat.indexOf("{/* Composer */}");
    expect(form).toBeGreaterThan(at);
    // Nothing else is rendered between the pulse and the composer.
    const afterPulse = chat.indexOf("/>", chat.indexOf("onOpenDialog={pulse.onOpenDialog}"));
    expect(chat.slice(afterPulse, form)).not.toMatch(/<[A-Z]\w+/);
    expect(chat.slice(at - 500, at)).toMatch(/crashed === null && !suggestCompact/);
  });

  /** Minimal by request: a caption and the scale, centred. No rail, no tone, no paragraph. */
  it("the row is a centred caption plus the emoji, with the disclosure one hover away", () => {
    expect(pulse).toMatch(/justify-center/);
    // No bottom padding: the composer's own pt-2 is the whole gap, or the row
    // floats away from the bar it belongs to.
    expect(pulse).not.toMatch(/px-6 pb-\d/);
    // The dismiss glyph recedes, but its hit area does not shrink with it.
    expect(pulse).toMatch(/text-\[10px\][^"]*p-1 -m-1/);
    expect(pulse).not.toMatch(/border-b-2/);
    // The disclosure is a promise about what travels — kept as a title, never dropped.
    expect(pulse).toMatch(/title=\{C\.disclosure\}/);
    // ...and never as a second visible line under the question.
    expect(pulse).not.toMatch(/<span className="text-xs text-ink-soft">\{C\.disclosure\}<\/span>/);
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
