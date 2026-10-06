/**
 * §10 round 25 — a waiting prompt is noticed from outside the app too.
 * Pure: main applies the plan with Electron (ipc.ts). The OS branching lives
 * here and takes `platform.name` as input, so `process.platform` stays in platform.ts.
 */
export const ATTENTION_BODY = "A session is waiting for your answer";

export interface AttentionInput {
  platform: NodeJS.Platform;
  /** Blocking prompts waiting across every session (main's pendingUi). */
  total: number;
  /** A NEW prompt arrived with this change (not an answer, not a replay). */
  arrived: boolean;
  /** Any HappyVibe window has focus. */
  focused: boolean;
  /** The one-time macOS notification already went out (config flag). */
  notified: boolean;
}

export interface AttentionPlan {
  /** Count to show on the Dock / launcher; null where there is no badge API (Windows). */
  badge: number | null;
  /** Windows taskbar dot on/off; null elsewhere. */
  overlay: boolean | null;
  bounce: boolean;
  flash: boolean;
  /** Post the one notification that makes macOS ask for permission (the badge needs it). */
  notify: boolean;
}

export function attentionPlan(i: AttentionInput): AttentionPlan {
  const ping = i.arrived && !i.focused;
  if (i.platform === "darwin") return { badge: i.total, overlay: null, bounce: ping, flash: false, notify: ping && !i.notified };
  if (i.platform === "win32") return { badge: null, overlay: i.total > 0, bounce: false, flash: ping, notify: false };
  return { badge: i.total, overlay: null, bounce: false, flash: ping, notify: false };
}

/** A filled red circle, BGRA, for `nativeImage.createFromBitmap` — no asset file to ship. */
export function dotBitmap(size: number): Buffer {
  const b = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 > r * r) continue;
      b.set([0x2b, 0x3b, 0xe0, 0xff], (y * size + x) * 4); // B, G, R, A
    }
  }
  return b;
}
