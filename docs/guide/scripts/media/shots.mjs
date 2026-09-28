// The user guide's v1 shots (Notion: Documentation → Media). One shot per run:
//   node shots.mjs <shot-id>        run it
//   node shots.mjs                  print the order; some shots create the state later ones need
// MEDIA_OUT and MEDIA_WORK override where files land, e.g. under /Users/Shared when run as `demo`.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { connect } from "./cdp.mjs";

const OUT = process.env.MEDIA_OUT ?? new URL("../../public/media/", import.meta.url).pathname;
const WORK = process.env.MEDIA_WORK ?? new URL("../../.media-work/", import.meta.url).pathname;
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
/** Made by onboarding's "Start fresh…" with the name lemonade-stand, filled by demo-project.sh. */
const PROJECT = `${homedir()}/Documents/HappyVibe/lemonade-stand`;

const newSession = async (d) => {
  await d.click("New session");
  await d.waitForText("Ready when you are.");
};

/** Sends a prompt, answers every approval with `answer` (after `pause` ms on screen), and waits for the turn to end. */
async function runTurn(d, prompt, answer, { pause = 0 } = {}) {
  await d.type(prompt);
  await d.press("Enter");
  const running = () => d.evaluate(`!!document.querySelector('[title="Stop the agent"]')`);
  await d.waitFor(running, 30_000, "the turn to start");
  while (await running()) {
    if (await d.evaluate(`!!document.querySelector('[role="dialog"]')`)) {
      await d.sleep(pause);
      await d.click(answer);
    }
    await d.sleep(250);
  }
}

/** Frames → MP4 and WebM at 1440 wide, holding the last frame a second so the loop lands; the poster is the last frame. */
function encode(id, slug, fps) {
  mkdirSync(`${OUT}${slug}`, { recursive: true });
  const frames = `${WORK}${id}/%05d.jpg`;
  const base = `${OUT}${slug}/${id}`;
  const vf = "scale=1440:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=1";
  const rate = ["-framerate", fps.toFixed(2), "-i", frames];
  execFileSync(FFMPEG, ["-y", ...rate, "-vf", `${vf},format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-an", `${base}.mp4`]);
  execFileSync(FFMPEG, ["-y", ...rate, "-vf", vf, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-an", `${base}.webm`]);
  execFileSync(FFMPEG, ["-y", "-sseof", "-0.1", "-i", `${base}.mp4`, "-frames:v", "1", "-q:v", "3", `${base}.jpg`]);
  console.log(`saved ${base}.{mp4,webm,jpg}`);
}

const HELLO = "Create hello.txt with a short welcome note.";

const SHOTS = {
  // Fresh profile. Onboarding opens by itself and moves from Welcome to Setup after 2.5 s.
  "onboarding-setup": async (d) => {
    await d.waitForText("Pick a project", 30_000);
    await d.sleep(1500); // the steps' entrance
    await d.shot(`${OUT}first-launch/onboarding-setup.png`);
  },

  "models-populated": async (d) => {
    await d.openView("Models");
    await d.waitForText("Default model");
    await d.shot(`${OUT}models/models-populated.png`);
  },

  // A still picked from PNG frames: the edit card done, the command card running, "Steer the agent…", no dialog.
  "session-running": async (d) => {
    await newSession(d);
    await d.record(
      `${WORK}session-running/`,
      () => runTurn(d, "Add a footer with the opening hours to index.html, then run ./scripts/check.sh.", "Allow for session"),
      { fps: 3, format: "png" },
    );
    console.log(`now pick a frame and copy it to ${OUT}first-session/session-running.png`);
  },

  "permission-modal": async (d) => {
    rmSync(`${PROJECT}/hello.txt`, { force: true });
    await newSession(d);
    await d.type(HELLO);
    await d.press("Enter");
    await d.waitForText("The agent wants to run something", 60_000);
    await d.sleep(600); // the dialog's entrance
    await d.shot(`${OUT}approve-a-tool-call/permission-modal.png`);
    await d.click("Allow");
  },

  "permission-approve": async (d) => {
    rmSync(`${PROJECT}/hello.txt`, { force: true });
    await newSession(d);
    const fps = await d.record(`${WORK}permission-approve/`, async () => {
      await runTurn(d, HELLO, "Allow", { pause: 1500 });
      await d.sleep(1200);
    });
    encode("permission-approve", "approve-a-tool-call", fps);
  },

  "memory-save-prompt": async (d) => {
    await newSession(d);
    await d.type("Remember that I prefer tabs over spaces in this project.");
    await d.press("Enter");
    await d.waitForDialog();
    await d.sleep(600);
    await d.shot(`${OUT}memory/memory-save-prompt.png`);
    await d.click("Allow");
  },

  "builtin-tools": async (d) => {
    await d.openView("Built-in tools", "Abilities");
    await d.click("Plan mode", { startsWith: true }); // expands the row to its read-only prompt
    await d.waitForText("built-in prompt");
    await d.shot(`${OUT}built-in-tools/builtin-tools.png`);
  },

  "plugins-marketplace": async (d) => {
    await d.openView("Plugins", "Abilities");
    await d.waitForText("verified to install here", 60_000);
    await d.sleep(1000); // card images
    await d.shot(`${OUT}plugins/plugins-marketplace.png`);
  },

  "mcp-add": async (d) => {
    await d.openView("MCP", "Abilities");
    await d.waitForText("Add a server");
    const fps = await d.record(`${WORK}mcp-add/`, async () => {
      await d.click("Playwright", { startsWith: true });
      await d.waitForText("Add Playwright?");
      await d.sleep(1200);
      await d.click("Add Playwright");
      await d.waitForText("Connected to Playwright", 30_000);
      await d.sleep(1500);
    });
    encode("mcp-add", "mcp", fps);
  },

  // The demo rules and the test box's verdict are set by hand first (Task 7).
  "permissions-rules": async (d) => {
    await d.openView("Permissions", "Control");
    await d.waitForText("Evaluated by the same engine that enforces them.");
    await d.shot(`${OUT}permissions/permissions-rules.png`);
  },

  // Not a shot: one denied call, so the Audit log has a denial to show.
  "deny-one": async (d) => {
    await newSession(d);
    await runTurn(d, "Delete the .git folder so the history starts over.", "Deny", { pause: 800 });
  },

  "audit-log": async (d) => {
    await d.openView("Audit log", "The record");
    await d.waitForText("Every permission decision");
    await d.shot(`${OUT}audit-log/audit-log.png`);
  },
};

const ORDER = Object.keys(SHOTS);
const id = process.argv[2];
if (!id || !SHOTS[id]) {
  console.log(`usage: node shots.mjs <shot-id>\nin order: ${ORDER.join(" → ")}`);
  process.exit(id ? 1 : 0);
}
const d = await connect();
await d.viewport(2);
await SHOTS[id](d);
process.exit(0);
