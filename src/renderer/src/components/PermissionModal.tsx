import * as Dialog from "@radix-ui/react-dialog";
import type { PermissionChoice, PermissionInfo, UiRequest } from "../permission";
import { toolLabel } from "../toolLabel";
import { ToolIcon } from "./ToolCard";

/**
 * W1.1: rebuild enough args from the bridge's summary to feed toolLabel — the
 * wire shape ({tool, summary}) is unchanged. bash summaries ARE the command;
 * other summaries are JSON.stringify(input) (may be truncated → parse fails →
 * toolLabel falls back to a derived/prettified label).
 */
function argsFromSummary(tool: string, summary: string): unknown {
  if (tool === "bash") return { command: summary };
  try {
    return JSON.parse(summary);
  } catch {
    return undefined;
  }
}

const CHOICE_STYLE: Record<string, string> = {
  Allow: "bg-leaf text-paper border-ink/80 hover:brightness-105",
  "Allow for session": "bg-honey text-ink border-ink/80 hover:brightness-105",
  "Allow for workspace": "bg-card text-ink border-ink/80 hover:bg-paper-deep",
  "Always allow": "bg-card text-ink border-ink/80 hover:bg-paper-deep",
  Deny: "bg-card text-berry border-berry hover:bg-berry-soft",
};

/** Round 3 #13: the bridge only offers Allow / Allow for session / Deny. The
    renderer adds two persistent-grant choices (workspace / global) that write a
    rule; App maps them to a bridge "Allow". */
const EXPANDED_CHOICES: PermissionChoice[] = [
  "Allow",
  "Allow for session",
  "Allow for workspace",
  "Always allow",
  "Deny",
];

export function PermissionModal({
  req,
  info,
  onChoice,
}: {
  req: UiRequest;
  info: PermissionInfo;
  onChoice: (c: PermissionChoice) => void;
}): React.JSX.Element {
  const { icon, label } = toolLabel(info.tool, argsFromSummary(info.tool, info.summary));
  // Standard allow/deny prompt → offer the expanded persistent-grant choices (#13);
  // any non-standard option set from the bridge is shown verbatim.
  const wire = req.options ?? ["Allow", "Allow for session", "Deny"];
  const shown = wire.includes("Allow") && wire.includes("Deny") ? EXPANDED_CHOICES : (wire as PermissionChoice[]);
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(30rem,calc(100vw-3rem))] rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none"
          // Prompts never auto-allow and never time out: the only way out is a button.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-xl bg-honey border-2 border-ink/80 flex items-center justify-center -rotate-3 shrink-0">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="10" rx="2.5" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <div className="min-w-0">
              <Dialog.Title className="font-bold text-lg leading-tight">The agent wants to run something</Dialog.Title>
              {/* W1.1: human summary line (same toolLabel as the tool cards). */}
              <Dialog.Description className="text-sm text-ink flex items-center gap-1.5">
                <ToolIcon kind={icon} className="size-4 shrink-0 text-ink-soft" />
                <span className="font-bold break-words">{label}</span>
              </Dialog.Description>
            </div>
          </div>
          {/* Raw tool name + summary stay available behind a collapsed toggle. */}
          <details className="mb-5">
            <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-ink-soft">
              details
            </summary>
            <pre className="mt-2 font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
              <span className="font-bold">{info.tool || "unknown"}</span>
              {"\n"}
              {info.summary}
            </pre>
          </details>
          <div className="flex flex-col gap-2">
            {shown.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onChoice(o)}
                className={`rounded-xl border-2 px-4 py-2.5 font-bold text-sm shadow-sticker transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
                  CHOICE_STYLE[o] ?? CHOICE_STYLE.Allow
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
