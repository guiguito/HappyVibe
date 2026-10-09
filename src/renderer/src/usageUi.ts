/**
 * §39 — the window's usage facts, as pure functions: what leaves is counts
 * and booleans, never the text.
 */
import type { UsageParams } from "../../main/usage/events";

export function onboardingStep(s: { welcome: boolean; modelReady: boolean; workspaceReady: boolean }): "welcome" | "setup_model" | "setup_workspace" | "handover" {
  if (s.welcome) return "welcome";
  if (!s.modelReady) return "setup_model";
  if (!s.workspaceReady) return "setup_workspace";
  return "handover"; // unreachable since the kit (Esc = Start, no ✕); kept so old events still validate
}

export function promptFlags(p: {
  text: string;
  planMode: boolean;
  images: number;
  documents: number;
  mentions: number;
  queued: boolean;
  viaVoice: boolean;
  templateNames: ReadonlySet<string>;
}): UsageParams | null {
  const t = p.text.trim();
  if (!t || t.startsWith("/hv-")) return null;
  const cmd = /^\/([A-Za-z0-9._-]+)/.exec(t)?.[1];
  return {
    planMode: p.planMode,
    attachments: p.images + p.documents,
    fileMentions: p.mentions,
    usedTemplate: !!cmd && p.templateNames.has(cmd),
    viaVoice: p.viaVoice,
    queued: p.queued,
  };
}

/**
 * A panel OPENED in this session — not a session switch that happens to show
 * an open panel (the prop is `open && sid === selected`, so switching flips it
 * for one render before App resets it).
 */
export function panelJustOpened(prev: { open: boolean; sid: string | null } | null, now: { open: boolean; sid: string | null }): boolean {
  return !!prev && now.open && !prev.open && prev.sid === now.sid;
}
