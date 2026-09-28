/**
 * §39 — defence in depth. `track()` calls `checkEvent` before anything is
 * queued, and `usageBeforeSend` re-checks every envelope main's client is
 * about to queue, including the ones a window sent. An event that fails is
 * DROPPED, never trimmed: a trimmed event is an event whose shape we did not
 * design.
 */
import { SCREENS, STANDARD_EVENTS, USAGE_EVENTS, type Category, type ParamSpec, type UsageParams } from "./events";

/** A catalog id or `custom`: letters, digits, `.`, `_`, `-`, `:`. No `/`, no space — so never a path, a URL or a sentence. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const valueOk = (p: ParamSpec, v: unknown): boolean => {
  if (p.type === "bool") return typeof v === "boolean";
  if (p.type === "number") return typeof v === "number" && Number.isFinite(v);
  if (p.type === "enum") return typeof v === "string" && p.values.includes(v);
  return typeof v === "string" && ID.test(v);
};

const EVENTS = USAGE_EVENTS as unknown as Record<string, { category: Category; params: Record<string, ParamSpec> }>;
const STANDARD = STANDARD_EVENTS as Record<string, readonly string[]>;

export function checkEvent(
  name: string,
  params: UsageParams = {},
): { ok: true; category: Category; params: UsageParams } | { ok: false; reason: string } {
  const spec = Object.hasOwn(EVENTS, name) ? EVENTS[name] : undefined;
  if (!spec) return { ok: false, reason: `unknown event ${name}` };
  for (const [k, v] of Object.entries(params)) {
    const p = Object.hasOwn(spec.params, k) ? spec.params[k] : undefined;
    if (!p) return { ok: false, reason: `${name}: unknown param ${k}` };
    if (!valueOk(p, v)) return { ok: false, reason: `${name}.${k}: value refused` };
  }
  return { ok: true, category: spec.category, params };
}

export function usageBeforeSend<E extends { name: string; params?: Record<string, unknown> }>(env: E): E | null {
  const std = Object.hasOwn(STANDARD, env.name) ? STANDARD[env.name] : undefined;
  if (std) {
    if (Object.keys(env.params ?? {}).some((k) => !std.includes(k))) return null;
    if (env.name === "screen_viewed" && !(SCREENS as readonly string[]).includes(String(env.params?.screen))) return null;
    return env;
  }
  return checkEvent(env.name, env.params as UsageParams | undefined).ok ? env : null;
}
