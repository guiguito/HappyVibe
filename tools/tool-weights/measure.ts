/**
 * One key-free Pi, the app's REAL spawn arguments, a scripted model: how many
 * characters every request carries (system prompt + tool definitions).
 * Shared by the generator (build.ts) and the re-derive test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiClient } from "../../src/main/pi/PiClient.ts";
import { resolvePiSpawn } from "../../src/main/pi/spawn.ts";
import { bundledSkillsDir, buildManifest } from "../../src/main/skills/index.ts";
import { scanSkillsDir } from "../../src/main/skills/discovery.ts";
import { parseBuiltins } from "../../pi-runtime/extensions/hv-builtins.ts";
import { resolveImageModel } from "../../pi-runtime/extensions/hv-images.ts";
import { IMAGE_MODELS } from "../../src/main/providerCatalog.generated.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNTIME = path.join(ROOT, "pi-runtime");

export type Switches = ReturnType<typeof parseBuiltins>;
export interface Variant { builtins?: Partial<Switches>; images?: boolean }
export interface Measurement { piVersion: string; totalChars: number; toolChars: Record<string, number> }

export function piVersion(): string {
  const pkg = path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/package.json");
  return (JSON.parse(fs.readFileSync(pkg, "utf8")) as { version: string }).version;
}

export async function measure(v: Variant = {}): Promise<Measurement> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-weights-"));
  const agentDir = path.join(tmp, "agent");
  const ws = path.join(tmp, "ws");
  for (const d of [agentDir, ws, path.join(agentDir, "agents"), path.join(tmp, "mem-g"), path.join(tmp, "mem-w")]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(path.join(RUNTIME, "agents")).filter((n) => n.endsWith(".md"))) {
    fs.copyFileSync(path.join(RUNTIME, "agents", f), path.join(agentDir, "agents", f));
  }
  const builtins = { ...parseBuiltins(undefined), ...v.builtins };
  const skills = builtins.skills ? scanSkillsDir(bundledSkillsDir(RUNTIME), "bundled").filter((s) => s.loadable) : [];
  const skillsFile = path.join(tmp, "skills.json");
  fs.writeFileSync(skillsFile, JSON.stringify(buildManifest(skills.map((skill) => ({ skill, scope: "global" as const })))));
  const prompts = fs.readdirSync(path.join(RUNTIME, "prompts")).filter((n) => n.endsWith(".md")).map((n) => path.join(RUNTIME, "prompts", n));

  const spec = resolvePiSpawn(ws, path.join(tmp, "sessions"), RUNTIME, {
    mcp: true, agentDir, agentShell: "bash", builtinTools: builtins,
    memoryGlobalDir: builtins.memory ? path.join(tmp, "mem-g") : undefined,
    memoryWorkspaceDir: builtins.memory ? path.join(tmp, "mem-w") : undefined,
    skills: skills.map((s) => s.id), skillsFile, promptTemplates: prompts,
    imageModel: v.images ? resolveImageModel(IMAGE_MODELS, undefined) ?? undefined : undefined,
  });
  const bridge = spec.args.findIndex((a) => a.endsWith("happyvibe-bridge.ts"));
  const args = [...spec.args.slice(0, bridge - 1), "-e", path.join(ROOT, "tests/fixtures/faux-model.ts"), ...spec.args.slice(bridge - 1),
    "--no-session", "--provider", "faux", "--model", "script"];
  const client = new PiClient({ ...spec, execPath: process.execPath, args,
    env: { ...spec.env, HOME: tmp, HV_TEST_RUNTIME: RUNTIME, HV_FAUX_STEPS: JSON.stringify([{ text: "ok" }]) } as Record<string, string> });
  try {
    const ended = new Promise<void>((r) => client.on("event", (e: { type: string }) => e.type === "agent_end" && r()));
    const snapshot = new Promise<{ chars: number; toolDefs: { name: string; chars: number }[] }>((r) =>
      client.on("ui-request", (m: { method?: string; message?: string }) => {
        if (m.method !== "notify") return;
        try {
          const p = JSON.parse(m.message ?? "") as { kind?: string; stage?: string; system?: { chars: number; toolDefs?: { name: string; chars: number }[] } };
          if (p.kind === "hv.context" && p.stage === "snapshot" && p.system) r({ chars: p.system.chars, toolDefs: p.system.toolDefs ?? [] });
        } catch { /* not ours */ }
      }));
    await client.start();
    await client.send({ type: "prompt", message: "go" });
    await ended;
    await client.send({ type: "prompt", message: "/hv-context" });
    const s = await snapshot;
    const toolChars = Object.fromEntries(s.toolDefs.map((t) => [t.name, t.chars]));
    return { piVersion: piVersion(), totalChars: s.chars + s.toolDefs.reduce((n, t) => n + t.chars, 0), toolChars };
  } finally {
    client.stop();
    // Best effort: the child may still be flushing a file as it exits.
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp dir */ }
  }
}
