// A scripted model so a turn runs with NO key. Loaded with -e BEFORE the bridge.
// pi-ai is found as Pi finds it (nested, else hoisted — tools/pi-ai-dir.mjs).
// HV_FAUX_STEPS: JSON Array<{tool?, args?, text?}>, one per model call.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { piAiDist } from "../../tools/pi-ai-dir.mjs";

export default async function (pi: { registerProvider(p: unknown): void }): Promise<void> {
  const rt = process.env.HV_TEST_RUNTIME!;
  const ai = await import(pathToFileURL(path.join(piAiDist(rt), "index.js")).href);
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
