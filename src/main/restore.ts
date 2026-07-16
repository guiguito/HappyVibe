/**
 * Reconstruct a session transcript from Pi's `get_messages` on reopen (round-4).
 * PURE + electron-free so it's unit-testable (tests/restore.test.ts).
 *
 * Pi's message model: user/assistant messages carry a `content` array of blocks
 * ({type:"text"} | {type:"thinking"} | {type:"toolCall", id, name, arguments}),
 * and tool output is a separate `role:"toolResult"` message with toolName/
 * toolCallId. The model-authored `intent` and the result both persist in the
 * file, so a reopened session can show the same tool cards it did live.
 */

export type RestoreItem =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; toolCallId: string; toolName: string; args: unknown; result?: string; error?: boolean };

export interface RawMessage {
  role?: string;
  content?: unknown;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

/** Concatenate the text blocks of a message's content (drops thinking/tool blocks). */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => ((b as { type?: string; text?: string }).type === "text" ? (b as { text?: string }).text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

export function restoreItems(raw: RawMessage[]): RestoreItem[] {
  const items: RestoreItem[] = [];
  const byCallId = new Map<string, Extract<RestoreItem, { kind: "tool" }>>();
  for (const m of raw) {
    if (m.role === "toolResult") {
      const tool = m.toolCallId ? byCallId.get(m.toolCallId) : undefined;
      if (tool) {
        tool.result = messageText(m.content);
        tool.error = m.isError === true;
      }
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "user") {
      const text = messageText(m.content).trim();
      if (text) items.push({ kind: "user", text });
      continue;
    }
    // Assistant: emit text bubbles and tool cards in document order (skip thinking).
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      const block = b as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
      if (block.type === "text" && block.text?.trim()) {
        items.push({ kind: "assistant", text: block.text });
      } else if (block.type === "toolCall" && block.id && block.name) {
        const tool: Extract<RestoreItem, { kind: "tool" }> = {
          kind: "tool",
          toolCallId: block.id,
          toolName: block.name,
          args: block.arguments,
        };
        items.push(tool);
        byCallId.set(block.id, tool);
      }
    }
  }
  return items;
}
