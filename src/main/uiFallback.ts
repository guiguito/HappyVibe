/**
 * Answer blocking `extension_ui_request`s that no HappyVibe UI will ever show.
 *
 * Pi extensions ask the host for UI via `ctx.ui.*`; the blocking kinds await an
 * `extension_ui_response` carrying their id. Main routes those by envelope —
 * `JSON.parse(title).kind === "hv.*"` — and forwards everything else to the
 * renderer, whose parse guards all return null for a payload they don't know.
 * So a third-party extension's `ctx.ui.confirm("Trust X?")` is forwarded,
 * rendered by nobody, and never answered: its await never settles. Sitting in
 * a tool_call or session_start handler, that freezes the turn or the session
 * with no error and no UI.
 *
 * docs/validation/d1.md already states the invariant for our own envelopes
 * ("Main MUST always respond … never leave the bridge blocked"); this enforces
 * it for everyone else's.
 *
 * ponytail: a prefix test, not a registry of known kinds — main would drift
 * from the renderer's guard list. Switch to an explicit kind registry only if
 * we ever ship an hv.* blocking request the renderer deliberately ignores.
 */

/**
 * Blocking `ctx.ui.*` methods — these register in Pi's `pendingExtensionRequests`
 * and await a response (rpc-mode.js). Everything else (`notify`, `setStatus`,
 * `setWidget`, `setTitle`, `set_editor_text`) is fire-and-forget and must NEVER
 * be answered: d1.md:77 documents responding to a notify as a protocol error.
 */
export const BLOCKING_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

/**
 * True when a request blocks the extension but carries no `hv.*` envelope, so
 * no HappyVibe surface will ever answer it.
 *
 * The `hv.` prefix is the whole test. Our own blocking prompts (`hv.permission`
 * select, `hv.ask-user` / `hv.auth` input) reach the very same fallthrough and
 * are answered later, when the user clicks — treating those as unhandled would
 * auto-deny every permission prompt in the app.
 */
export function isUnhandledBlockingUi(r: { method?: string; title?: string }): boolean {
  if (!r.method || !BLOCKING_UI_METHODS.has(r.method)) return false;
  try {
    const kind = (JSON.parse(r.title ?? "") as { kind?: unknown } | null)?.kind;
    return typeof kind !== "string" || !kind.startsWith("hv.");
  } catch {
    return true; // not JSON at all — a plain human-readable title, i.e. foreign
  }
}

/**
 * The one response shape that means cancel/deny for all four blocking methods:
 * Pi maps it to `false` for `confirm` and `undefined` for select/input/editor
 * (rpc-mode.js parseResponse). `undefined` already falls through to deny in the
 * bridge's own permission path, so this is consistent with how we treat a
 * dismissed prompt.
 */
export const UI_CANCEL_RESPONSE = { cancelled: true } as const;
