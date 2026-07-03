// Deliberately loose: Pi's payloads are richer than we type. Unknown fields flow through.
export interface PiMessageBase { type: string; [k: string]: unknown }

export interface PiResponse extends PiMessageBase {
  type: "response"; id?: string; command: string; success: boolean; data?: unknown; error?: string;
}
export interface ExtensionUiRequest extends PiMessageBase {
  type: "extension_ui_request"; id: string; method: string; title?: string; options?: string[];
}
export type PiEvent = PiMessageBase; // message_update, tool_execution_*, agent_*, etc.

export type PiCommand =
  | { id: string; type: "prompt"; message: string }
  | { id: string; type: "abort" }
  | { id: string; type: "new_session" }
  | { id: string; type: "get_session_stats" };
