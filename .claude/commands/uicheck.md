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

### The rule about claiming it's fixed
After any change, re-attach, screenshot **again**, and show me the after picture. A UI fix is
not done because the code looks right, the types pass, or the tests are green — it is done when
the screenshot shows it.

If the fix requires a restart to take effect, say so and ask me to restart rather than reporting
success. If I say "still not fixed", treat your previous diagnosis as wrong and start from the
screenshot again — do not re-apply a variant of the same fix.
