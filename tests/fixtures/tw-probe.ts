/**
 * Test-only Pi extension for tests/tintinweb-trust.test.ts. Publishes a HappyVibe-shaped
 * child policy (when TW_PROBE_POLICY=1), spawns children over tintinweb's own bus, and
 * records lifecycle + spawn replies to TW_PROBE_OUT. Loaded WITHOUT the bridge, so the
 * test pins the patch's contract, not the bridge's policy.
 */
import fs from "node:fs";

export default function twProbe(pi: any) {
  const out = process.env.TW_PROBE_OUT!;
  const rec = (o: Record<string, unknown>) => fs.appendFileSync(out, JSON.stringify({ t: Date.now(), ...o }) + "\n");
  if (process.env.TW_PROBE_POLICY === "1") {
    (globalThis as any)[Symbol.for("hv:child-policy")] = {
      extensionPaths: () => [process.env.TW_PROBE_GUARD!],
      skillPaths: () => [],
      refuseSpawn: (type: string) => (type === "switched-off" ? "'switched-off' is switched off on the Agents page." : undefined),
      boundaryFor: () => ["read"],
      audit: () => {},
    };
  }
  for (const ev of ["subagents:started", "subagents:completed", "subagents:failed"]) {
    pi.events.on(ev, (p: any) => rec({ ev, id: p.id, type: p.type, status: p.status, error: p.error }));
  }
  pi.on("session_start", (_e: any, ctx: any) => {
    const agent = pi.getAllTools().find((t: any) => t.name === "Agent");
    rec({ ev: "boot", trusted: ctx.isProjectTrusted?.(), agentHasSchedule: JSON.stringify(agent?.parameters ?? {}).includes('"schedule"') });
  });
  pi.registerCommand("tw-probe-spawn", {
    description: "spawn a child over tintinweb's bus",
    handler: async (args: string) => {
      const [type, model] = args.trim().split(/\s+/);
      const requestId = `probe-${Date.now()}-${Math.random()}`;
      const reply = new Promise((resolve) => {
        pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, (r: unknown) => resolve(r));
        setTimeout(() => resolve({ timeout: true }), 15_000);
      });
      pi.events.emit("subagents:rpc:spawn", { requestId, type, prompt: "Say hi.", options: { description: `probe ${type}`, ...(model ? { model } : {}) } });
      rec({ ev: "spawn-reply", type, model, reply: await reply });
    },
  });
}
