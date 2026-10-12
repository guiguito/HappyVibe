// The user guide's v1 shots (.claude/rules/docs.md; Notion: Documentation → Media). One shot per run:
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
/** Made by onboarding's "Start fresh…" with the name lemonade-stand, filled by demo-project.sh. MEDIA_PROJECT puts it elsewhere. */
const PROJECT = process.env.MEDIA_PROJECT ?? `${homedir()}/Documents/HappyVibe/lemonade-stand`;

const RUNNING = `!!document.querySelector('[title="Stop the agent"]')`;
const DIALOG = `!!document.querySelector('[role="dialog"]')`;

/** The workspace "+" is a menu on a git project ("New session or worktree"); its first item starts "New session". */
const newSession = async (d) => {
  await d.clickSel('[title="New session or worktree"]');
  await d.click("New session", { match: "start" });
  await d.waitForText("Ready when you are.");
};

/** Sends a prompt, answers every approval with `answer` (after `pause` ms on screen), and waits for the turn to end. */
async function runTurn(d, prompt, answer, { pause = 0 } = {}) {
  await d.type(prompt);
  await d.press("Enter");
  await d.waitFor(() => d.evaluate(RUNNING), 30_000, "the turn to start");
  while (await d.evaluate(RUNNING)) {
    if (await d.evaluate(DIALOG)) {
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

// "Don't list the folder": an `ls -l` card prints the Mac user name as the file owner.
const HELLO = "Create hello.txt with a short welcome note. Don't list or read anything first.";
/** Read-only, so it runs without an approval: the turn keeps the "working" state on screen for a few seconds. */
const READ_ONLY = "Use the read tool, not bash, on index.html, style.css and README.md, then describe the site in three bullets.";

const SHOTS = {
  // Fresh profile, no local model running. Onboarding opens by itself and moves from Welcome to Setup after 2.5 s.
  "onboarding-setup": async (d) => {
    await d.waitForText("Pick a project", 30_000);
    await d.waitForText("Sign in with a plan");
    await d.sleep(1500); // the steps' entrance
    // With Ollama running a third choice wraps onto a second row and the 540 px dialog hides step 3: give it the 44 px it needs.
    await d.evaluate(`document.querySelector(".hv-dialog").style.height = "584px"`);
    await d.sleep(400);
    await d.shot(`${OUT}first-launch/onboarding-setup.png`);
  },

  // Step 3, after steps 1 and 2 are done by hand (Task 4). Refuses the small-model preset: it is saved on sight.
  "onboarding-kit": async (d) => {
    await d.waitFor(() => d.find("Continue"), 30_000, "step 3's Continue button");
    if (await d.evaluate(`document.body.innerText.includes("starting with just the basics")`)) {
      throw new Error("step 3 opened on the small-model preset — the default model is wrong; reset the profile (Task 4)");
    }
    await d.sleep(1500); // the tiles' entrance and the measured weights
    await d.shot(`${OUT}first-launch/onboarding-kit.png`);
    await d.click("Continue");
    await d.click("Start my first session", { timeout: 15_000 });
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
      () => runTurn(d, "Edit index.html directly, no need to look around: add a footer saying Open Mon-Fri 10am-6pm. Then run ./scripts/check.sh.", "Allow for session"),
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

  // check.sh sleeps 8 s, so the second message is still queued when the shot is taken.
  "queued-take-back": async (d) => {
    await newSession(d);
    await d.type("Run ./scripts/check.sh right away, without reading it first, and tell me what it prints.");
    await d.press("Enter");
    await d.waitForText("The agent wants to run something", 60_000);
    await d.click("Allow");
    await d.waitForText("Running: ./scripts/check.sh", 30_000); // the card, while the 8 s sleep runs; its output only shows at the end
    await d.type("Then add one line about it to README.md.", { delay: 15 });
    await d.press("Enter");
    await d.waitFor(() => d.find("Take back"), 5_000, "the queued chip's Take back");
    await d.sleep(400);
    await d.shot(`${OUT}first-session/queued-take-back.png`);
    await d.click("Take back"); // the README edit isn't wanted
    await d.waitFor(async () => !(await d.evaluate(RUNNING)), 120_000, "the turn to end");
  },

  // Forks the last message of the session queued-take-back left open, then cancels with Esc.
  "fork-dialog": async (d) => {
    await d.hover('[aria-label="Fork from here"]', { last: true });
    await d.clickSel('[aria-label="Fork from here"]', { last: true });
    await d.waitForText("Fork from this message?");
    await d.sleep(600);
    await d.shot(`${OUT}session-view/fork-dialog.png`);
    await d.press("Escape");
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

  // The row's expand button starts with a "›" glyph, so it is found by aria-expanded and its text.
  "builtin-tools": async (d) => {
    await d.openView("Built-in tools", "Abilities");
    await d.clickSel("button[aria-expanded]", { text: "Plan mode" });
    await d.waitForText("can't be edited");
    await d.shot(`${OUT}built-in-tools/builtin-tools.png`);
  },

  // The lower half of the same screen: MCP, Sub-agents with Workflows under it, Skills, Core tools.
  "builtin-switches": async (d) => {
    await d.openView("Built-in tools", "Abilities");
    await d.evaluate(`[...document.querySelectorAll("*")]
      .find((e) => e.children.length === 0 && e.textContent.startsWith("Lets the agent use the tools of your MCP servers"))
      ?.scrollIntoView({ block: "start" })`);
    await d.sleep(500);
    await d.shot(`${OUT}built-in-tools/builtin-switches.png`);
  },

  "plugins-marketplace": async (d) => {
    await d.openView("Plugins", "Abilities");
    await d.waitForText("verified to install here", 60_000);
    await d.sleep(1000); // card images
    await d.shot(`${OUT}plugins/plugins-marketplace.png`);
  },

  // The card's text starts with its monogram ("P\nPlaywright…"), hence "includes".
  "mcp-add": async (d) => {
    await d.openView("MCP", "Abilities");
    await d.waitForText("Add a server");
    const fps = await d.record(`${WORK}mcp-add/`, async () => {
      await d.click("Playwright", { match: "includes" });
      await d.waitForText("Add Playwright?");
      await d.sleep(1200);
      await d.click("Add Playwright");
      await d.waitForText("Connected to Playwright", 30_000);
      await d.sleep(1500);
    });
    encode("mcp-add", "mcp", fps);
  },

  "privacy-switches": async (d) => {
    await d.openView("Privacy", "App features");
    await d.waitForText("Usage statistics");
    // the third switch (Feedback) sits just under the fold: scroll the page up until it shows
    await d.evaluate(`document.querySelector("main .overflow-y-auto")?.scrollBy(0, 100)`);
    await d.sleep(400);
    await d.shot(`${OUT}privacy/privacy-switches.png`);
  },

  // Not a shot: opens sessions until the app puts one to sleep (8 run at once), for sidebar-workspaces.
  "fill-sessions": async (d) => {
    for (let i = 0; i < 10 && !(await d.evaluate(`!!document.querySelector('[title^="Sleeping"]')`)); i++) {
      await newSession(d);
      await runTurn(d, "Say hello in three words.", "Allow");
    }
    await d.waitFor(() => d.evaluate(`!!document.querySelector('[title^="Sleeping"]')`), 30_000, "a sleeping session");
  },

  // Plan mode on in one session and a second workspace come from Task 7. A read-only turn shows "working…".
  "sidebar-workspaces": async (d) => {
    await newSession(d);
    await d.type(READ_ONLY);
    await d.press("Enter");
    await d.waitFor(() => d.evaluate(`!!document.querySelector('[title="working…"]')`), 30_000, "the working mark");
    await d.clickSel('[title="New session or worktree"]', { last: true }); // the last workspace's +, so the menu opens over empty sidebar
    await d.waitFor(() => d.find("New session", { match: "start" }), 5_000, "the + menu");
    await d.sleep(300);
    await d.shot(`${OUT}workspaces-and-sessions/sidebar-workspaces.png`);
    await d.press("Escape");
    for (let i = 0; i < 240 && (await d.evaluate(RUNNING)); i++) {
      if (await d.evaluate(DIALOG)) await d.click("Deny");
      await d.sleep(500);
    }
  },

  // The split with README.md open beside the session is set by hand first (Task 7).
  "session-view": async (d) => {
    await d.waitForText("Ready when you are.", 1).catch(() => {}); // any finished session works
    await d.shot(`${OUT}session-view/session-view.png`);
  },

  // The changes left by the session shots (footer, hello.txt) are still uncommitted. The file row is the one in the
  // Changes panel (session cards say index.html too); it opens beside the session as a preview, and the editor's
  // middle button turns that into the diff. ponytail: the button is clicked by position (348, 65), the first pane's toolbar.
  "changes-panel": async (d) => {
    await d.clickSel('[title^="Show the Changes panel"]');
    const row = await d.waitFor(
      () => d.evaluate(`(() => {
        const e = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === "index.html" && e.getBoundingClientRect().x > 1000);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x + 10, y: r.y + r.height / 2 };
      })()`),
      10_000,
      "index.html in the Changes panel",
    );
    for (const at of [row, { x: 348, y: 65 }]) {
      await d.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
      for (const type of ["mousePressed", "mouseReleased"]) await d.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
      await d.sleep(900);
    }
    await d.clickSel('[title^="Write it for me"]');
    await d.waitFor(
      () => d.evaluate(`[...document.querySelectorAll("textarea")].some((t) => t.value.length > 10 && !/^(Ask for a change|Steer the agent)/.test(t.placeholder))`),
      60_000,
      "a drafted commit message",
    );
    await d.sleep(400);
    await d.shot(`${OUT}files-and-changes/changes-panel.png`);
  },

  // The two schedules and their run are made by hand first (Task 7).
  "schedules-list": async (d) => {
    await d.clickSel("[data-hv-schedules-row]");
    await d.sleep(800);
    await d.shot(`${OUT}schedules/schedules-list.png`);
  },

  // The demo rules and the test box's verdict are set by hand first (Task 8).
  "permissions-rules": async (d) => {
    await d.openView("Permissions", "Control");
    await d.waitForText("Evaluated by the same engine that enforces them.");
    await d.shot(`${OUT}permissions/permissions-rules.png`);
  },

  // Not a shot: one denied call, so the Audit log has a denial to show.
  "deny-one": async (d) => {
    await newSession(d);
    await runTurn(d, "Run git push origin main right now, without asking me anything first.", "Deny", { pause: 800 });
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
