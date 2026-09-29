/**
 * What to do with one `will-navigate` attempt.
 *
 * The rule used to live inline in index.ts and only PREVENTED navigation for
 * `http(s)`/`mailto`:
 *
 *     if (url !== current && /^(https?|mailto):/.test(url)) { preventDefault(); openExternal(url) }
 *
 * — so anything else fell through un-prevented. Most importantly a RELATIVE
 * markdown link, which resolves against the renderer's own URL: clicking one
 * replaced the whole SPA with a dead page, and since there is no in-app router
 * and no back affordance, the only way out was restarting the app. That was
 * reachable long before the Changelog page shipped one on purpose — from a link
 * in a chat answer, in a SKILL.md preview, or in any `.md` opened in the editor.
 *
 * So the guard belongs here, in front of every caller, rather than in whichever
 * page happens to render the link. Default is BLOCK: the only legitimate
 * navigation is to the URL already loaded, because the app has no router.
 *
 * `allow` is checked FIRST and matters in dev, where the renderer is served
 * over http — an "is it http?" test that ran first would hand the dev server's
 * own URL to the OS browser on every reload.
 */
export function navAction(url: string, current: string): "allow" | "external" | "block" {
  if (url === current) return "allow";
  return /^(https?|mailto):/i.test(url) ? "external" : "block";
}

/**
 * Docs in the app (2026-09-29): the script main injects into the User guide's frame each time it
 * loads, so a click on a link that leaves the guide reaches the system browser.
 *
 * It has to be a click handler INSIDE the frame. The renderer's CSP allows one frame origin, and
 * Chromium enforces `frame-src` before the browser process sees a frame navigation — so no
 * `will-frame-navigate` ever fires for an external link (measured in the running app), and the frame
 * is left on an error page. `window.open` from a sandboxed frame with `allow-popups` is different:
 * it reaches `setWindowOpenHandler`, which opens the system browser.
 *
 * Only http(s) and mailto links are rerouted; a link into the guide, a `javascript:` link or a
 * `file:` link is left to the frame's own sandbox and the CSP.
 */
export function guideLinkScript(base: string): string {
  return `(() => {
  if (window.__hvGuideLinks) return;
  window.__hvGuideLinks = true;
  const BASE = ${JSON.stringify(base)};
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.href.startsWith(BASE)) return;
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "mailto:") return;
    e.preventDefault();
    window.open(u.href, "_blank");
  }, true);
})()`;
}
