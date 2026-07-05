/**
 * Pending steering / follow-up queue, mirrored from Pi's `queue_update` events
 * (`{type: "queue_update", steering: string[], followUp: string[]}` — docs/rpc.md).
 * Abort preserves the queue, so chips survive Stop by construction.
 */

export interface QueueState {
  steering: string[];
  followUp: string[];
}

export const emptyQueue: QueueState = { steering: [], followUp: [] };

/**
 * Apply a forwarded queue_update event. `delivered` is the messages that left
 * the queue since `prev` — i.e. they were handed to the agent and should now
 * appear in the transcript as user messages.
 */
export function applyQueueUpdate(
  prev: QueueState,
  e: Record<string, unknown>
): { queue: QueueState; delivered: string[] } {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const queue = { steering: arr(e.steering), followUp: arr(e.followUp) };
  const gone = (old: string[], now: string[]): string[] => {
    const remaining = [...now];
    return old.filter((m) => {
      const i = remaining.indexOf(m);
      if (i >= 0) {
        remaining.splice(i, 1);
        return false;
      }
      return true;
    });
  };
  return { queue, delivered: [...gone(prev.steering, queue.steering), ...gone(prev.followUp, queue.followUp)] };
}
