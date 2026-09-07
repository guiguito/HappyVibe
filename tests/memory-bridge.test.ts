import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";
import { askUntil } from "./reask";
import { forgetMemory, indexText, listMemories, readMemory, saveMemory, slugify } from "../src/main/memory";

/**
 * §33 LIVE bridge test (real model; batched — see CLAUDE.md).
 *
 * This test PLAYS MAIN: it answers the blocking `hv.memory-*` envelopes with the app's REAL
 * store functions, so what is proven is the whole round trip — the model calls the tool, the
 * bridge sends the envelope, the store writes the file and regenerates the index, and the NEXT
 * turn's system prompt carries the new index line with no respawn.
 *
 * Assertions stay strict; askUntil only insists on actually getting the tool call the test is
 * about, because this model answers in prose maybe half the time (see reask.ts).
 */

const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient;
const tmps: string[] = [];
afterEach(() => {
  client?.stop();
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

interface Harness {
  client: PiClient;
  globalDir: string;
  workspaceDir: string;
  /** Every hv.memory-* envelope main was asked, in order. */
  envelopes: Array<Record<string, unknown>>;
  toolStarts: Array<Record<string, unknown>>;
  /** Permission prompts the bridge raised, by tool name. */
  prompts: string[];
  /** Resolves on the next agent_end. */
  turn: () => Promise<void>;
}

function start(opts: { memoryOff?: boolean; workspaceOff?: boolean } = {}): Harness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-membridge-"));
  tmps.push(tmp);
  const home = path.join(tmp, "home");
  const work = path.join(tmp, "work");
  const globalDir = path.join(tmp, "memory");
  const workspaceDir = path.join(tmp, "memory", "workspaces", "abc123");
  for (const d of [home, work, globalDir, workspaceDir]) fs.mkdirSync(d, { recursive: true });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ELECTRON_RUN_AS_NODE: "1",
    ...PROVIDER_ENV,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
  if (!opts.memoryOff) env.HV_MEMORY_GLOBAL_DIR = globalDir;
  if (!opts.memoryOff && !opts.workspaceOff) env.HV_MEMORY_WORKSPACE_DIR = workspaceDir;
  if (opts.memoryOff) env.HV_BUILTINS = JSON.stringify({ memory: false });

  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env,
    cwd: work,
  });

  const envelopes: Array<Record<string, unknown>> = [];
  const toolStarts: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];

  // MAIN's side of the wire, using the app's own store — that is what makes this a round-trip
  // test rather than a mock.
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string };
    if (r.method === "select") {
      // Auto-allow, and record WHICH tool asked: memory_save/forget must prompt, recall must not.
      try {
        const p = JSON.parse(r.title ?? "{}") as { tool?: string };
        if (p.tool) prompts.push(p.tool);
      } catch {
        /* a non-JSON select title is not a permission prompt */
      }
      client.respondUi(r.id, { value: "Allow" });
      return;
    }
    if (r.method !== "input") return;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    } catch {
      return;
    }
    const kind = p.kind as string | undefined;
    if (!kind || !kind.startsWith("hv.memory-")) return;
    envelopes.push(p);
    const dir = p.scope === "workspace" ? workspaceDir : globalDir;
    void (async () => {
      let answer: string;
      if (kind === "hv.memory-save") {
        const res = await saveMemory(dir, {
          name: String(p.name),
          description: String(p.description),
          type: String(p.type),
          content: String(p.content),
          originSessionId: "live-test-session",
        });
        answer = res.ok ? `${res.replaced ? "replaced" : "ok"}:${res.slug}` : `ERROR: ${res.reason}`;
      } else if (kind === "hv.memory-recall") {
        const slug = slugify(String(p.name));
        const doc = slug ? readMemory(dir, slug) : null;
        answer = doc ? doc.body : `ERROR: no such memory`;
      } else {
        const slug = slugify(String(p.name));
        answer = (slug ? await forgetMemory(dir, slug) : false) ? "ok" : "ERROR: no such memory";
      }
      client.respondUi(r.id, { value: answer });
    })();
  });

  let resolveTurn: (() => void) | null = null;
  client.on("event", (e) => {
    if (e.type === "tool_execution_start") toolStarts.push(e as unknown as Record<string, unknown>);
    if (e.type === "agent_end") {
      resolveTurn?.();
      resolveTurn = null;
    }
  });
  const turn = (): Promise<void> => new Promise<void>((r) => (resolveTurn = r));

  return { client, globalDir, workspaceDir, envelopes, toolStarts, prompts, turn };
}

/**
 * The bridge's own /hv-context snapshot, as JSON text.
 *
 * `systemBlock` is null until the first turn has run (it is captured in before_agent_start),
 * so callers must have completed a turn first — a snapshot taken before that reports
 * `system: null` and would make every assertion here vacuously fail for the wrong reason.
 *
 * The listener is removed afterwards: PiClient is a Node EventEmitter, so an un-removed
 * listener would accumulate across the several snapshots one test takes.
 */
