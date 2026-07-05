import * as Dialog from "@radix-ui/react-dialog";
import type { PermissionChoice, PermissionInfo, UiRequest } from "../permission";

const CHOICE_STYLE: Record<string, string> = {
  Allow: "bg-leaf text-paper border-ink/80 hover:brightness-105",
  "Allow for session": "bg-honey text-ink border-ink/80 hover:brightness-105",
  Deny: "bg-card text-berry border-berry hover:bg-berry-soft",
};

export function PermissionModal({
  req,
  info,
  onChoice,
}: {
  req: UiRequest;
  info: PermissionInfo;
  onChoice: (c: PermissionChoice) => void;
}): React.JSX.Element {
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
              <Dialog.Description className="text-sm text-ink-soft">
                Tool: <span className="font-bold text-ink">{info.tool || "unknown"}</span>
              </Dialog.Description>
            </div>
          </div>
          <pre className="font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all max-h-48 mb-5">
            {info.summary}
          </pre>
          <div className="flex flex-col gap-2">
            {(req.options ?? ["Allow", "Allow for session", "Deny"]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onChoice(o as PermissionChoice)}
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
