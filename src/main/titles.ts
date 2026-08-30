import { spawn } from "node:child_process";
import path from "node:path";
import { PI_CLI_RELPATH, nodeExecPath } from "./pi/spawn";

/**
 * Model-generated session title via a one-shot `pi -p` (print mode) call.
 *
 * Why this path: Pi's RPC exposes no side-channel model call (a `prompt` on the
 * live session would pollute its context), and calling the provider HTTP API
 * directly would mean re-implementing Pi's provider/model resolution. Print
 * mode reuses the exact same provider stack for one cheap flash-model call.
 * `--no-tools --no-extensions --no-session` keeps it pure text and leaves no
 * session file behind. stdin is "ignore" — README gotcha: one-shot Pi calls
 * hang if stdin stays open.
 *
 * Fire-and-forget: resolves null on any failure; the truncated-first-message
 * fallback title stays in place. Never blocks the chat.
 */
export function generateTitle(
  runtimeDir: string,
  workspace: string,
  firstUserMessage: string,
  opts: {
    model?: { provider: string; modelId: string } | null;
    env?: Record<string, string>;
    /** Round 15: where to record that this call happened. Optional — a caller
        without a log still gets its title, it just goes unrecorded. */
    onDone?: (o: { model: { provider: string; modelId: string }; promptChars: number; outputChars: number; ok: boolean }) => void;
  } = {}
): Promise<string | null> {
  // §16 finding 7 (2026-08-29): no configured model means NO call. This used
  // to fall back to a hardcoded deepseek/deepseek-v4-flash, so a user with no
  // DeepSeek key got a silent failure — and one WITH a key was billed for a
  // provider they had not chosen for this. Callers already treat null as
  // "no title", which is the honest answer when nothing is set up.
  const model = opts.model;
  if (!model) return Promise.resolve(null);
  const prompt =
    "Write a short title (3 to 6 words, no quotes, no trailing period) for a coding session " +
    `that starts with this request:\n\n${firstUserMessage.slice(0, 500)}\n\nReply with ONLY the title.`;
  return new Promise((resolve) => {
    const child = spawn(
      nodeExecPath(),
      [
        path.join(runtimeDir, PI_CLI_RELPATH),
        "-p", "--no-session", "--no-tools", "--no-extensions",
        "--provider", model.provider,
        "--model", model.modelId,
        prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    const done = (ok: boolean): void =>
      opts.onDone?.({ model, promptChars: prompt.length, outputChars: out.length, ok });
    child.on("error", () => {
      done(false);
      resolve(null);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        done(false);
        return resolve(null);
      }
      const title = out.trim().split("\n").pop()?.trim().replace(/^["'\s]+|["'\s.]+$/g, "") ?? "";
      const ok = !!title && title.length <= 80;
      done(ok);
      resolve(ok ? title : null);
    });
  });
}
