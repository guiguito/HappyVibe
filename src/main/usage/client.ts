/**
 * §39 — the electron-free seam (the crash/client.ts pattern). Everything in
 * main tracks through here; `usage/index.ts` plugs the SDK in at install.
 * Before install, with no key, or while the user has statistics off, `track`
 * is a no-op or the SDK drops the event — call sites never check.
 */
import { checkEvent } from "./guard";
import type { UsageEventName, UsageParams } from "./events";

type Sink = (name: string, category: string, params: UsageParams) => void;
let sink: Sink | null = null;
const seen = new Map<string, Set<string>>();

export function setUsageSink(fn: Sink | null): void {
  sink = fn;
}

export function track(name: UsageEventName, params: UsageParams = {}): void {
  const r = checkEvent(name, params);
  if (!r.ok) return; // the catalog is the contract; a bad call site loses its event, not the app
  try {
    sink?.(name, r.category, r.params);
  } catch {
    /* analytics never breaks a feature */
  }
}

/** First use per session+feature, whichever window or tool reported it. */
export function trackFeature(sessionId: string, feature: string, trigger: "user" | "agent"): void {
  let s = seen.get(sessionId);
  if (!s) seen.set(sessionId, (s = new Set()));
  if (s.has(feature)) return;
  s.add(feature);
  track("feature_used", { feature, trigger });
}

export function forgetSessionFeatures(sessionId: string): void {
  seen.delete(sessionId);
}

/** A key reported once per process (e.g. a failure that every respawn would repeat). */
export class OnceSet {
  private keys = new Set<string>();
  first(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
  forget(key: string): void {
    this.keys.delete(key);
  }
}
