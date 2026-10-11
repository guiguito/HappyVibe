# User guide v1 media — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user guide's 21 v1 shots, 19 screenshots and 2 videos, into `docs/guide/public/media/`, checked and free of private data. Then replace each page's `TODO(media)` placeholder with its file (Task 10).

**Architecture:**
- **Capture:** a small Chrome DevTools Protocol driver (`docs/guide/scripts/media/cdp.mjs`) connects to the packaged app, started with `--remote-debugging-port`.
  - It fixes the page to 1440 × 900 points at 2×, clicks and types like a person, and saves screenshots.
  - It refuses to capture if a key, an email or someone else's home path is on screen.
  - For videos it records frames, which ffmpeg turns into MP4, WebM and a JPG poster.
- **Shots:** one routine per shot in `shots.mjs`, run in order, because some shots create the state later ones need.
- **Where it runs:** a separate macOS user, `demo`, so the profile is fresh and no real session, key or path is on screen.
- **Checks:** `check-media.mjs` verifies the delivered files, and a frame-by-frame review closes it.

**Tech Stack:** Node 22 (built-in `WebSocket` and `fetch`), the Chrome DevTools Protocol, ffmpeg/ffprobe (`/opt/homebrew/bin`), a packaged HappyVibe build, Ollama, and a Windows x64 machine or VM for one shot.

**Spec:** Notion, "Documentation" → **Media**: capture rules, the v1 shot list, demo state, shooting order. https://app.notion.com/p/3e8d33dfffca80a28eb9f1a83b4b2e8a. The repo's copy of the list, with each shot's alt text, is the table in `.claude/rules/docs.md`; `grep -rn "TODO(media)" docs/guide/src/content/docs/` lists where each one goes.

**Where it fits:** the user guide is on `main` (it shipped with 0.1.0). Shoot from a build of the current `main`, or of `docs/guide-since-0.1.0` until it merges, so the app matches the guide's text.

**Revised 2026-10-11** against the app at `c4a151d`. The selectors were re-checked in src. The changes:
- the Settings section and its groups start closed
- group headers are CSS-uppercased
- the workspace **+** opens a menu
- onboarding has a step 3 and a "You're in." screen
- 9 shots were added: 5 for Everyday use and step 3, and 4 for features added since 0.1.0

## Global Constraints

- **Build:** a packaged build (`npm run package`, output `release/mac-arm64/HappyVibe.app`), never `npm run dev`. Dev builds rebrand the app.
- **Account:** the macOS user `demo`, so any path on screen reads `/Users/demo/…`.
- **Screenshots:** PNG, 2880 × 1800 (1440 × 900 points at 2×), the whole window. The one exception is `install-smartscreen`, which is a Windows dialog cropped to its window.
- **Videos:**
  - 15 seconds at most, no audio, 1440 px wide
  - the last frame held for a second so the loop lands
  - MP4 (H.264), WebM (VP9) and a JPG poster
- **Files:** `docs/guide/public/media/<slug>/<shot-id>.<ext>`, exactly the paths in `.claude/rules/docs.md`.
- **Never on screen:** API keys or tokens, sign-in URLs, device codes, account emails, `KEY=value` lines, real home paths, real prompts, memories or session titles.
- **Throwaway key:** use a throwaway API key, passed only through the environment, and revoke it at the end.
- **Browser pane:** no v1 shot includes one. A plain `Page.captureScreenshot` leaves a pane blank. If a shot ever needs one, use the two-stream overlay in `.claude/skills/demo-recording/`.
- **Commits:** on a `docs/` branch, each one `git commit -s`.

## Review Focus

