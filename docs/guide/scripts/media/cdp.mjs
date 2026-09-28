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

  /** The centre of the first visible clickable element whose text is `text` (or starts with it). */
  const find = (text, { startsWith = false } = {}) =>
    evaluate(`(() => {
      const want = ${JSON.stringify(text)};
      const el = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], summary, label')]
        .find((e) => {
          const t = (e.innerText ?? "").trim();
          return (${startsWith} ? t.startsWith(want) : t === want) && e.getBoundingClientRect().width > 0;
        });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);

  /** A real mouse click, so the app sees exactly what a person's click produces. */
  const click = async (text, { startsWith = false, timeout = 10_000 } = {}) => {
    const at = await waitFor(() => find(text, { startsWith }), timeout, `a clickable "${text}"`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    await sleep(300);
  };

  /** Opens a sidebar screen, expanding its group first when the item is hidden. */
  const openView = async (label, group) => {
    if (group && !(await find(label))) await click(group);
    await click(label);
    await sleep(500);
  };

  /** Types into the visible composer one character at a time, so a recording shows the typing. */
  const type = async (text, { delay = 35 } = {}) => {
    const ok = await evaluate(`(() => {
      const t = [...document.querySelectorAll("textarea")]
        .find((e) => e.getBoundingClientRect().width > 0 && e.placeholder.startsWith("Ask for a change"));
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
    const k = key === "Enter" ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 } : { key, code: key };
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, ...k });
  };

  /** 1440 × 900 points at `scale`, whatever size the real window is. */
  const viewport = (scale = 2) =>
    send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });

  /** Refuses to capture anything private. Tooltips aren't in innerText; the frame review in Task 8 covers them. */
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

  return { send, evaluate, sleep, find, click, openView, waitFor, waitForText, waitForDialog, type, press, viewport, guard, shot, record };
}
