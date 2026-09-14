import { spawn } from "node:child_process";
import path from "node:path";
import { PI_CLI_RELPATH, nodeExecPath } from "./pi/spawn";

export type ExportResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * §17 round 24 — a session becomes a self-contained HTML page.
 *
 * Why the CLI and not the RPC: Pi 0.85.0 offers both, and `export_html` over
 * RPC needs a LIVE client — so it would cover open sessions only and would have
 * to wake a hibernated one first. `pi --export <session.jsonl> [out.html]`
 * reads the FILE, so a live, hibernated, archived and closed session all export
 * identically. No wake, no RPC, no model call, no API key: the `titles.ts`
 * pattern minus the model.
 *
 * stdio[0] is "ignore" — README gotcha: a one-shot Pi call hangs if stdin stays
 * open. `nodeExecPath()` routes through the bundled Electron helper so the
 * child never claims a Dock icon of its own.
 */
export function exportSessionHtml(runtimeDir: string, sessionFile: string, outPath: string): Promise<ExportResult> {
  return new Promise((resolve) => {
    const child = spawn(
      nodeExecPath(),
      [path.join(runtimeDir, PI_CLI_RELPATH), "--export", sessionFile, outPath],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    let err = "";
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => {
      if (code === 0) return resolve({ ok: true, path: outPath });
      // Pi prints its own reason ("Nothing to export yet - start a conversation
      // first", "File not found: …") in colour. Surface it rather than a bare
      // exit code: §7's rule that a banner whose explanation sits in a console
      // nobody is watching is the same dishonesty as an unlabelled number.
      // eslint-disable-next-line no-control-regex
      const plain = err.replace(/\[[0-9;]*m/g, "").trim();
      resolve({ ok: false, error: plain || `Export failed (exit ${code}).` });
    });
  });
}
