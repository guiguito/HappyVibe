// §13 round 27 — which OpenRouter image models actually work through Pi's image call.
// Nothing in Pi's catalogue or OpenRouter's model list says so: some models only serve
// OpenRouter's separate image endpoint, and Pi always calls chat/completions (a 404, free).
// So each model is tried once, at its DEFAULT size: OpenRouter's smallest `image_config`
// size ("1K") cost MORE than the default on FLUX.2 Klein ($0.0168 vs $0.0139, 2026-10-08).
// Results go to tools/provider-catalog/image-probe.json, which the catalog generator reads. Re-run after a Pi bump adds image models (the
// provider-catalog test fails until every model has a verdict).
//   set -a; . ./.env; set +a; node tools/image-model-probe.mjs [--only id,id] [--skip-known]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PA = path.resolve("pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
const OUT = path.resolve("tools/provider-catalog/image-probe.json");
const { getBuiltinImageModels } = await import(pathToFileURL(path.join(PA, "providers/all.js")).href);
const { generateImages } = await import(pathToFileURL(path.join(PA, "images.js")).href);
const key = process.env.OPENROUTER_API_KEY;
if (!key || key.startsWith("sk-REPLACE")) throw new Error("OPENROUTER_API_KEY is not set");

const args = process.argv.slice(2);
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { models: {} };
const skipKnown = args.includes("--skip-known");

const ROUTERS = new Set(["openrouter/auto", "openrouter/auto-beta"]); // OpenRouter picks the model: never offered

async function once(model) {
  let charged;
  const tap = async (input, init) => {
    const res = await fetch(input, init);
    try { charged = (await res.clone().json())?.usage?.cost; } catch { /* not JSON */ }
    return res;
  };
  const r = await generateImages(model, { input: [{ type: "text", text: "A tiny flat icon of a smiling sun." }] }, {
    apiKey: key,
    fetch: tap,
  });
  const img = r.output?.find((b) => b.type === "image" && b.data);
  return { ok: r.stopReason === "stop" && !!img, error: r.errorMessage, charged, bytes: img ? Math.floor((img.data.length * 3) / 4) : 0 };
}

const models = getBuiltinImageModels("openrouter").filter((m) => !ROUTERS.has(m.id) && (!only || only.has(m.id)));
let spent = 0;
for (const m of models) {
  if (skipKnown && prev.models[m.id]) continue;
  const r = await once(m);
  spent += r.charged ?? 0;
  const verdict = r.ok ? "ok" : /chat\/completions endpoint/.test(r.error ?? "") ? "wrong-endpoint" : "failed";
  prev.models[m.id] = { verdict, charged: r.charged ?? null, ...(r.ok ? {} : { error: (r.error ?? "").slice(0, 200) }) };
  console.log(`${verdict.padEnd(14)} ${m.id.padEnd(48)} ${r.charged ?? "-"}`);
  fs.writeFileSync(OUT, JSON.stringify({ probedAt: new Date().toISOString().slice(0, 10), models: prev.models }, null, 2) + "\n");
}
console.log(`spent ≈ $${spent.toFixed(4)}`);
