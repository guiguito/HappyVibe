import { spawn } from "node:child_process";
import path from "node:path";
import { PI_CLI_RELPATH } from "./pi/spawn";

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
  apiKey: string,
  firstUserMessage: string
): Promise<string | null> {
  const prompt =
    "Write a short title (3 to 6 words, no quotes, no trailing period) for a coding session " +
    `that starts with this request:\n\n${firstUserMessage.slice(0, 500)}\n\nReply with ONLY the title.`;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(runtimeDir, PI_CLI_RELPATH),
        "-p", "--no-session", "--no-tools", "--no-extensions",
        "--provider", "deepseek",
        "--model", "deepseek-v4-flash",
        prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: apiKey },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      const title = out.trim().split("\n").pop()?.trim().replace(/^["'\s]+|["'\s.]+$/g, "") ?? "";
      resolve(title && title.length <= 80 ? title : null);
    });
  });
}
