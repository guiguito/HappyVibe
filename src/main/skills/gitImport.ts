import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

/**
 * §14 git-URL skill import — tarball-based, NO git binary (PRD decision). Main
 * downloads a forge's archive over HTTPS, extracts with the `tar` npm package,
 * and scans it for skills. The URL→archive mapping is PURE + unit-tested; the
 * download/extract is the impure part. SSH/private repos are V2.
 */

export interface ForgeArchive {
  /** HTTPS URL of the .tar.gz archive. */
  archiveUrl: string;
  host: string;
  owner: string;
  repo: string;
  /** Branch/tag/sha; "HEAD" (GitHub) or "main" default when the URL omits one. */
  ref: string;
}

/**
 * Map a forge repo URL to its archive endpoint. Supports GitHub (codeload),
 * GitLab, Bitbucket, Codeberg/Gitea. A `/tree/<ref>` or `@<ref>` suffix pins a
 * ref; otherwise the forge default is used. Returns null for unsupported hosts.
 */
export function parseForgeUrl(input: string): ForgeArchive | null {
  let u: URL;
  try {
    u = new URL(input.trim().replace(/\.git$/, ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const owner = segs[0];
  const repo = segs[1];
  // /tree/<ref> or /-/tree/<ref> (GitLab) pins a ref.
  let ref = "";
  const treeIdx = segs.indexOf("tree");
  if (treeIdx >= 0 && segs[treeIdx + 1]) ref = segs.slice(treeIdx + 1).join("/");

  if (host === "github.com" || host === "www.github.com") {
    const r = ref || "HEAD";
    return { archiveUrl: `https://codeload.github.com/${owner}/${repo}/tar.gz/${r}`, host: "github.com", owner, repo, ref: r };
  }
  if (host === "gitlab.com") {
    const r = ref || "main";
    return { archiveUrl: `https://gitlab.com/${owner}/${repo}/-/archive/${r}/${repo}-${r}.tar.gz`, host, owner, repo, ref: r };
  }
  if (host === "bitbucket.org") {
    const r = ref || "main";
    return { archiveUrl: `https://bitbucket.org/${owner}/${repo}/get/${r}.tar.gz`, host, owner, repo, ref: r };
  }
  if (host === "codeberg.org" || host.endsWith(".gitea.io") || host === "gitea.com") {
    const r = ref || "main";
    return { archiveUrl: `https://${host}/${owner}/${repo}/archive/${r}.tar.gz`, host, owner, repo, ref: r };
  }
  return null;
}

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MB guard against a runaway download

/** GET a URL to a file, following cross-host redirects (forge archives redirect a lot). */
function download(url: string, dest: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "HappyVibe" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error("too many redirects"));
        const next = new URL(res.headers.location, url).toString();
        resolve(download(next, dest, redirects - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`download failed: HTTP ${status}`));
      }
      let bytes = 0;
      res.on("data", (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_ARCHIVE_BYTES) {
          req.destroy();
          reject(new Error("archive exceeds 100 MB limit"));
        }
      });
      pipeline(res, fs.createWriteStream(dest)).then(resolve, reject);
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("download timed out")));
  });
}

export interface ExtractResult {
  /** Directory the archive was extracted into (contains one top-level repo dir). */
  root: string;
  /** sha256 of the downloaded tarball — the provenance "commit-or-archive hash". */
  archiveHash: string;
}

/**
 * Download `archive.archiveUrl` and extract it under `workDir` (created if
 * needed). Returns the extraction root + the tarball's sha256. Caller scans
 * `root` for skills and copies the chosen ones out.
 */
export async function downloadAndExtract(archive: ForgeArchive, workDir: string): Promise<ExtractResult> {
  fs.mkdirSync(workDir, { recursive: true });
  const tgz = path.join(workDir, "archive.tar.gz");
  await download(archive.archiveUrl, tgz);
  const archiveHash = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
  const root = path.join(workDir, "extracted");
  fs.mkdirSync(root, { recursive: true });
  // A downloaded archive is untrusted input. Extract FILES AND DIRECTORIES ONLY:
  // a symlink or hardlink entry can point outside the extraction root, which both
  // leaks content into a "skill" and (before removeSkillDir realpath'd its target)
  // could turn a later delete into a delete of whatever it pointed at.
  // `tar`'s own `..` protection stays on; this closes the link vector.
  await tar.x({
    file: tgz,
    cwd: root,
    // `tar` types this param as Stats | ReadEntry; on extract it is a ReadEntry
    // carrying `type`. Anything else is not our path, so allow it through rather
    // than silently extracting nothing.
    filter: (_p, entry) => (
      "type" in entry ? entry.type === "File" || entry.type === "Directory" : true
    ),
  });
  fs.rmSync(tgz, { force: true });
  return { root, archiveHash };
}
