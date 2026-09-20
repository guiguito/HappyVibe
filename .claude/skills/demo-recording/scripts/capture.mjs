// Dual capture for a HappyVibe demo recording. See ../SKILL.md.
//
// WHY TWO STREAMS: the embedded browser pane is a `WebContentsView`, which
// composites OUTSIDE the renderer's DOM — `Page.captureScreenshot` on the app
// target returns a WHITE RECTANGLE where the page is. The pane is its own CDP
// target, so we capture both and let ffmpeg overlay one onto the other.
//
// WHY POLLING, NOT Page.startScreencast: the screencast silently stops emitting
// while the window is occluded (1-3 frames, no error). captureScreenshot forces
// a frame either way.
//
// Frames are index-matched: app/00042.jpg and guest/00042.jpg are the same
// instant. The guest only exists from the frame the pane opened on — that index
// is the `setpts` offset when compositing.
//
// usage: node capture.mjs <port> <appTargetId> <outDir> <seconds> <fps>
import fs from "node:fs";
const [, , port, appId, outDir, secs, fps] = process.argv;
if (!port || !appId || !outDir) {
  console.error("usage: node capture.mjs <port> <appTargetId> <outDir> <seconds> <fps>");
  console.error("  appTargetId: read it LIVE from http://127.0.0.1:<port>/json —");
  console.error("  a cached id from a previous app run still 'attaches' and captures nothing.");
  process.exit(1);
}
const appDir = `${outDir}/app`, guestDir = `${outDir}/guest`;
for (const d of [appDir, guestDir]) { fs.mkdirSync(d, { recursive: true }); for (const f of fs.readdirSync(d)) fs.unlinkSync(`${d}/${f}`); }

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); let id = 0;
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const ready = new Promise(r => { ws.onopen = () => r(); });
  return { ready, shot: () => new Promise(res => { const i = ++id; pending.set(i, res); try { ws.send(JSON.stringify({ id: i, method: "Page.captureScreenshot", params: { format: "jpeg", quality: 80 } })); } catch { res(null); } }) };
}

const app = connect(`ws://127.0.0.1:${port}/devtools/page/${appId}`);
await app.ready;

let guest = null, guestId = null;
const findGuest = async () => {
  if (guest) return;
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const t = list.find(x => x.type === "page" && x.id !== appId && !x.url.includes("5173"));
    if (t) { guestId = t.id; guest = connect(t.webSocketDebuggerUrl); await guest.ready; console.error("guest attached: " + t.url); }
  } catch {}
};

let n = 0;
const period = 1000 / Number(fps || 12), t0 = Date.now(), limit = Number(secs) * 1000;
while (Date.now() - t0 < limit) {
  const started = Date.now();
  if (n % 6 === 0) await findGuest();
  const [a, g] = await Promise.all([app.shot(), guest ? guest.shot() : Promise.resolve(null)]);
  n++;
  const name = String(n).padStart(5, "0") + ".jpg";
  if (a?.data) fs.writeFileSync(`${appDir}/${name}`, Buffer.from(a.data, "base64"));
  if (g?.data) fs.writeFileSync(`${guestDir}/${name}`, Buffer.from(g.data, "base64"));
  const wait = period - (Date.now() - started);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
console.error(`app frames: ${fs.readdirSync(appDir).length}, guest frames: ${fs.readdirSync(guestDir).length}`);
process.exit(0);