1. **Something private on screen at capture time.** The shot must refuse to save. Covered by Task 1's guard test, which injects an email and expects a refusal.
2. **Capture is slower than 12 fps.** The video must still play in real time: `record()` measures the real rate and `encode()` uses it. Covered by Task 1's smoke run, which prints the measured rate.
3. **A dialog captured mid-entrance.** A faded, half-scaled dialog must never ship. Routines wait 600 ms after a dialog appears, and Task 9's frame review catches the rest.
4. **Playwright's first `npx` download pushes `mcp-add` past 15 seconds.** Task 2 pre-warms the package, and `check-media.mjs` fails any clip over 15 seconds.
5. **A delivered file with the wrong name, size, codec or an audio track.** `check-media.mjs` names the file and the problem (Task 1 writes it, Task 9 runs it).
6. **The small-model preset at step 3.** If the default model's context window is small (Ollama's 1B model), step 3 opens with every tile unticked, and that choice is SAVED the moment the step opens (`App.tsx`, `basicsPatch()`). Every later shot would then show a profile with its tools off. `onboarding-kit` refuses to shoot when it sees "starting with just the basics". Task 4 makes sure Claude is the default before step 3.
7. **A local model running before the first launch.** Onboarding counts a running Ollama as a connected model, so step 1 opens already ticked and its three choices never show. Task 2 quits Ollama before the first launch.

---

### Task 1: The capture tools

**Files:**
- Create: `docs/guide/scripts/media/cdp.mjs`, `docs/guide/scripts/media/shots.mjs`, `docs/guide/scripts/media/demo-project.sh`, `docs/guide/scripts/check-media.mjs`
- Modify: `docs/guide/.gitignore`, `docs/guide/package.json` (a `check:media` script)

**Interfaces:**
- Produces: `connect(): Promise<Driver>`, where `Driver` is:
  - `send`, `evaluate(expr)`, `sleep(ms)`
  - `find(text, { match })` and `click(text, { match, timeout })`. `match` is `"exact"` (the default), `"start"` or `"includes"`, always case-insensitive.
  - `clickSel(css, { text, last, timeout })` and `hover(css, { last })`
  - `waitFor(probe, timeout, what)`, `waitForText(text, timeout)`, `waitForDialog(timeout)`
  - `type(text, { delay })`, `press(key)`
  - `viewport(scale)`, `guard()`, `shot(file)`
  - `record(dir, act, { fps, format }) → Promise<number>` (the measured fps)
  - `openView(label, group)`
- Produces: `node shots.mjs <shot-id>`, one routine per shot, and `node shots.mjs` to print the order.

- [ ] **Step 1: Write the check first** — `docs/guide/scripts/check-media.mjs`

```js
// The v1 media (.claude/rules/docs.md; Notion: Documentation → Media), checked before Task 10 places it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MEDIA = new URL("../public/media/", import.meta.url).pathname;
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const STILLS = [
  "install/install-smartscreen",
  "first-launch/onboarding-setup",
  "first-launch/onboarding-kit",
  "models/models-populated",
  "first-session/session-running",
  "first-session/queued-take-back",
  "approve-a-tool-call/permission-modal",
  "memory/memory-save-prompt",
  "built-in-tools/builtin-tools",
  "built-in-tools/builtin-switches",
  "plugins/plugins-marketplace",
  "permissions/permissions-rules",
  "audit-log/audit-log",
  "workspaces-and-sessions/sidebar-workspaces",
  "session-view/session-view",
  "session-view/fork-dialog",
  "files-and-changes/changes-panel",
  "schedules/schedules-list",
  "privacy/privacy-switches",
];
const CLIPS = ["approve-a-tool-call/permission-approve", "mcp/mcp-add"];

for (const s of STILLS) {
  const f = `${MEDIA}${s}.png`;
  assert.ok(existsSync(f), `missing ${s}.png`);
  const b = readFileSync(f);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${s}.png is not a PNG`);
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (s !== "install/install-smartscreen") assert.deepEqual([w, h], [2880, 1800], `${s}.png is ${w}×${h}, want 2880×1800`);
}

const probe = (f) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", f], { encoding: "utf8" }));
for (const c of CLIPS) {
  for (const [ext, codec] of [["mp4", "h264"], ["webm", "vp9"]]) {
    const f = `${MEDIA}${c}.${ext}`;
    assert.ok(existsSync(f), `missing ${c}.${ext}`);
    const p = probe(f);
    const v = p.streams.find((s) => s.codec_type === "video");
    assert.ok(!p.streams.some((s) => s.codec_type === "audio"), `${c}.${ext} has an audio track`);
    assert.equal(v.codec_name, codec, `${c}.${ext} is ${v.codec_name}, want ${codec}`);
    assert.equal(v.width, 1440, `${c}.${ext} is ${v.width} px wide, want 1440`);
    assert.ok(Number(p.format.duration) <= 15, `${c}.${ext} runs ${p.format.duration} s, max 15`);
  }
  assert.ok(existsSync(`${MEDIA}${c}.jpg`), `missing ${c}.jpg (the poster)`);
}
console.log(`media check: ${STILLS.length} stills, ${CLIPS.length} clips OK`);
```

In `docs/guide/package.json`'s `scripts`, add:

```json
    "check:media": "node scripts/check-media.mjs",
