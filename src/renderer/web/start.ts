/**
 * Web mode — the app, started only once the preload (web.html's script before
 * this one) has set up `window.hv`.
 *
 * A DYNAMIC import on purpose. A static one makes the app's chunk a dependency
 * of this entry, and an ES module's dependencies run BEFORE it: the app would
 * evaluate ahead of the preload and work only because React happens to render a
 * tick later. Worse, a page that must stop (no token, a server that restarted)
 * would still boot the app against nothing and show its crash screen over the
 * preload's own message. Here, a preload that throws means this never runs.
 */
void import("../src/main");
