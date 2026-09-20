---
name: demo-recording
description: Records a screen capture of HappyVibe driving itself — the hero clip for the README, the website or a release post. Use this whenever a demo, GIF, screencast, video, poster frame or "show it in action" asset comes up, including re-cutting or shortening an existing one. The capture pipeline is not obvious: the embedded browser pane is invisible to an ordinary screenshot, Chromium stops emitting frames when the window is occluded, and half the prompts you would reach for fight the product's own gates. Those traps and their fixes live here and nowhere else.
---

# Recording a HappyVibe demo

The asset is a **7–11 second loop** showing one conversation in which the agent does real work.
It exists to make §8.1's claim true in a single glance: *everything is already here, and you can
see what it does.* Nothing is mocked, staged or sped past recognition — a real model, a real
workspace, a real turn.

The pipeline below was arrived at over six takes. **Read the traps first**; four of them produce a
plausible-looking file that is silently wrong, which is worse than a failure.

---

## The five traps

**1. The browser pane is INVISIBLE to a screenshot of the renderer.** A `WebContentsView`
composites *outside* the renderer's DOM, so `Page.captureScreenshot` on the app target returns a
**white rectangle** where the page should be. The page is fine; you just cannot photograph it that
way. The pane is its own CDP target — capture **both** and overlay. This is what `capture.mjs`
does, and it is the single most expensive thing to rediscover.

**2. Serve the page locally, or the demo shows a refusal.** `file://` is refused outright and any
external host raises the egress gate; both leave a **Blocked** card where the page should be. The
browser tool's own description says the fix — *"to view a local file, serve its directory (e.g.
`python3 -m http.server`) and open that."* **`localhost` is a safe default, so it renders with no
gate at all.** Serve, then prompt for the `http://localhost:PORT` URL.

**3. Chromium stops emitting screencast frames while the window is occluded.**
`Page.startScreencast` silently yields 1–3 frames if anything is in front of the app — no error,
just a near-empty directory. **Poll `Page.captureScreenshot` on a timer instead**; it forces a
frame regardless. (macOS `screencapture` would also solve trap 1 in one step, but needs Screen
Recording permission the terminal does not have.)

**4. `addWorkspace()` opens a native folder picker** that automation cannot drive — the call just
hangs until it times out. Register the workspace in `workspaces.json` and restart the app.

**5. Every extra session adds a pane, and hidden panes keep their own composer.**
`document.querySelector('textarea')` starts returning the wrong one, and you will type a prompt
into a pane nobody can see. **Close all tabs before starting**, and always pick the textarea whose
`getBoundingClientRect().width > 0`.

---

## Procedure

### 1. Pick the subject

**A running app beats a text edit.** The strongest version opens a real project from the user's own
workspaces and shows it working — a game, a visualiser, a dashboard. A moving scene survives being
scrolled past; a green diff does not.

**Never modify a repo that is not git-backed.** Check first (`git -C <dir> rev-parse
--is-inside-work-tree`). If it is not, drop the file-edit beat and serve the prebuilt output
read-only rather than risk an unrevertable change. Say so in the hand-off.

### 2. Set the stage

```bash
cd <project> && python3 -m http.server 8010 &      # serve the page, note the port
cd <repo root> && npx electron-vite dev --remoteDebuggingPort=9333 &
```

`cd` leaks between commands — **launch the app from the repo root** or `npx` fetches a fresh
electron-vite that cannot find electron.

Then, in the renderer: close every tab (`aria-label` starting `close`) so exactly one empty pane
remains. Ask the user to size the window first — it cannot be resized from here
(`Browser.setWindowBounds` is unsupported in Electron, and osascript needs assistive access).
**1400×900 or larger**; check `innerWidth/innerHeight`.

### 3. Capture

```bash
node scripts/capture.mjs 9333 <appTargetId> <outDir> <seconds> 12
```

It writes `<outDir>/app/NNNNN.jpg` and `<outDir>/guest/NNNNN.jpg` with matching indices, and
attaches to the browser pane by itself the moment it opens. **Start it before the prompt.**

