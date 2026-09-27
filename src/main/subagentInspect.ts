/** The expanded run card's transcript, as main reads it off the child's session file (twChildren.ts `twInspect`). */
export interface InspectMessage {
  role: string;
  kind: "text" | "toolCall" | "toolResult";
  text: string;
  name?: string;
  isError?: boolean;
}

export interface InspectReply {
  requestId: string;
  asyncId?: string;
  childId?: string;
  status?: string;
  label?: string;
  task?: string;
  messages?: InspectMessage[];
  finalOutput?: string;
  truncated?: { task: boolean; messages: number; finalOutput: boolean };
  error?: { code: string; message: string };
}
