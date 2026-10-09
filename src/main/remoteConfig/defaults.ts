/**
 * §39 — the in-app defaults, shared by main and the renderer. Imports NOTHING:
 * the renderer imports it, and a runtime import here puts node:* in the
 * browser bundle (CLAUDE.md "Import hygiene").
 *
 * `web_default_service` fails CLOSED (Privacy round, 2026-10-09, reversing the
 * 2026-09-27 fail-open): the free box runs only on a remote yes, so a client that
 * never checked — remote settings off, an env lock, a fresh install whose first
 * check hasn't answered — can't load the server the maintainer pays for. The SDK
 * keeps its last answer on disk, so an outage or going offline doesn't flip a
 * device that has checked once.
 */
export const CONFIG_DEFAULTS = { web_default_service: false } as const;
