/**
 * §34 — what travels beside a feedback answer, and NOTHING else.
 *
 * ALLOWLISTS, not blocklists: a caller can hand these functions any object and
 * only the named keys come out. That inversion is the whole design — a blocklist
 * has to be updated every time a caller grows a field, and the failure is
 * silent. This is the code PRD §27's "privacy is enforced in code, not promised
 * in copy" points at for feedback, and the tests are what make the dialog's
 * disclosure line true.
 *
 * Every string that leaves is a version, an enum, or a short id. Never a
 * session title, a workspace path, a prompt, a file name, a tool argument.
 *
 * Sizes are bounded by construction rather than checked at the end: Inlet caps
 * clientContext at 16 KiB (limits.ts clientContextMaxBytes) and a rejected
 * submission would lose the user's words.
 */
export interface HostFacts {
  appVersion: string;
  channel: "dev" | "prod";
  os: { platform: string; version: string; release: string; arch: string };
  electron: string;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export interface SessionFacts {
  sittingMs: number;
  turns: number;
  messages: number;
  contextTokens: number | null;
  contextWindow: number | null;
  compactions: number;
}

/** Inlet's ceiling for the whole clientContext, serialized as UTF-8. */
export const CONTEXT_MAX_BYTES = 16 * 1024;

/** Every allowlisted string is a version or an enum; 64 chars is generous for all of them. */
const SHORT = 64;

const short = (s: unknown): string => String(s ?? "").slice(0, SHORT);
const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

function hostBlock(h: HostFacts): Record<string, unknown> {
  return {
    appVersion: short(h.appVersion),
    channel: h.channel === "prod" ? "prod" : "dev",
    os: {
      platform: short(h.os?.platform),
      version: short(h.os?.version),
      release: short(h.os?.release),
      arch: short(h.os?.arch),
    },
    electron: short(h.electron),
  };
}

function modelBlock(m: ModelRef | null | undefined): { model?: ModelRef } {
  return m && m.provider && m.id ? { model: { provider: short(m.provider), id: short(m.id) } } : {};
}

/**
 * The renderer's `View` id, clamped.
 *
 * `view` is the one field that comes from renderer state rather than from main's
 * own facts, so it is the one field a bug could turn into a path or a title.
 * The pattern admits exactly what Sidebar's `View` union looks like.
 */
export function clampView(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z][a-z0-9/-]{0,39}$/.test(v) ? v : undefined;
}

export function generalContext(host: HostFacts, extra: { view?: string; model?: ModelRef | null }): Record<string, unknown> {
  const view = clampView(extra.view);
  return { ...hostBlock(host), ...(view ? { view } : {}), ...modelBlock(extra.model) };
}

export function pulseContext(host: HostFacts, s: SessionFacts, model: ModelRef | null): Record<string, unknown> {
  return {
    ...hostBlock(host),
    ...modelBlock(model),
    session: {
      sittingMs: num(s.sittingMs),
      turns: num(s.turns),
      messages: num(s.messages),
      // null right after a compaction, exactly as the gauge shows "measuring…".
      // Never stats.tokens, which is cumulative-since-session-start.
      contextTokens: num(s.contextTokens),
      contextWindow: num(s.contextWindow),
      compactions: num(s.compactions),
    },
  };
}
