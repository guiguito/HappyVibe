---
description: Attach to the running app, look at it, and diagnose — no claiming fixed without a picture
argument-hint: "[what to look at / what's wrong]"
---

Check the running app: $ARGUMENTS

### Get eyes on it
Attach to the live instance — **never launch it**. `electron-debug`'s `start_app` has hung for
30 minutes in this project; I launch with `HV_DEBUG_PORT=9222 npm run dev` (run `/devdoctor`
if I need reminding) and you `attach {debugPort: 9222}`.

If the attach fails, say so and ask me to launch — do not fall back to `start_app`, and do not
substitute reading the source for looking at the app.

Also: if I referred to a screenshot without giving a path, take the newest one from
`~/Desktop/Screenshot*.png` (and check `~/Downloads/image*.png`) and read it before anything else.

### Diagnose
1. `screenshot` the window (or the specific element via `selector`) — look at it.
2. `get_console_messages` with `level: error` — plus warnings if the symptom is a render bug.
3. Only now read the source. The picture and the console decide which code is relevant, not the
   other way round.
4. Is the UI **stale** (old bundle still loaded) rather than broken? Check whether the DOM
   reflects the current source; a `reload` distinguishes a stale renderer from a real bug.
   Say which one it is before proposing a fix.

### Am I even looking at the new code?
Answer this before trusting a single observation, because every failure below looks like a working
app showing you old behaviour.

- **`src/main` changes need a dev-server RESTART.** A renderer reload (⌘R) re-runs the renderer
  only; preload is bundled at window creation. Restart, then check the **BUILT artifact**:
  `grep '<your change>' out/main/index.js`. Verifying the source is not verifying the app.
- **`pkill -f "electron-vite dev"` does NOT kill Electron.** The child keeps holding the debug port,
  so `attach` cheerfully succeeds against the stale bundle. Also `pkill -f '<repo>/node_modules/electron'`
  and confirm the port is free (`curl -s -m2 http://127.0.0.1:9222/json/version` fails) before relaunching.
- **Prove the attach is the new process.** `attach` can hand back a cached session id. Call something
  that exists only in the new build — a new IPC channel, a new string — and check it answers.

### Assert, don't just look
A screenshot proves the page rendered. It does not prove the page is telling the truth: a count can
be wrong, a control can be missing, and copy can overstate — all of which photograph beautifully.

So alongside the screenshot, `evaluate` one expression that returns the facts as JSON, and name them
before you run it:

- **the exact copy** that must appear (and any that must not);
- **counts that must match the data** — a headline number is a claim, so check it against the source
  rather than reading it back off the screen;
- **at least one absence check.** You cannot screenshot something that should not be there, so a
  feature whose point is "X is excluded" is unverified until you assert X is gone;
- **the state on the OTHER surface the change affects.** Installing on one page and checking only
  that page is how a wrong default survives — go look at the page that owns the thing you changed.

Then drive the flow, don't just load it: do the action, undo it, and do the one that would break if a
shared resource were released too early.

### The rule about claiming it's fixed
After any change, re-attach, screenshot **again**, and show me the after picture. A UI fix is
not done because the code looks right, the types pass, or the tests are green — it is done when
the screenshot shows it **and** the assertions above come back true. Paste the assertion output;
"verified in the GUI" with nothing behind it is the claim this file exists to prevent.

If the fix requires a restart to take effect, say so and ask me to restart rather than reporting
success. If I say "still not fixed", treat your previous diagnosis as wrong and start from the
screenshot again — do not re-apply a variant of the same fix.
