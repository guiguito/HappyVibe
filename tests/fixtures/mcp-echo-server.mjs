// Minimal MCP stdio server: one tool `echo`. Zero deps — the MCP stdio
// transport is newline-delimited JSON-RPC, so a hand-rolled server keeps the
// contract test hermetic and pins the wire shape.
import readline from "node:readline";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const TOOL = {
  name: "echo",
  description: "Echoes back the provided text.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") {
    send({ jsonrpc: "2.0", id: m.id, result: {
      protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "echo-fixture", version: "1.0.0" },
    }});
  } else if (m.method === "tools/list") {
    send({ jsonrpc: "2.0", id: m.id, result: { tools: [TOOL] } });
  } else if (m.method === "tools/call") {
    const text = m.params?.arguments?.text ?? "";
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } });
  } else if (m.method === "ping") {
    send({ jsonrpc: "2.0", id: m.id, result: {} });
  } else if (m.id !== undefined) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  } // notifications (initialized etc.) are ignored
});
