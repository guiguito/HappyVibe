import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AuthEvent } from "../auth";

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg border-2 border-line bg-card px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer hover:bg-honey-soft active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2.5 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-5 py-2.5 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

/**
 * Renders an in-flight OAuth login driven by hv.auth events from the bridge
 * (device codes, auth URLs, prompts, selects, progress, success, error).
 */
export function AuthFlowModal({
  providerLabel,
  event,
  onCancel,
  onClose,
}: {
  providerLabel: string;
  event: AuthEvent | null;
  onCancel: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  const stage = event?.stage;
  const terminal = stage === "success" || stage === "error";

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(28rem,calc(100vw-3rem))] rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Dialog.Title className="font-bold text-lg leading-tight mb-1">
            Sign in with {providerLabel}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-ink-soft mb-4">
            {stage === "success"
              ? "You're signed in."
              : stage === "error"
                ? "Sign-in didn't finish."
                : "HappyVibe never sees your password — the provider does the sign-in."}
          </Dialog.Description>

          {(!event || stage === "progress") && (
            <div className="flex items-center gap-2 text-sm text-ink-soft mb-4">
              <span className="size-2 rounded-full bg-honey animate-pulse shrink-0" />
              {event?.message ?? "Contacting provider…"}
            </div>
          )}

          {event?.stage === "auth_url" && event.url && (
            <div className="mb-4">
              <p className="text-sm mb-3">{event.instructions ?? "Finish signing in from your browser. This window updates automatically."}</p>
              <div className="flex items-center gap-2">
                <button type="button" className={primaryBtn} onClick={() => void window.hv.openExternal(event.url!)}>
                  Open browser
                </button>
                <CopyButton text={event.url} />
              </div>
              <p className="font-mono text-[11px] text-ink-soft break-all mt-3">{event.url}</p>
            </div>
          )}

          {event?.stage === "device_code" && (
            <div className="mb-4">
              <p className="text-sm mb-3">Enter this code at the provider:</p>
              <div className="flex items-center gap-3 mb-3">
                <div className="font-mono font-black text-2xl tracking-[0.15em] bg-paper-deep border-2 border-line rounded-xl px-4 py-2">
                  {event.userCode}
                </div>
                <CopyButton text={event.userCode ?? ""} />
              </div>
              {event.verificationUri && (
                <button type="button" className={primaryBtn} onClick={() => void window.hv.openExternal(event.verificationUri!)}>
                  Open {event.verificationUri.replace(/^https?:\/\//, "")}
                </button>
              )}
            </div>
          )}

          {(event?.stage === "prompt" || event?.stage === "manual_code") && (
            <form
              className="mb-4 flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                window.hv.respondInput(event.reqId, input);
                setInput("");
              }}
            >
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={event.placeholder ?? event.message}
                title={event.message}
                className="flex-1 min-w-0 font-mono text-sm rounded-xl border-2 border-line bg-paper px-3.5 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
              />
              <button type="submit" className={primaryBtn}>OK</button>
            </form>
          )}

          {event?.stage === "select" && (
            <div className="mb-4">
              <p className="text-sm mb-3">{event.message}</p>
              <div className="flex flex-col gap-2">
                {(event.options ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => window.hv.respondInput(event.reqId, o)}
                    className="rounded-xl border-2 border-line bg-card px-4 py-2.5 font-bold text-sm text-left shadow-sticker cursor-pointer hover:bg-honey-soft active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stage === "success" && (
            <div className="flex items-center gap-2 text-leaf font-bold mb-4">
              <span className="size-5 rounded-full bg-leaf-soft border-2 border-leaf flex items-center justify-center text-xs">✓</span>
              Signed in to {providerLabel}.
            </div>
          )}

          {event?.stage === "error" && (
            <div className="rounded-xl bg-berry-soft border-2 border-berry/50 text-berry text-sm px-4 py-3 mb-4 break-words">
              {event.message ?? "Something went wrong."}
            </div>
          )}

          <div className="flex justify-end">
            {terminal ? (
              <button type="button" className={primaryBtn} onClick={onClose}>Done</button>
            ) : (
              <button type="button" className={ghostBtn} onClick={onCancel}>Cancel</button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
