import fs from "node:fs";
import path from "node:path";
import { PiClient } from "./pi/PiClient";
import type { SessionMeta } from "./store";

type SpawnSpec = ConstructorParameters<typeof PiClient>[0];
type ClientLike = Pick<PiClient, "start" | "stop" | "send">;

/**
 * PRD §17 round 28 — fork/duplicate through a bare one-shot Pi (resolveForkSpawn): `--fork`
 * copies the whole session (the source is only READ), then RPC `fork <entryId>` branches the
 * copy before that message. Pi's own code writes the format; we only delete the intermediate copy.
 */
export async function forkSessionFile(
  spec: SpawnSpec,
  sessionDirPath: string,
  entryId?: string,
  make: (s: SpawnSpec) => ClientLike = (s) => new PiClient(s),
): Promise<string> {
  const c = make(spec);
  await c.start();
  let copy: string | undefined;
  let result: string | undefined;
  try {
    const fileOf = async (): Promise<string | undefined> =>
      ((await c.send({ type: "get_state" })).data as { sessionFile?: string } | undefined)?.sessionFile;
    copy = await fileOf();
    if (!copy || !fs.existsSync(copy)) throw new Error("Pi did not write the forked session.");
    if (!entryId) return (result = copy);
    const r = await c.send({ type: "fork", entryId });
    if ((r.data as { cancelled?: boolean } | undefined)?.cancelled) throw new Error("Pi cancelled the fork.");
    const forked = await fileOf();
    if (!forked || forked === copy || !fs.existsSync(forked)) throw new Error("Pi did not write the forked session.");
    return (result = forked);
  } finally {
    c.stop();
    // The intermediate copy goes on every path but the duplicate (where it IS the result).
    if (entryId && copy && result !== copy && path.resolve(copy).startsWith(path.resolve(sessionDirPath) + path.sep)) fs.rmSync(copy, { force: true });
  }
}

/** The new session's fields — pure. Never a schedule (a fork of a run is the user's now), never `hibernated`. */
export function forkMeta(o: SessionMeta, kind: "fork" | "duplicate", at: string): Partial<SessionMeta> {
  return {
    title: `${o.title} (${kind === "fork" ? "fork" : "copy"})`,
    titleSource: o.titleSource,
    ...(o.model ? { model: o.model } : {}),
    ...(o.thinking ? { thinking: o.thinking } : {}),
    forkedFrom: { sessionId: o.id, at },
  };
}
