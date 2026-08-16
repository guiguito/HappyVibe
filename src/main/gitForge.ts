/**
 * §29 §7 (amended 2026-08-16) — the prefilled pull-request URL.
 *
 * HappyVibe does not CREATE pull requests: it opens the forge's own "new pull
 * request" form, in the user's own browser, with the title and body already
 * filled in. That distinction is the whole reason this is in scope at all —
 * §5/§6 keep GitHub out of V1 and §29 promises "no auth UI of ours", and this
 * needs no credential, stores no token and posts nothing. The user is already
 * signed in where the page opens, and still presses Create themselves.
 *
 * (It has to be the EXTERNAL browser. The embedded §28 pane runs on its own
 * `persist:hv-browser` partition — a separate cookie jar — so the user is not
 * signed in there.)
 *
 * Pure and Electron-free: this is where the risk lives, because a wrong URL
 * fails as a 404 in someone's browser rather than as an exception we could
 * catch. tests/git-forge.test.ts pins every shape.
 */

export interface Remote {
  host: string;
  /** Full project path, so a GitLab subgroup (`group/sub/repo`) survives. */
  path: string;
}

/**
 * GitHub answers `414 URI Too Long` past its server limit and documents no
 * threshold, so the body is capped rather than trusted. 4000 leaves ample room
 * for the origin, the compare range and the title inside any sane limit.
 */
export const BODY_CAP = 4000;

/**
 * Parse the three remote forms git actually hands out. Anything else — a local
 * path, junk, a URL with no project — is `null`, which is what hides the button.
 */
export function parseRemote(url: string): Remote | null {
  const raw = url.trim();
  if (!raw) return null;

  // scp-like: git@host:owner/repo.git — not a URL, so it is matched first.
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw);
  if (scp) return finish(scp[1], scp[2]);

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    return finish(u.hostname, u.pathname);
  } catch {
    return null;
  }
}

function finish(host: string, rawPath: string): Remote | null {
  const path = rawPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  // A project needs at least owner/repo; a bare host is not one.
  if (!path || !path.includes("/")) return null;
  return { host: host.toLowerCase(), path };
}

export interface PrRequest {
  host: string;
  path: string;
  /** The branch being merged INTO. */
  base: string;
  /** The branch being proposed. */
  head: string;
  title: string;
  body: string;
}

/**
 * The forge's prefilled form, or null when we do not recognise the host.
 *
 * Null is a feature: a self-hosted GitLab or a Gitea would need a URL shape we
 * have not verified, and guessing produces a 404 in the user's face. The button
 * is simply absent instead — the app's "don't show what cannot work" rule.
 */
export function pullRequestUrl(req: PrRequest): string | null {
  const { host, path, base, head, title } = req;
  const body = capBody(req.body);

  if (host === "github.com") {
    // Documented: /compare/[base]...[head] plus title/body/quick_pull.
    // The range is a PATH segment, so it is encoded per-branch — encodeURI
    // would leave a `?` or `#` in a branch name live.
    const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`.replace(/%2F/g, "/");
    const q = new URLSearchParams({ quick_pull: "1", title });
    if (body) q.set("body", body);
    return `https://github.com/${path}/compare/${range}?${q.toString()}`;
  }

  if (host === "gitlab.com") {
    const q = new URLSearchParams({
      "merge_request[source_branch]": head,
      "merge_request[target_branch]": base,
      "merge_request[title]": title,
    });
    if (body) q.set("merge_request[description]", body);
    return `https://gitlab.com/${path}/-/merge_requests/new?${q.toString()}`;
  }

  if (host === "bitbucket.org") {
    // No documented description parameter. Omitted rather than invented: a key
    // that silently does nothing is worse than an absent one, because the next
    // person assumes it works.
    const q = new URLSearchParams({ source: head, dest: base, title });
    return `https://bitbucket.org/${path}/pull-requests/new?${q.toString()}`;
  }

  return null;
}

/** Truncate on a line boundary where one is near the cut, else hard-cut. */
function capBody(body: string): string {
  if (body.length <= BODY_CAP) return body;
  const slice = body.slice(0, BODY_CAP - 1);
  const nl = slice.lastIndexOf("\n");
  // Only prefer the line boundary when it does not throw away most of the text.
  const cut = nl > BODY_CAP * 0.6 ? slice.slice(0, nl + 1) : slice;
  return `${cut}…`;
}

/**
 * A branch name as a readable PR title, for when the model is unavailable and
 * the branch holds several commits (one commit uses its own subject instead).
 *
 * `feature/add-pr-button` → `Add pr button`. Deliberately dumb: it is a
 * starting point in an editable field, not a guess at prose.
 */
export function humaniseBranch(branch: string): string {
  const last = branch.split("/").filter(Boolean).pop() ?? branch;
  const words = last.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return branch;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
