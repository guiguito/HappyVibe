// A scripted model so a turn runs with NO key. Loaded with -e BEFORE the bridge.
// pi-ai 1.0.x is nested under pi-coding-agent while tintinweb's open peer range keeps a
// stale top-level copy (.claude/rules/providers.md) — use the nested one, else the top.
// HV_FAUX_STEPS: JSON Array<{tool?, args?, text?}>, one per model call.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default async function (pi: { registerProvider(p: unknown): void }): Promise<void> {
  const rt = process.env.HV_TEST_RUNTIME!;
  const nested = path.join(rt, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js");
  const top = path.join(rt, "node_modules/@earendil-works/pi-ai/dist/index.js");
  const ai = await import(pathToFileURL(fs.existsSync(nested) ? nested : top).href);
  const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "script" }] });
  const steps = JSON.parse(process.env.HV_FAUX_STEPS ?? "[]") as Array<{ tool?: string; args?: object; text?: string }>;
  faux.setResponses(
    steps.map((s) =>
      s.tool
        ? ai.fauxAssistantMessage(ai.fauxToolCall(s.tool, s.args ?? {}), { stopReason: "toolUse" })
        : ai.fauxAssistantMessage(s.text ?? "done"),
    ),
  );
  pi.registerProvider(faux.provider);
}
