import fs from "node:fs";
import path from "node:path";
import { PiClient } from "./pi/PiClient";

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
  try {
    const fileOf = async (): Promise<string | undefined> =>
      ((await c.send({ type: "get_state" })).data as { sessionFile?: string } | undefined)?.sessionFile;
    const copy = await fileOf();
    if (!copy) throw new Error("Pi did not report the copied session.");
    if (!entryId) return copy;
    const r = await c.send({ type: "fork", entryId });
    if ((r.data as { cancelled?: boolean } | undefined)?.cancelled) throw new Error("Pi cancelled the fork.");
    const forked = await fileOf();
    if (!forked || forked === copy || !fs.existsSync(forked)) throw new Error("Pi did not write the forked session.");
    if (path.resolve(copy).startsWith(path.resolve(sessionDirPath) + path.sep)) fs.rmSync(copy, { force: true });
    return forked;
  } finally {
    c.stop();
  }
}