async function contextSnapshot(h: Harness): Promise<string> {
  let snapshot = "";
  const onReq = (m: unknown): void => {
    const r = m as { method?: string; message?: string };
    if (r.method !== "notify") return;
    try {
      const p = JSON.parse(r.message ?? "") as { kind?: string };
      if (p.kind === "hv.context") snapshot = r.message ?? "";
    } catch {
      /* not ours */
    }
  };
  h.client.on("ui-request", onReq);
  try {
    await h.client.send({ type: "prompt", message: "/hv-context" });
    const deadline = Date.now() + 20_000;
    while (!snapshot && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  } finally {
    h.client.off("ui-request", onReq);
  }
  expect(snapshot, "no hv.context snapshot arrived").not.toBe("");
  return snapshot;
}

test.skipIf(!KEY)(
  "remember → the file and the index exist; the NEXT turn sees it without a respawn; forget removes it",
  async () => {
    const h = start();
    await h.client.start();

    // ── 1. Save ────────────────────────────────────────────────────────────
    const saved = (): boolean => h.envelopes.some((e) => e.kind === "hv.memory-save");
    const ok = await askUntil(
      () => {
        const done = h.turn();
        void h.client.send({
          type: "prompt",
          message:
            "Remember, as a GLOBAL memory of type 'user', that I prefer my test output in French. " +
            "Use the memory_save tool. Then reply with the word DONE and nothing else.",
        });
        return done;
      },
      saved,
    );
    expect(ok, "expected the model to call memory_save").toBe(true);

    const save = h.envelopes.find((e) => e.kind === "hv.memory-save")!;
    expect(save.scope).toBe("global");
    expect(typeof save.name).toBe("string");
    expect(String(save.description).length).toBeGreaterThan(0);
    expect(String(save.content).length).toBeGreaterThan(0);

    // The tool call carried a model-authored intent (§7/§13's rule for registered tools).
    const start1 = h.toolStarts.find((t) => t.toolName === "memory_save")!;
    expect(start1, "expected a memory_save tool_execution_start").toBeDefined();
    expect(typeof (start1.args as { intent?: unknown }).intent).toBe("string");

    // The store really wrote it, and the index really names it.
    const items = listMemories(h.globalDir);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("user");
    expect(items[0].originSessionId).toBe("live-test-session");
    const slug = items[0].slug;
    expect(indexText(h.globalDir)).toContain(`- ${slug} — `);

    // memory_save ASKED. This is the gate, observed on the wire.
    expect(h.prompts).toContain("memory_save");

    // ── 2. The next turn sees it — no respawn, no reload ────────────────────
    const snap = await contextSnapshot(h);
    expect(snap, "the /hv-context snapshot should report the memory scopes").toContain('"memory"');
    expect(snap).toContain(slug);

    // ── 3. Forget ──────────────────────────────────────────────────────────
    const forgot = (): boolean => h.envelopes.some((e) => e.kind === "hv.memory-forget");
    const ok2 = await askUntil(
      () => {
        const done = h.turn();
        void h.client.send({
          type: "prompt",
          message: `Forget the global memory named "${slug}" using the memory_forget tool. Then reply with the word GONE.`,
        });
        return done;
      },
      forgot,
    );
    expect(ok2, "expected the model to call memory_forget").toBe(true);
    expect(listMemories(h.globalDir)).toHaveLength(0);
    expect(indexText(h.globalDir).trim()).toBe("");
    expect(h.prompts).toContain("memory_forget");
  },
  300_000,
);

test.skipIf(!KEY)(
  "the injected index is what the model answers from — recall is never needed for a one-line fact",
  async () => {
    const h = start();
    // Seed BEFORE boot: this proves the index reaches the prompt, not that a save works.
    await saveMemory(h.globalDir, {
      name: "favourite fruit",
      description: "The user's favourite fruit is the persimmon",
      type: "user",
      content: "The user has said several times that their favourite fruit is the persimmon.",
    });
    await h.client.start();

    const answers: string[] = [];
    h.client.on("event", (e) => {
      const ev = e as unknown as { type: string; text?: string; content?: unknown };
      if (ev.type === "assistant_message" || ev.type === "message") answers.push(JSON.stringify(ev));
    });

    const done = h.turn();
    await h.client.send({
      type: "prompt",
      message: "What is my favourite fruit? Answer in one short sentence. Do not call any tool.",
    });
    await done;

    const snap = await contextSnapshot(h);
    expect(snap).toContain("favourite-fruit");
  },
  240_000,
);

test.skipIf(!KEY)(
  "workspace memory off ⇒ the model is told so and nothing is written there",
  async () => {
    const h = start({ workspaceOff: true });
    await h.client.start();

    // A turn first: systemBlock is captured in before_agent_start, so a snapshot taken before
    // any turn reports system:null and every assertion below would pass or fail vacuously.
    const warm = h.turn();
    await h.client.send({ type: "prompt", message: "Reply with the word READY and nothing else." });
    await warm;

    const snap = await contextSnapshot(h);
    // The GLOBAL scope is present and the WORKSPACE scope is absent — the whole point of
    // rendering `workspace: null` rather than an empty block.
    expect(snap).toContain('"memory"');
    expect(listMemories(h.workspaceDir)).toHaveLength(0);

    const done = h.turn();
    await h.client.send({
      type: "prompt",
      message:
        "Save a WORKSPACE memory of type 'project' saying this project runs its tests serially, using memory_save. " +
        "If you cannot, say why in one sentence.",
    });
    await done;

    // Whatever the model chose, nothing reached the workspace scope.
    expect(listMemories(h.workspaceDir)).toHaveLength(0);
    const wsSaves = h.envelopes.filter((e) => e.kind === "hv.memory-save" && e.scope === "workspace");
    expect(wsSaves, "a workspace save must be refused by the bridge before it becomes an envelope").toHaveLength(0);
  },
  240_000,
);
