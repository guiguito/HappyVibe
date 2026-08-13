import type { TranscriptItem } from "./components/Transcript";

/**
 * Rebuild transcript items from a reopened session's restored messages
 * (`hv:open-session` → main's restore.ts). PURE, so the mapping is testable.
 *
 * WHY THIS IS ITS OWN MODULE. It rebuilds each item FIELD BY FIELD rather than
 * spreading, so any field main starts sending that is not named here is dropped
 * silently — the transcript simply renders as it did before the feature existed.
 * That is not hypothetical: §24's `command` was dropped exactly this way, and
 * every unit test still passed because both sides of the seam were correct and
 * nothing covered the seam itself. Adding a field to `RestoreItem` means adding
 * it here, and `tests/restore-map.test.ts` is what says so.
 *
 * Field-by-field is still the right shape — main's wire item and the renderer's
 * TranscriptItem are different types (ids, tool cards, plan cards), so a spread
 * would smuggle main's shape into the renderer. The fix is the test, not a spread.
 */

/** The restored-message shape main sends (mirrors `RestoreItem` in hv.d.ts). */
export type RestoredMessage =
  | {
      kind: "user" | "assistant";
      text: string;
      promptTemplate?: { typed: string };
      images?: string[];
      imagesDropped?: boolean;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      result?: string;
      error?: boolean;
      images?: string[];
      imagesDropped?: boolean;
    }
  | { kind: "plan"; planPath: string; status?: string; done?: number; total?: number };

/**
 * @param nextId monotonic id source (App's `idCounter`) — stable ids keep rewind
 * and React keys working, exactly as `appendItem` does for live messages.
 */
export function toTranscriptItems(
  messages: RestoredMessage[],
  ctx: { sessionId: string; workspaceId: string | null },
  nextId: () => number,
): TranscriptItem[] {
  return messages.map((m) => {
    if (m.kind === "tool") {
      // Reconstructed cards are terminal — "done" unless the file recorded an
      // error — and render collapsed by default.
      return {
        kind: "tool" as const,
        id: nextId(),
        card: {
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          args: m.args,
          status: m.error ? ("error" as const) : ("done" as const),
          result: m.result,
          // §7 round 12: a screenshot in a tool result. Named here for the
          // reason in this module's header — a field main sends that is not
          // listed is dropped silently, which is how it was lost to begin with.
          images: m.images,
          imagesDropped: m.imagesDropped,
        },
      };
    }
    if (m.kind === "plan") {
      // §23: the PlanCard at its original position, carrying the plan file's
      // real status/progress so the CTA is right on reopen.
      return {
        kind: "plan" as const,
        id: nextId(),
        card: {
          sessionId: ctx.sessionId,
          workspaceId: ctx.workspaceId,
          path: m.planPath,
          status: m.status ?? "draft",
          done: m.done ?? 0,
          total: m.total ?? 0,
        },
      };
    }
    // §24: `promptTemplate` rides along so a reopened session redraws the card
    // instead of the raw expansion. See the module comment before removing it.
    return {
      kind: m.kind,
      text: m.text,
      promptTemplate: m.promptTemplate,
      // §7 round 12: the attachment that vanished on reopen. Same rule as above.
      images: m.images,
      imagesDropped: m.imagesDropped,
      id: nextId(),
    };
  }) as TranscriptItem[];
}
