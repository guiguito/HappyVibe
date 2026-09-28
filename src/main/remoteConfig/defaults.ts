/**
 * §39 — the in-app defaults, shared by main and the renderer. Imports NOTHING:
 * the renderer imports it, and a runtime import here puts node:* in the
 * browser bundle (CLAUDE.md "Import hygiene").
 *
 * `web_default_service` fails OPEN: it applies before the first fetch, offline
 * and during an Inlet outage, and an outage must not switch a free feature off
 * for everyone. It is a cost lever, not a security control.
 */
export const CONFIG_DEFAULTS = { web_default_service: true } as const;
