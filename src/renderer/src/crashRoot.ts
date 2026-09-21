/**
 * §37 — where the renderer's own code starts, so a frame is a path and not
 * `<external>`.
 *
 * The SDK marks a frame in-app when its URL begins with one of `appRoots`, and
 * its browser default is `location.origin`. In a packaged Electron app the page
 * is loaded from a FILE, so `origin` is the string `"file://"` — every frame in
 * the bundle sits under `file:///Applications/…/index.html` and matches nothing
 * useful, which would make every production renderer report frameless.
 *
 * Under `file:` the honest root is therefore the directory the page was loaded
 * from. In dev the page is served over http and `origin` is exactly right.
 *
 * Pure and location-shaped rather than reading `window`, so both cases are
 * asserted in the non-live suite — including that neither ever contains a
 * user's home directory.
 */
export function rendererAppRoot(loc: { protocol: string; origin: string; pathname: string }): string {
  if (loc.protocol !== "file:") return loc.origin;
  const i = loc.pathname.lastIndexOf("/");
  return i <= 0 ? loc.pathname : loc.pathname.slice(0, i);
}
