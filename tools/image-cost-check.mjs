// §19 round 27 — ONE paid image call: Pi's catalogue estimate vs OpenRouter's own charge.
// Run on a pin bump that changes image prices. Costs a few cents.
//   set -a; . ./.env; set +a; node tools/image-cost-check.mjs [model-id]
import path from "node:path";
import { pathToFileURL } from "node:url";

const PA = path.resolve("pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
const { getBuiltinImageModels } = await import(pathToFileURL(path.join(PA, "providers/all.js")).href);
const { generateImages } = await import(pathToFileURL(path.join(PA, "images.js")).href);
const key = process.env.OPENROUTER_API_KEY;
if (!key || key.startsWith("sk-REPLACE")) throw new Error("OPENROUTER_API_KEY is not set");
const id = process.argv[2] ?? "google/gemini-3.1-flash-lite-image";
const model = getBuiltinImageModels("openrouter").find((m) => m.id === id);
if (!model) throw new Error(`${id} is not in Pi's catalogue`);
// OpenRouter reports what it charged in the response's own `usage.cost`; pi-ai drops that field,
// so a wrapped fetch reads it off the SAME response Pi priced. (/api/v1/generation 404s for
// these requests — measured 2026-10-08.)
let charged;
const tap = async (input, init) => {
  const res = await fetch(input, init);
  try { charged = (await res.clone().json())?.usage?.cost; } catch { /* not JSON */ }
  return res;
};
const r = await generateImages(model, { input: [{ type: "text", text: "A flat app icon of a smiling sun, simple shapes." }] }, { apiKey: key, fetch: tap });
const img = r.output?.find((b) => b.type === "image");
console.log({ stopReason: r.stopReason, error: r.errorMessage, imageBytes: img ? Math.floor(img.data.length * 3 / 4) : 0, usage: r.usage });
const estimate = r.usage?.cost?.total;
console.log({ model: id, piEstimate: estimate, openrouterCharged: charged, ratio: charged ? estimate / charged : null });
