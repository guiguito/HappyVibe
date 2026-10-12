// Drives the HappyVibe app over the Chrome DevTools Protocol and captures it, for the user guide's media.
// ponytail: raw CDP over Node 22's built-in WebSocket, as hv-demo-media/shoot2.mjs does. No Playwright.
import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname } from "node:path";

const PORT = process.env.CDP_PORT ?? "9222";
/** The app's renderer: index.html in a packaged build, the Vite server in dev. Browser panes are other targets. */
const IS_APP = /index\.html|localhost:5173\/?$/;
/** The home folder the app runs under; any other /Users/<name> on screen is someone's real path. */
const DEMO_HOME = process.env.MEDIA_HOME_NAME ?? "demo";

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
    await mouseClick(await waitFor(() => centre(css, filter, last ? "els.at(-1)" : "els[0]"), timeout, css));
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
      [`a home path that is not /Users/${DEMO_HOME}`, new RegExp(`/Users/(?!${DEMO_HOME}\\b)[\\w.-]+`)],
      ["a KEY=value line", /\b[A-Z][A-Z0-9_]{2,}=\S+/],
      ["this Mac's user name", new RegExp(`\\b${userInfo().username}\\b`)], // an `ls -l` card prints it
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
