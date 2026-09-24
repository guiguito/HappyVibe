/**
 * `npm run release:mac` — PRD §4/§38: the macOS leg of a release, run on the
 * maintainer's Mac, because that is where the Developer ID and the notarization
 * credentials live (login keychain only; nothing Apple-shaped is in GitHub).
 *
 * Refuses BEFORE a ten-minute build: dirty tree, HEAD not tagged v<version>,
 * no Developer ID Application cert, no `happyvibe` notarytool profile, no
 * GH_TOKEN. Then builds, signs (afterPack signs pi-runtime, electron-builder the
 * rest), notarizes, staples, uploads into the DRAFT CI created from the tag, and
 * verifies. Exits non-zero on any failure — never pipe it to `tail`.
 *
 *   GH_TOKEN=$(gh auth token) npm run release:mac
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROFILE = "happyvibe";

export function macReleasePreflight(f) {
  const problems = [];
  const tag = `v${f.version}`;
  if (!f.clean) problems.push("The working tree has uncommitted changes — a release builds exactly what the tag points at.");
  if (!f.headTags.includes(tag))
    problems.push(`HEAD is not tagged ${tag} (package.json says ${f.version}). Run /release first, then push the tag.`);
  const m = /"(Developer ID Application: [^"]+)"/.exec(f.identities ?? "");
  if (!m)
    problems.push(
      "No \"Developer ID Application\" certificate in the keychain (an Apple Development cert cannot notarize). " +
        "Xcode → Settings → Accounts → your team → Manage Certificates → + → Developer ID Application.",
    );
  if (!f.profileOk)
    problems.push(
      `No notarytool profile "${PROFILE}". Run: xcrun notarytool store-credentials ${PROFILE} --apple-id <id> --team-id <team> --password <app-specific password>`,
    );
  if (!f.ghToken) problems.push("GH_TOKEN is not set — it uploads into the draft release. GH_TOKEN=$(gh auth token) npm run release:mac");
  return problems.length ? { ok: false, problems } : { ok: true, identity: m[1] };
}

export function missingMacArtifacts(files, version) {
  const want = [
    `HappyVibe-${version}-arm64.dmg`,
    `HappyVibe-${version}-arm64-mac.zip`,
    `HappyVibe-${version}-arm64-mac.zip.blockmap`,
    "latest-mac.yml",
  ];
  return want.filter((w) => !files.includes(w));
}

function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" });
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const pre = macReleasePreflight({
    clean: sh("git", ["status", "--porcelain"]).trim() === "",
    headTags: sh("git", ["tag", "--points-at", "HEAD"]).split("\n").filter(Boolean),
    version,
    identities: sh("security", ["find-identity", "-v", "-p", "codesigning"]),
    profileOk: spawnSync("xcrun", ["notarytool", "history", "--keychain-profile", PROFILE], { stdio: "ignore" }).status === 0,
    ghToken: process.env.GH_TOKEN,
  });
  if (!pre.ok) {
    for (const p of pre.problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`[release:mac] ${version}, signing as ${pre.identity}`);

  // A stale latest-mac.yml from an earlier build would pass the artifact check.
  rmSync(path.join(root, "release"), { recursive: true, force: true });
  const run = (cmd, args, env = {}) => {
    const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
    if (r.status !== 0) {
      console.error(`✗ ${cmd} ${args.join(" ")} exited ${r.status}`);
      process.exit(1);
    }
  };
  run("npm", ["run", "build"]);
  run(
    "npx",
    [
      "electron-builder",
      "--mac",
      "--publish",
      "always",
      // electron-builder wants the name without its type prefix.
      `-c.mac.identity=${pre.identity.replace(/^Developer ID Application: /, "")}`,
      "-c.mac.notarize=true",
    ],
    { HV_MAC_IDENTITY: pre.identity, APPLE_KEYCHAIN_PROFILE: PROFILE, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  );

  const missing = missingMacArtifacts(readdirSync(path.join(root, "release")), version);
  if (missing.length) {
    console.error(`✗ Missing from release/: ${missing.join(", ")} — the updater cannot use this build.`);
    process.exit(1);
  }
  const app = path.join(root, "release", "mac-arm64", "HappyVibe.app");
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const spctl = spawnSync("spctl", ["-a", "-vv", app], { encoding: "utf8" });
  const out = `${spctl.stdout}${spctl.stderr}`;
  if (spctl.status !== 0 || !/source=Notarized Developer ID/.test(out)) {
    console.error(`✗ Gatekeeper did not accept it as notarized:\n${out}`);
    process.exit(1);
  }
  console.log(`✓ ${version} signed, notarized and uploaded. Read the draft on GitHub, then Publish.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
