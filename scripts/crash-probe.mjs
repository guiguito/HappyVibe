/**
 * §37 — fire every crash shape at a running dev app and print the FRAMES the
 * server stored for each. The tool for answering "can I act on this report?".
 *
 *   HV_DEBUG_PORT=9223 HV_CRASH_DEV=1 npm run dev     # in one terminal
 *   node scripts/crash-probe.mjs                      # in another
 *
 * Needs FEEDBACK_API_KEY in .env to read the reports back (an `isk_` server
 * key — the app itself never holds one).
 *
 * Shapes, and what each is for:
 *   nested    main-process throw several NAMED functions deep — the honest test
 *             of main frames, which a one-liner cannot give you
 *   renderer  uncaught throw from a real renderer MODULE (not an eval, which
 *             has no file and produces the frameless report that once looked
 *             like a broken integration)
 *   render    a component that throws during render — the error-boundary path,
 *             whose frames come from React's component stack
 *   reject    unhandled rejection in main
 *   crash     the renderer process killed outright — no JS stack by nature
 */
import { readFileSync, existsSync } from "node:fs";

const PORT = process.env.HV_DEBUG_PORT ?? "9223";
const DB = process.env.HV_CRASH_DB ?? "cdb_38g7t8v30pxe";
const BASE = "https://feedback.bzapps.eu";

for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.FEEDBACK_API_KEY;
if (!KEY) { console.error("FEEDBACK_API_KEY missing — cannot read reports back."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target on :${PORT} — is the dev app running?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (m) => { ws.close(); resolve(JSON.parse(m.data)?.result?.result?.value); };
    ws.onerror = () => { ws.close(); reject(new Error("CDP socket error")); };
    setTimeout(() => { ws.close(); resolve("(no answer — the renderer may have died, which is the point)"); }, 8000);
  });
}

const api = async (p) =>
  (await fetch(`${BASE}/v1/crash-databases/${DB}${p}`, { headers: { authorization: `Bearer ${KEY}` } })).json();

const SHAPES = [
  { name: "nested",   fire: "window.hv.crashTest('nested')" },
  { name: "renderer", fire: "window.hvCrashProbe('renderer')" },
  { name: "render",   fire: "window.hvCrashProbe('render')" },
  { name: "reject",   fire: "window.hv.crashTest('reject')" },
  { name: "crash",    fire: "window.hv.crashTest('crash')" },
];

// Keyed by group -> its newest report. A repeat crash joins an EXISTING group,
// so group novelty only fires the first time a shape is ever seen; what marks a
// report as arriving from THIS run is the group's latest report changing.
const before = new Map(((await api("/groups")).groups ?? []).map((g) => [g.id, g.latestReportId]));
const only = process.argv.slice(2);

for (const s of SHAPES) {
  if (only.length && !only.includes(s.name)) continue;
  process.stdout.write(`firing ${s.name} … `);
  try { await evaluate(s.fire); } catch (e) { console.log(`skipped (${e.message})`); continue; }
  console.log("ok");
  // `render` leaves the app on its fallback and `crash` kills the renderer, so
  // give the reload a moment before the next shape drives the page again.
  await sleep(s.name === "render" || s.name === "crash" ? 9000 : 6000);
  if (s.name === "render") await evaluate("location.reload()").catch(() => {});
}

await sleep(4000);
console.log("\n──────── what the server stored ────────");

/**
 * What each shape must show to count as a PASS. A verdict rather than output to
 * read: the first time these reports were reviewed by eye, a frameless probe
 * artefact was mistaken for a broken integration, which cost a round.
 * `renderer-gone` is the deliberate exception — a killed process leaves no JS
 * stack, so "no frames" is the correct answer there and not a failure.
 */
const EXPECT = {
  nested:   { inApp: 4, message: "hv:crash-test nested" },
  renderer: { inApp: 3, message: "hv:crash-probe renderer" },
  render:   { inApp: 1, message: "hv:crash-probe render" },
  reject:   { inApp: 1, message: "hv:crash-test reject" },
  crash:    { inApp: 0, message: null },
};
const fired = SHAPES.filter((s) => !only.length || only.includes(s.name)).map((s) => s.name);
const seen = [];

for (const g of (await api("/groups")).groups ?? []) {
  const fresh = before.get(g.id) === g.latestReportId ? "" : "  ← NEW";
  const r = (await api(`/groups/${g.id}/reports`)).reports?.[0];
  const ex = r?.envelope?.exception ?? {};
  const frames = ex.frames ?? [];
  if (before.get(g.id) !== g.latestReportId) seen.push({ kind: g.kind, message: ex.message ?? null, inApp: frames.filter((f) => f.inApp).length });
  console.log(`\n${g.kind}  type=${ex.type ?? "—"}  message=${JSON.stringify(ex.message ?? null)}${fresh}`);
  console.log(`  topFrame: ${g.topFrame ?? "—"}`);
  for (const f of frames.slice(0, 6)) {
    const where = f.file ? `${f.file}:${f.line}:${f.col}` : `<no file>:${f.line}:${f.col}`;
    console.log(`    ${f.inApp ? "APP " : "ext "} ${(f.function ?? "(anonymous)").padEnd(28)} ${where}`);
  }
  if (!frames.length) console.log("    (no frames — expected for message and renderer-gone)");
}

console.log("\n──────── verdict ────────");
let failed = 0;
for (const name of fired) {
  const want = EXPECT[name];
  const got = seen.find((s) =>
    want.message === null ? s.message === null : s.message === want.message,
  );
  if (!got) {
    // The overwhelmingly likely cause, so name it rather than leaving a puzzle.
    console.log(`  FAIL ${name.padEnd(9)} nothing new arrived — 24h dedupe? stop the app and`);
    console.log(`                 rm "<userData>/inlet-crash/dedupe.json", then re-run`);
    failed++;
  } else if (got.inApp < want.inApp) {
    console.log(`  FAIL ${name.padEnd(9)} ${got.inApp} in-app frames, expected >= ${want.inApp}`);
    failed++;
  } else {
    console.log(`  pass ${name.padEnd(9)} ${got.inApp} in-app frames, message ${JSON.stringify(got.message)}`);
  }
}
console.log(failed ? `\n${failed} shape(s) FAILED` : "\nall shapes passed");
process.exit(failed ? 1 : 0);