⚠️ `attach` on a restarted app returns a **cached, dead target id** and reports success. Always
re-read `http://127.0.0.1:9333/json` and pass the live `targetId` explicitly.

### 4. Drive it

Run the whole take as **one in-page script** — round-tripping through separate tool calls adds
seconds of dead air between every beat, and dead air is what makes a demo feel slow. The script
should: create the session, open it, dismiss the AGENTS.md banner, **type the prompt character by
character** (a paste looks fake), send, then poll every ~120 ms and click any `Allow` it sees.

Keep the prompt to **three short asks**, and name the localhost URL explicitly.

To show gameplay, drive the **guest** target directly afterwards: click to start, then move the
mouse along a Lissajous path so the subject sweeps the scene instead of wandering. Capture that as
a second pass and concatenate — the transcript behind it is unchanged, so the join is invisible.

### 5. Composite and cut

Overlay the guest onto the app frames at the pane's rect — read it from the `[data-covered]`
element and **multiply by `devicePixelRatio`**:

```bash
ffmpeg -y -framerate 12 -i app/%05d.jpg -framerate 12 -start_number <firstGuestIdx> -i guest/%05d.jpg \
  -filter_complex "[1:v]scale=<W>:<H>,setpts=PTS+<offset>/TB[g];[0:v][g]overlay=<X>:<Y>:eof_action=pass[v]" \
  -map "[v]" -r 12 -c:v libx264 -crf 20 -pix_fmt yuv420p composite.mp4
```

`<offset>` is `(firstGuestIdx - 1) / 12` seconds — without it the guest starts at t=0 and the
overlay lands minutes early.

Then find the beats by sampling stills into a contact sheet (`tile=3x3`) and **look at it** before
cutting. Trim to the content, drop the lead-in, speed up 1.1–1.3×, hold the last second so the loop
lands:

```bash
ffmpeg -y -i composite.mp4 -filter_complex \
 "[0:v]trim=<a>:<b>,setpts=(PTS-STARTPTS)/1.25,scale=1476:-2[v]" -map "[v]" \
 -r 24 -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart hv-demo.mp4
ffmpeg -y -i hv-demo.mp4 -vf "fps=11,scale=920:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" hv-demo.gif
ffmpeg -y -i hv-demo.mp4 -c:v libvpx-vp9 -crf 33 -b:v 0 -an hv-demo.webm
ffmpeg -y -ss <mid> -i hv-demo.mp4 -frames:v 1 -vf scale=1600:-1 hv-poster.jpg
```

**Verify the cut the same way** — sample nine stills, tile them, read them. A beat that landed
outside the trim is invisible in a duration check and obvious in a contact sheet.

---

## Editorial rules

- **Ship the mp4, not the GIF.** A third of the size and sharper. Keep the GIF for the README and
  anywhere video will not run, and always emit a poster frame so the block is not blank.
- **Every beat must move.** Hold only the final second. If a segment is static for more than a
  beat, cut it or speed it up.
- **No approval dialog in the hero clip.** On a normal machine `bash`, `write` and `edit` are
  already allowed and `localhost` is a safe default, so a *smooth* demo cannot contain one by
  construction — and waiting on a modal is the slowest thing in the product. Shoot it separately as
  a **still**, where copy can explain it. That frame is worth having: the feed behind the scrim
  carries the model's sentence, the dialog in front carries the app's factual one, which is §8.4's
  whole claim in one image.
- **No captions, no voiceover, no feature tour.** A montage of screens says "many features", and
  many features is the claim that loses (§8.1).

---

## Clean up, and say what you touched

Recording mutates real state. Back up before, restore after, and **report it** — the user cannot
see what you changed:

- `workspaces.json` — a demo workspace stays in the sidebar until removed
- `permission-rules.json` — back it up before any rule experiment. `addPermissionRule(workspace,
  tool)` adds an **allow** rule and takes that argument order; getting it wrong writes an
  `[object Object]` key into the user's real config
- any `http.server` you started, and the throwaway project
- confirm no files changed in a workspace you only meant to read
  (`find <dir> -newermt "-45 minutes" -type f -not -path "*/node_modules/*"`)
