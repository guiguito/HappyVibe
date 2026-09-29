import { DOCS_BASE } from "./docsBase";

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
 * Docs in the app (2026-09-29): what to do with a SUBFRAME navigation. `will-navigate` never fires
 * for a subframe, and the User guide is an iframe whose CSP allows no other origin — so a link in
 * the guide that leaves it would leave a blank frame. Only a frame that is showing the guide is
 * judged: the editor's sandboxed HTML preview (`about:srcdoc`) and a frame's initial load
 * (`about:blank`) pass through untouched.
 */
export function frameNavAction(frameUrl: string, url: string): "allow" | "external" | "block" {
  if (!frameUrl.startsWith(DOCS_BASE)) return "allow";
  if (url.startsWith(DOCS_BASE)) return "allow";
  return /^(https?|mailto):/i.test(url) ? "external" : "block";
}