```

Append to `docs/guide/.gitignore`:

```gitignore
# Raw frames and review stills from scripts/media/, never shipped.
.media-work/
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd docs/guide && npm run check:media`
Expected: FAIL, `missing install/install-smartscreen.png`.

- [ ] **Step 3: The driver** — `docs/guide/scripts/media/cdp.mjs`

```js
// Drives the HappyVibe app over the Chrome DevTools Protocol and captures it, for the user guide's media.
// ponytail: raw CDP over Node 22's built-in WebSocket, as hv-demo-media/shoot2.mjs does. No Playwright.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT = process.env.CDP_PORT ?? "9222";
/** The app's renderer: index.html in a packaged build, the Vite server in dev. Browser panes are other targets. */
const IS_APP = /index\.html|localhost:5173\/?$/;

export async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const app = targets.find((t) => t.type === "page" && IS_APP.test(t.url));
  if (!app) throw new Error(`no app page among: ${targets.map((t) => t.url).join(", ")}`);
  const ws = new WebSocket(app.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return driver(send);
}

function driver(send) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

  const waitFor = async (probe, timeout, what) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await probe();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(200);
    }
  };
  const waitForText = (text, timeout = 30_000) =>
    waitFor(() => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), timeout, `"${text}"`);
  const waitForDialog = (timeout = 60_000) =>
    waitFor(() => evaluate(`!!document.querySelector('[role="dialog"]')`), timeout, "a dialog");

  /** Scrolls the element into view and returns its centre. `pick` is a JS expression over `els`. */
  const centre = (selector, filter, pick) =>
    evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .filter((e) => e.getBoundingClientRect().width > 0 && (${filter}));
      const el = ${pick};
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);

  const CLICKABLE = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], summary, label';
  /**
   * The first visible clickable element whose text matches, case-insensitively. Case-insensitive
   * because the sidebar's group headers are CSS-uppercased and innerText returns "ABILITIES".
   * "includes" is for rows whose text starts with a glyph: the "›" of a prompt row, a catalog
   * card's monogram ("P\nPlaywright…").
   */
  const find = (text, { match = "exact" } = {}) => {
    const want = JSON.stringify(text.toLowerCase());
    const test = { exact: `t === ${want}`, start: `t.startsWith(${want})`, includes: `t.includes(${want})` }[match];
    return centre(CLICKABLE, `((t) => ${test})((e.innerText ?? "").trim().toLowerCase())`, "els[0]");
  };

  /** A real mouse click, so the app sees exactly what a person's click produces. */
  const mouseClick = async (at) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    await sleep(300);
  };

  const click = async (text, { match = "exact", timeout = 10_000 } = {}) =>
    mouseClick(await waitFor(() => find(text, { match }), timeout, `a clickable "${text}"`));

  /** Clicks by selector (a title, an aria-label), optionally only where the text includes `text`, or the last match. */
  const clickSel = async (css, { text, last = false, timeout = 10_000 } = {}) => {
    const filter = text ? `(e.innerText ?? "").toLowerCase().includes(${JSON.stringify(text.toLowerCase())})` : "true";
    mouseClick(await waitFor(() => centre(css, filter, last ? "els.at(-1)" : "els[0]"), timeout, css));
    await sleep(300);
  };

  /** Moves the mouse over an element, for controls that appear on hover. */
  const hover = async (css, { last = false } = {}) => {
    const at = await waitFor(() => centre(css, "true", last ? "els.at(-1)" : "els[0]"), 10_000, css);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await sleep(300);
  };

  /**
   * Opens a sidebar screen. Every screen sits in the Settings section, closed on a fresh profile,
   * and a closed group isn't in the page at all. Pinned rows (Models) need no group.
   */
  const openView = async (label, group) => {
    if (!(await find(label)) && !(await find(group ?? label))) await click("Settings");
    if (group && !(await find(label))) await click(group);
    await click(label);
    await sleep(500);
  };

  /** Types into the visible composer one character at a time, so a recording shows the typing. */
  const type = async (text, { delay = 35 } = {}) => {
    const ok = await evaluate(`(() => {
      const t = [...document.querySelectorAll("textarea")]
        .find((e) => e.getBoundingClientRect().width > 0 && /^(Ask for a change|Steer the agent)/.test(e.placeholder));
      t?.focus();
      return !!t;
    })()`);
    if (!ok) throw new Error("no visible composer");
    for (const ch of text) {
      await send("Input.insertText", { text: ch });
      await sleep(delay);
    }
  };

  const press = async (key) => {
    const k =
      key === "Enter" ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }
      : key === "Escape" ? { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }
      : { key, code: key };
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, ...k });
  };

  /** 1440 × 900 points at `scale`, whatever size the real window is. */
  const viewport = (scale = 2) =>
    send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });

  /** Refuses to capture anything private. Tooltips aren't in innerText; the frame review in Task 9 covers them. */
  const guard = async () => {
    const text = await evaluate("document.body.innerText");
    const rules = [
      ["an API key", /\bsk-[A-Za-z0-9_-]{8,}/],
      ["an email address", /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
      ["a home path that is not /Users/demo", /\/Users\/(?!demo\b)[\w.-]+/],
      ["a KEY=value line", /\b[A-Z][A-Z0-9_]{2,}=\S+/],
    ];
    for (const [what, re] of rules) {
      const m = text.match(re);
      if (m) throw new Error(`refusing to capture: ${what} is on screen ("${m[0].slice(0, 12)}…")`);
    }
  };

  const shot = async (file) => {
    await guard();
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`saved ${file}`);
  };

  /** Saves frames into `dir` while `act()` runs, and returns the real frame rate for encoding. */
  const record = async (dir, act, { fps = 12, format = "jpeg" } = {}) => {
    mkdirSync(dir, { recursive: true });
    await guard();
    let n = 0;
    let done = false;
    const t0 = Date.now();
    const loop = (async () => {
      while (!done) {
        const started = Date.now();
        const { data } = await send("Page.captureScreenshot", format === "png" ? { format } : { format, quality: 90 });
        writeFileSync(`${dir}/${String(++n).padStart(5, "0")}.${format === "png" ? "png" : "jpg"}`, Buffer.from(data, "base64"));
        const wait = 1000 / fps - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    })();
    try {
      await act();
    } finally {
      done = true;
      await loop;
    }
    await guard();
    const real = n / ((Date.now() - t0) / 1000);
    console.log(`${n} frames at ${real.toFixed(1)} fps in ${dir}`);
    return real;
  };

  return { send, evaluate, sleep, find, click, clickSel, hover, openView, waitFor, waitForText, waitForDialog, type, press, viewport, guard, shot, record };
}
```

- [ ] **Step 4: The shots** — `docs/guide/scripts/media/shots.mjs`

```js
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
/** Made by onboarding's "Start fresh…" with the name lemonade-stand, filled by demo-project.sh. */
const PROJECT = `${homedir()}/Documents/HappyVibe/lemonade-stand`;

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

