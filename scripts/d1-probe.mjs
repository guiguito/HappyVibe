import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const ext = path.join(root, "scripts/d1-probe-ext.ts");

console.log("[info] Spawning Pi RPC with probe extension:", ext);

const child = spawn(process.execPath, [cli, "--mode", "rpc", "-e", ext, "--no-session"], {
  cwd: root, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"],
});

// Collect Pi's stderr to detect D1-PROBE-RESULT
let probeResultSeen = false;
child.stderr.on("data", (d) => {
  const text = d.toString().trim();
  console.log("[stderr]", text);
  if (text.includes("D1-PROBE-RESULT:")) {
    probeResultSeen = true;
    console.log("ROUND-TRIP COMPLETE:", text);
    // Give a moment then kill Pi cleanly
    setTimeout(() => child.kill(), 500);
  }
});

const rl = readline.createInterface({ input: child.stdout });

let uiRequestSeen = false;

// Hard timeout — if no extension_ui_request within 20s, verdict is NO
const hardTimer = setTimeout(() => {
  if (!uiRequestSeen) {
    console.log("VERDICT: NO ui request within 20s -> Path B");
  } else if (!probeResultSeen) {
    console.log("VERDICT: NO round-trip (response not processed within 20s) -> Path B");
  }
  child.kill();
  process.exit(1);
}, 20000);

rl.on("line", (line) => {
  console.log("[stdout]", line);
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.type === "extension_ui_request") {
    uiRequestSeen = true;
    console.log("VERDICT: YES — extension_ui_request observed. Replying...");
    console.log("[info] Request method:", msg.method, "| id:", msg.id);

    let response;
    if (msg.method === "confirm") {
      // Correct shape per RpcExtensionUIResponse type definition: { confirmed: boolean }
      response = { type: "extension_ui_response", id: msg.id, confirmed: true };
    } else if (msg.method === "select") {
      response = { type: "extension_ui_response", id: msg.id, value: msg.options ? msg.options[0] : "ok" };
    } else {
      response = { type: "extension_ui_response", id: msg.id, value: "ok" };
    }

    console.log("[info] Sending response:", JSON.stringify(response));
    child.stdin.write(JSON.stringify(response) + "\n");
  }
});

child.on("exit", (c) => {
  clearTimeout(hardTimer);
  console.log("pi exited", c);
  if (probeResultSeen) {
    console.log("FINAL VERDICT: YES / Path A — full round-trip confirmed");
  } else if (uiRequestSeen) {
    console.log("FINAL VERDICT: PARTIAL — extension_ui_request seen but D1-PROBE-RESULT not received");
  } else {
    console.log("FINAL VERDICT: NO / Path B — no extension_ui_request observed");
  }
});
