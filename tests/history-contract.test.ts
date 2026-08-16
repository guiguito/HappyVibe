import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { contextItems } from "../src/main/history";
import { restoreItems, type RawMessage } from "../src/main/restore";

/**
 * §9 CONTRACT TEST — part of the Pi pin-bump gate (docs/validation/d1.md).
 *
 * Session restore no longer asks the child for `get_messages`; it rebuilds the
 * transcript from the session FILE (history.ts `contextItems`), because that RPC
 * is the first thing a freshly spawned Pi has to answer and therefore absorbs
 * the whole child boot — 1.35–2.86 s, 90%+ of every restore.
 *
 * That is only safe while our reading of the file matches Pi's own
 * `buildContextEntries` rule ([latest compaction] + entries from
 * firstKeptEntryId onward). So: hand Pi a session file, resume it, and assert
 * the two agree. A pin bump that changes the rule fails HERE rather than in the
 * GUI as a silently truncated conversation.
 *
 * Key-free: `get_messages` is a pure query over in-memory state — no turn, no
 * model call. (The provider flags are only there because Pi wants a model set.)
 */

const runtime = path.join(process.cwd(), "pi-runtime");
const CLI = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
let client: PiClient;
afterEach(() => client?.stop());

const SESSION_ID = "019f7cbb-0000-7000-8000-00000000beef";

/** A linear session file: parentId chained, `session` header first (version 3). */
function writeSession(file: string, entries: Record<string, unknown>[]): void {
  let parent: string | null = null;
  const lines = [
    JSON.stringify({
      type: "session", version: 3, id: SESSION_ID,
      timestamp: "2026-08-01T00:00:00.000Z", cwd: path.dirname(file),
    }),
  ];
  for (const e of entries) {
    lines.push(JSON.stringify({ parentId: parent, timestamp: "2026-08-01T00:00:00.000Z", ...e }));
    parent = e.id as string;
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

const msg = (id: string, role: string, text: string, ts: number): Record<string, unknown> => ({
  type: "message", id,
  message: { role, content: [{ type: "text", text }], timestamp: ts },
});

test.skipIf(!fs.existsSync(CLI))(
  "the session file rebuilds the same transcript Pi keeps in context",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-histcontract-"));
    const sessions = path.join(tmp, "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, `${SESSION_ID}.jsonl`);

    // Compacted: "one"/"two" are gone from context, "three"/"four" survive.
    writeSession(file, [
      msg("a", "user", "one", 1_000),
      msg("b", "assistant", "two", 2_000),
      msg("c", "user", "three", 3_000),
      { type: "compaction", id: "k1", summary: "A summary of earlier work.", tokensBefore: 1234, firstKeptEntryId: "c" },
      msg("d", "assistant", "four", 4_000),
    ]);
    const jsonl = fs.readFileSync(file, "utf8");

    client = new PiClient({
      execPath: process.execPath,
      args: [
        CLI, "--mode", "rpc", "--session-dir", sessions, "--session", file,
        "--provider", "deepseek", "--model", "deepseek-v4-flash",
      ],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: "sk-contract-noop",
        HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, ".config"),
      } as Record<string, string>,
      cwd: tmp,
    });
    await client.start();

    const res = await client.send({ type: "get_messages" });
    const raw = (res.data as { messages?: RawMessage[] })?.messages ?? [];
    expect(raw.length).toBeGreaterThan(0); // the resume actually loaded

    // The old restore path vs the new one, same file.
    expect(contextItems(jsonl)).toEqual(restoreItems(raw));
    // Round 15: items carry `ts`, and a turn's last bubble its duration. That
    // the assertion above still passes is the interesting half — it says Pi's
    // in-memory `get_messages` stamps its messages exactly as the file does, so
    // the two restore paths agree on timestamps and not merely on text.
    expect(contextItems(jsonl)).toEqual([
      { kind: "user", text: "three", ts: 3_000 },
      { kind: "assistant", text: "four", ts: 4_000, turnMs: 1_000 },
    ]);
  },
  60_000,
);
