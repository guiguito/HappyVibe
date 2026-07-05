// Scripted stand-in for `pi --mode rpc`: reads NDJSON commands on stdin,
// answers like Pi would. Also emits one garbage line to test resilience.
import readline from "node:readline";
process.stdout.write("GARBAGE NOT JSON\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const cmd = JSON.parse(line);
  if (cmd.type === "prompt") {
    // Echo streamingBehavior back (data) and emit a queue_update like real Pi
    // does when a steer/followUp is queued — lets tests assert passthrough.
    const data = cmd.streamingBehavior ? { streamingBehavior: cmd.streamingBehavior } : undefined;
    process.stdout.write(JSON.stringify({ id: cmd.id, type: "response", command: "prompt", success: true, data }) + "\n");
    if (cmd.streamingBehavior) {
      process.stdout.write(
        JSON.stringify({
          type: "queue_update",
          steering: cmd.streamingBehavior === "steer" ? [cmd.message] : [],
          followUp: cmd.streamingBehavior === "followUp" ? [cmd.message] : [],
        }) + "\n"
      );
    }
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } }) + "\n");
    process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "fake" }) + "\n");
    process.stdout.write(JSON.stringify({ type: "agent_end", messages: [] }) + "\n");
  } else if (cmd.type === "extension_ui_response") {
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ui-ack" } }) + "\n");
  } else if (cmd.type === "crash_now") {
    process.exit(7);
  } else {
    process.stdout.write(JSON.stringify({ id: cmd.id, type: "response", command: cmd.type, success: true, data: {} }) + "\n");
  }
});