const HELLO = "Create hello.txt with a short welcome note.";
/** Read-only, so it runs without an approval: the turn keeps the "working" state on screen for a few seconds. */
const READ_ONLY = "Read index.html, style.css and README.md, then describe the site in three bullets.";

const SHOTS = {
  // Fresh profile, no local model running. Onboarding opens by itself and moves from Welcome to Setup after 2.5 s.
  "onboarding-setup": async (d) => {
    await d.waitForText("Pick a project", 30_000);
    await d.waitForText("Sign in with a plan");
    await d.sleep(1500); // the steps' entrance
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

  // check.sh sleeps 8 s, so the second message is still queued when the shot is taken.
  "queued-take-back": async (d) => {
    await newSession(d);
    await d.type("Run ./scripts/check.sh and tell me what it prints.");
    await d.press("Enter");
    await d.waitForText("The agent wants to run something", 60_000);
    await d.click("Allow");
    await d.waitForText("Checking index.html", 30_000);
    await d.type("Then add one line about it to README.md.");
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
    await d.clickSel('[title="New session or worktree"]');
    await d.waitFor(() => d.find("New session", { match: "start" }), 5_000, "the + menu");
    await d.sleep(300);
    await d.shot(`${OUT}workspaces-and-sessions/sidebar-workspaces.png`);
    await d.press("Escape");
    await d.waitFor(async () => !(await d.evaluate(RUNNING)), 120_000, "the turn to end");
  },

  // The split with README.md open beside the session is set by hand first (Task 7).
  "session-view": async (d) => {
    await d.waitForText("Ready when you are.", 1).catch(() => {}); // any finished session works
    await d.shot(`${OUT}session-view/session-view.png`);
  },

  // The changes left by the session shots (footer, hello.txt) are still uncommitted.
  "changes-panel": async (d) => {
    await d.clickSel('[title^="Show the Changes panel"]');
    await d.click("index.html", { match: "includes" });
    await d.clickSel('[title="What changed since your last save"]');
    await d.clickSel('[aria-label="Write it for me"]');
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
```

The workspace **+** opens its menu on mouse press, which `mouseClick`'s `mousePressed` sends. If **Fork from here** never gets a size because it only shows on hover, `hover()` first is what reveals it.

- [ ] **Step 5: The demo project** — `docs/guide/scripts/media/demo-project.sh`

```sh
#!/bin/sh
# The neutral project every v1 session shot runs in. Usage: demo-project.sh <folder>
# The folder comes from onboarding's "Start fresh…" (~/Documents/HappyVibe/lemonade-stand).
set -eu
cd "$1"
cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Lemonade Stand</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Lemonade Stand</h1>
  <p>Fresh lemonade, squeezed to order.</p>
  <ul>
    <li>Classic — 2.00</li>
    <li>Mint — 2.50</li>
  </ul>
</body>
</html>
EOF
cat > style.css <<'EOF'
body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; background: #fffbe6; color: #3b3000; }
h1 { color: #d49b00; }
EOF
printf '# Lemonade Stand\n\nA one-page site for a neighbourhood lemonade stand.\n' > README.md
mkdir -p scripts
# Takes a while on purpose: session-running catches a command card mid-run, queued-take-back queues behind it.
printf '#!/bin/sh\necho "Checking index.html…"\nsleep 8\necho "All links OK."\n' > scripts/check.sh
chmod +x scripts/check.sh
git init -q
git add -A
git -c user.name=Demo -c user.email=demo@localhost commit -qm "First version"
echo "demo project ready in $1"
```

- [ ] **Step 6: Smoke test against a dev app** (Review Focus 1 and 2)

In one terminal: `npx electron-vite dev --remoteDebuggingPort 9222`. In another, from `docs/guide/scripts/media/`:

```bash
node --input-type=module -e '
import { connect } from "./cdp.mjs";
const d = await connect();
await d.viewport(2);
console.log("title:", await d.evaluate("document.title"));
const { data } = await d.send("Page.captureScreenshot", { format: "png" });
const b = Buffer.from(data, "base64");
console.log("size:", b.readUInt32BE(16), "x", b.readUInt32BE(20));
await d.evaluate(`document.body.insertAdjacentHTML("beforeend", "<p id=hv-guard-test>someone@example.com</p>")`);
await d.shot("../../.media-work/should-not-exist.png").then(() => console.log("GUARD FAILED"), (e) => console.log("guard ok:", e.message));
await d.evaluate(`document.getElementById("hv-guard-test").remove()`);
await d.openView("Permissions", "Control");
console.log("openView:", await d.evaluate(`document.body.innerText.includes("Evaluated by the same engine")`));
console.log("fps:", (await d.record("../../.media-work/smoke", () => d.sleep(3000))).toFixed(1));
process.exit(0);'
```

Expected output:
- `title: HappyVibe`
- `size: 2880 x 1800`
- `guard ok: refusing to capture: an email address is on screen …`
- `openView: true`. This proves the Settings section, the uppercased group and the item all open.
- an `fps:` line: note the number, since it sets how smooth the videos will be

`GUARD FAILED` must not appear. If `--remoteDebuggingPort` is refused, run `npx electron-vite dev --help` and use the flag it lists for the remote-debugging port. The main checkout's own dev app runs on 9333, so 9222 is free (`.claude/rules/` and CLAUDE.md "Gotchas").

- [ ] **Step 7: Commit**

```bash
git add docs/guide/scripts/media docs/guide/scripts/check-media.mjs docs/guide/package.json docs/guide/.gitignore
git commit -s -m "Docs media: capture driver, the v1 shot routines, demo project, media check"
```

---

### Task 2: Set up the demo machine

**Human steps.** They need an admin password and your accounts.

- [ ] **Step 1:** Create a Standard macOS user named `demo` (System Settings → Users & Groups).
- [ ] **Step 2:** Make sure `/usr/local/bin/node` exists; if not, install Node 22 LTS from the nodejs.org `.pkg`, which installs for every user. Make sure Ollama is in `/Applications`. Both need admin.
- [ ] **Step 3: Build the app** and share it with the scripts

Run from your own account, at the app repo root:

```bash
npm run package
ditto release/mac-arm64/HappyVibe.app /Users/Shared/HappyVibe.app
mkdir -p /Users/Shared/hv-media && cp -R docs/guide/scripts/media /Users/Shared/hv-media/scripts
```

- [ ] **Step 4:** Create a throwaway DeepSeek API key. You'll paste it once, in Task 4.
- [ ] **Step 5: Log in as `demo`.** In Terminal:

```bash
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
export MEDIA_OUT=/Users/Shared/hv-media/out/ MEDIA_WORK=/Users/Shared/hv-media/work/
open -a Ollama && sleep 5 && ollama pull llama3.2:1b
osascript -e 'quit app "Ollama"'                                               # Review Focus 7
npx -y @playwright/mcp@latest --help >/dev/null && echo "playwright cached"   # Review Focus 4
```

The `export` lines apply to every later task run as `demo`. Re-run them in each new Terminal window. Check that Ollama is really gone (`pgrep -l ollama` prints nothing) before Task 4.

---

### Task 3: The Windows shot

**Human step.**

- [ ] **Step 1:** On a Windows x64 machine or VM, download `Setup.exe` from the latest GitHub release and run it.
- [ ] **Step 2:** When SmartScreen appears, click **More info**, so **Run anyway** shows. Don't click it yet.
- [ ] **Step 3:** Press Win+Shift+S, choose **Window**, and click the SmartScreen dialog. Save it as a PNG named `install-smartscreen.png`.
- [ ] **Step 4:** Copy the file to `/Users/Shared/hv-media/out/install/install-smartscreen.png` on the Mac.

---

### Task 4: Onboarding and Models

As `demo`, from `/Users/Shared/hv-media/scripts`. Wherever this task says "you", a person does it.

- [ ] **Step 1: Start the fresh app with the debug port**

```bash
open /Users/Shared/HappyVibe.app --args --remote-debugging-port=9222
sleep 3 && curl -s http://127.0.0.1:9222/json/list | grep -c index.html     # 1
```

If macOS asks for keychain access at any point, click **Always Allow**.

- [ ] **Step 2: Shoot the Setup step**

Run: `node shots.mjs onboarding-setup`
Expected: `saved …/first-launch/onboarding-setup.png`. It waits for the Setup step by itself. The shot must show step 1 open on **Sign in with a plan** and **Paste an API key**. For the third choice, **Free, on this computer**, run `open -a Ollama` once the setup screen is up, then click back into HappyVibe: the doors look again on focus. Then run the routine. (A model already running at launch ticks step 1 instead.) If step 1 is already ticked, a local model was running: quit it, run **Clear all data…** on **Privacy**, and start over.

- [ ] **Step 3: You do steps 1 and 2**
1. If you started Ollama for the shot, quit it first: `osascript -e 'quit app "Ollama"'`. Then step 1, **Sign in with a plan**: sign in to Claude in the browser. Claude becomes the default model, which keeps step 3 off the small-model preset (Review Focus 6). Don't start Ollama yet.
2. Step 2, **Start fresh…**: name it `lemonade-stand`, then **Create it**.

Step 3, "Personalize your agent", opens full width.

- [ ] **Step 4: Shoot step 3 and finish onboarding**

Run: `node shots.mjs onboarding-kit`
Expected: `saved …/first-launch/onboarding-kit.png`. The routine then clicks **Continue**, then **Start my first session**, and the app opens a session. If it refuses with "small-model preset", the default model isn't Claude: run **Clear all data…** and start Task 4 again.

- [ ] **Step 5: Fill the project**

Run: `sh demo-project.sh ~/Documents/HappyVibe/lemonade-stand`
Expected: `demo project ready in …`

- [ ] **Step 6: You connect the rest.** Run `open -a Ollama`. Then, on **Models**:
- Paste the throwaway key into the DeepSeek card and **Save**.
- Set **Default model** to a DeepSeek model.
- Check Ollama's row reads "running".

- [ ] **Step 7: Shoot Models**

Run: `node shots.mjs models-populated`
Expected: saved. If the guard refuses, it names what it saw. Remove that from the screen, never the guard, and re-run.

---

### Task 5: The session shots

As `demo`, with no permission rules yet, so every edit and command asks.

- [ ] **Step 1:** Run `node shots.mjs session-running`. Expected: about 3 PNG frames a second in `work/session-running/`.
- [ ] **Step 2: Pick the still**

Open the frames and find one that shows:
- the footer edit's card, done
- `./scripts/check.sh` running, pulsing
- the composer reading "Steer the agent — lands between tool calls…"
- no dialog

Copy it:

```bash
cp /Users/Shared/hv-media/work/session-running/<frame>.png /Users/Shared/hv-media/out/first-session/session-running.png
```

- [ ] **Step 3:** Run `node shots.mjs permission-modal`. Expected: saved, and the agent then creates `hello.txt`.
- [ ] **Step 4:** Run `node shots.mjs permission-approve`. Expected: an fps line, then `saved …/approve-a-tool-call/permission-approve.{mp4,webm,jpg}`. Watch the MP4: the typing, the dialog held for about 1.5 s, Allow, the card turning done. If a take runs past 15 s or the model wanders, run it again.
- [ ] **Step 5:** Run `node shots.mjs queued-take-back`. Expected: saved, with the ↪ chip, "queued · kept on stop" and **Take back** above the message box while `check.sh` runs. If the model answers before the second message is typed, run it again.
- [ ] **Step 6:** Run `node shots.mjs fork-dialog`, straight after Step 5 in the same session. Expected: saved, the dialog showing **Conversation only** and **Conversation and files**. **Conversation and files** only shows when a file can be rolled back; if it's missing, run it from the `session-running` session instead.
- [ ] **Step 7:** Run `node shots.mjs memory-save-prompt`. Expected: saved. The memory is saved after the shot.

---

### Task 6: The Abilities and Privacy shots

- [ ] **Step 1:** Run `node shots.mjs builtin-tools`. If the click toggles Plan mode off instead of expanding it, turn it back on in the app. Then list the buttons with `node --input-type=module -e 'import { connect } from "./cdp.mjs"; const d = await connect(); console.log(await d.evaluate("[...document.querySelectorAll(\"button[aria-expanded]\")].map(b => b.innerText.trim()).filter(Boolean).join(\" | \")")); process.exit(0)'`, point the routine at the right one and re-run.
- [ ] **Step 2:** Run `node shots.mjs builtin-switches`. Expected: saved, with **MCP** at the top of the window and **Core tools** visible. Workflows reads off: that is the default.
- [ ] **Step 3:** Run `node shots.mjs plugins-marketplace`. Network must be on.
- [ ] **Step 4:** Run `node shots.mjs mcp-add`. Expected: `saved …/mcp/mcp-add.{mp4,webm,jpg}`, and the app's MCP page lists Playwright as connected. The dialog lists tool names only: that's how the app shows them.
- [ ] **Step 5:** Run `node shots.mjs privacy-switches`. Expected: saved, every switch on (nothing was turned off on this profile).

---

### Task 7: The Everyday use shots

These need state a script can't make: the folder picker is a native dialog, and schedules take real time.

- [ ] **Step 1: You add a second workspace.** In Finder, make `~/Documents/HappyVibe/recipe-cards` with one `README.md`, then `cd` there and run `git init -q && git add -A && git -c user.name=Demo -c user.email=demo@localhost commit -qm "First version"`. In the app, click **Add workspace folder** in the sidebar and pick it.
- [ ] **Step 2: You turn on plan mode** in one `lemonade-stand` session: click **🧭 Plan** in its message box.
- [ ] **Step 3:** Run `node shots.mjs fill-sessions`. Expected: it opens short sessions until one shows ☾ ("Sleeping — opens right where you left off").
- [ ] **Step 4:** Run `node shots.mjs sidebar-workspaces`. Expected: saved, showing the 🧭 session, a ☾ session, a "working…" dot, both workspaces, and the **+** menu open on **New session**. If the turn ends before the menu opens, run it again.
- [ ] **Step 5: You set up the split.** Open a `lemonade-stand` session with a finished turn. Click **Split this pane — side by side** in its tab strip, and open `README.md` in the new pane from the files panel. Close the files panel again.
- [ ] **Step 6:** Run `node shots.mjs session-view`.
- [ ] **Step 7:** Run `node shots.mjs changes-panel`. Expected: saved, with the Changes panel, `index.html`'s diff and a drafted commit message. Don't save the version.
- [ ] **Step 8: You make two schedules** on **Schedules**, both in `lemonade-stand`:
  - "Run ./scripts/check.sh and report the result." every 5 minutes.
  - "Summarise what changed in this project today." daily at 18:00.
  Wait for the first one to run once, and answer its approval with **Allow**.
- [ ] **Step 9:** Run `node shots.mjs schedules-list`. Then delete the 5-minute schedule, so it stops running.

---

### Task 8: Rules, a denial, the Audit log

- [ ] **Step 1: You add three rules** on **Control** → **Permissions**, then **Save rules**:

| Type | Pattern | Action |
|---|---|---|
| command | `npm test` | allow |
| command | `git push*` | ask |
| path | `**/.env` | deny |

Then type `git push origin main` in the test box and click **Evaluate**, so a verdict shows.

- [ ] **Step 2:** Run `node shots.mjs permissions-rules`.
- [ ] **Step 3:** Run `node shots.mjs deny-one`. This takes no shot; it records one denied call.
- [ ] **Step 4:** Run `node shots.mjs audit-log`.

---

### Task 9: Check, review, hand off

- [ ] **Step 1: Bring the files onto the branch**

In your own account, at the app repo root on the docs branch:

```bash
mkdir -p docs/guide/public/media && cp -R /Users/Shared/hv-media/out/. docs/guide/public/media/
cd docs/guide && npm run check:media
```

Expected: `media check: 19 stills, 2 clips OK`. Otherwise it names the file and the problem. Re-shoot that one.

- [ ] **Step 2: Review every frame for private data**

```bash
for c in approve-a-tool-call/permission-approve mcp/mcp-add; do
  mkdir -p .media-work/review/$c && /opt/homebrew/bin/ffmpeg -loglevel error -i public/media/$c.mp4 -vf fps=2 .media-work/review/$c/%03d.png
done
```

Look at each of the 19 stills and every review frame against the **never on screen** list: keys, tokens, sign-in URLs, device codes, emails, `KEY=value`, home paths other than `/Users/demo`, anything personal. Check also that no frame catches a dialog mid-entrance (Review Focus 3). Re-shoot any failure.

- [ ] **Step 3: Close the accounts.** Revoke the throwaway DeepSeek key. As `demo`, sign out of Claude on **Models**. Keep the `demo` user for the full shot list later, or delete it.
- [ ] **Step 4: Commit**

```bash
git add docs/guide/public/media
git commit -s -m "Docs media: the 21 v1 shots"
```

---

### Task 10: Place the media on the pages

- [ ] **Step 1:** List the placeholders: `grep -rn "TODO(media)" docs/guide/src/content/docs/`.
- [ ] **Step 2:** Replace each one with its file, using the placeholder's text as the alt text:
  - a still: `![<Shows line>](/docs/media/<slug>/<shot-id>.png)`
  - a video:

    ```html
    <video autoplay muted loop playsinline controls poster="/docs/media/<slug>/<shot-id>.jpg" aria-label="<Shows line>">
      <source src="/docs/media/<slug>/<shot-id>.webm" type="video/webm" />
      <source src="/docs/media/<slug>/<shot-id>.mp4" type="video/mp4" />
    </video>
    ```
- [ ] **Step 3:** `cd docs/guide && npm run build`. It must pass `scripts/check-build.mjs`. Then `grep -rn "TODO(media)" src/content/docs/` prints nothing.
- [ ] **Step 4:** Run the `docs-reviewer` agent on the changed pages (it checks media against the shot list), fix every finding, and commit with `git commit -s`.
