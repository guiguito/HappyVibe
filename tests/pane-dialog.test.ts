import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { SCOPED_CONTENT, SCOPED_OVERLAY, VIEWPORT_CONTENT, VIEWPORT_OVERLAY, dialogHost } from "../src/renderer/src/paneDialog";

/**
 * §7 round 21 — the permission prompt and the ask-user dialog open over the
 * pane of the session that raised them, so neither lies across a browser pane.
 */

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("a HIDDEN pane is not a host — the dialog must fall back to the viewport", () => {
  // The chat pane wrapper is `hidden` whenever the user is on a settings page.
  // Portalling a permission prompt into a hidden element makes it invisible,
  // and permission prompts NEVER time out — the agent would hang forever with
  // nothing on screen. This is the one failure mode that must not exist.
  expect(dialogHost({ offsetParent: null, getClientRects: () => [] } as unknown as HTMLElement)).toBeNull();
  expect(dialogHost(null)).toBeNull();
  expect(dialogHost(undefined)).toBeNull();
});

test("a visible pane IS a host", () => {
  const el = { offsetParent: {}, getClientRects: () => [{ width: 400, height: 300 }] } as unknown as HTMLElement;
  expect(dialogHost(el)).toBe(el);
});

test("a zero-sized pane is not a host either", () => {
  const el = { offsetParent: {}, getClientRects: () => [] } as unknown as HTMLElement;
  expect(dialogHost(el)).toBeNull();
});

test("scoped uses absolute; viewport keeps fixed", () => {
  expect(SCOPED_OVERLAY).toContain("absolute");
  expect(SCOPED_OVERLAY).not.toMatch(/\bfixed\b/);
  expect(VIEWPORT_OVERLAY).toContain("fixed");
});

test("both variants keep the dialog layer classes that own z-index 100", () => {
  for (const c of [SCOPED_OVERLAY, VIEWPORT_OVERLAY]) expect(c).toContain("hv-overlay");
  for (const c of [SCOPED_CONTENT, VIEWPORT_CONTENT]) expect(c).toContain("hv-dialog");
});

test("a scoped dialog is CLAMPED to its pane and scrolls inside it", () => {
  // A narrow pane must not push the dialog out over its neighbour — which is
  // the browser pane this whole change exists to stop covering.
  expect(SCOPED_CONTENT).toContain("max-w-[calc(100%-1.5rem)]");
  expect(SCOPED_CONTENT).toContain("max-h-[calc(100%-1.5rem)]");
  expect(SCOPED_CONTENT).toContain("overflow-y-auto");
});

test("only the two SESSION dialogs are scoped", () => {
  const app = read("src/renderer/src/App.tsx");
  expect([...app.matchAll(/container=\{paneHost\(/g)]).toHaveLength(2);
  // App's OTHER dialogs belong to the app, not to a session, so they have no
  // pane to sit over and must stay viewport-centred.
  for (const other of ["AgentsMdPanel", "OnboardingDialog"]) {
    const at = app.indexOf(`<${other}`);
    expect(at, `${other} must be rendered`).toBeGreaterThan(-1);
    expect(app.slice(at, at + 500)).not.toContain("container=");
  }
  // And no dialog anywhere else in the renderer grew one either — AuthFlowModal
  // is mounted by ModelsView and OnboardingDoors, not by App.
  for (const f of ["src/renderer/src/components/ModelsView.tsx", "src/renderer/src/components/OnboardingDoors.tsx"]) {
    expect(read(f)).not.toContain("container={");
  }
});

test("the chat pane wrapper is POSITIONED, or an absolute dialog lands elsewhere", () => {
  const app = read("src/renderer/src/App.tsx");
  const at = app.indexOf("data-hv-pane-session={sid}");
  expect(at).toBeGreaterThan(-1);
  expect(app.slice(at, at + 900)).toMatch(/className=\{`relative /);
});

test("the two modals take their positioning from the shared module", () => {
  for (const f of ["src/renderer/src/components/PermissionModal.tsx", "src/renderer/src/components/AskUserModal.tsx"]) {
    const src = read(f);
    expect(src).toContain("SCOPED_OVERLAY");
    expect(src).toContain("VIEWPORT_OVERLAY");
    // And neither hard-codes its own positioning any more.
    expect(src).not.toContain("hv-overlay fixed inset-0");
  }
});
