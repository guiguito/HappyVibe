import { useState } from "react";

/**
 * API key setup/settings surface. Same behavior as the spike setup screen:
 * auto-skipped when a key already exists (.env DEEPSEEK_API_KEY in dev,
 * safeStorage otherwise) — App only forces this view when no key is present.
 */
export function SettingsView({
  hasKey,
  firstRun,
  onSaved,
}: {
  hasKey: boolean;
  firstRun: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const [keyInput, setKeyInput] = useState("");
  const valid = keyInput.startsWith("sk-");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto w-full px-8 py-10">
        {firstRun ? (
          <>
            <div className="size-14 rounded-2xl bg-tangerine border-2 border-ink/80 shadow-pop rotate-3 flex items-center justify-center mb-5">
              <span className="text-paper font-black text-xl -rotate-3">hv</span>
            </div>
            <h1 className="font-black text-3xl tracking-tight">
              Welcome to Happy<span className="text-tangerine">Vibe</span>
            </h1>
            <p className="text-ink-soft mt-2 mb-8">
              Bring your own key to wake the agent up. It stays on this machine.
            </p>
          </>
        ) : (
          <h1 className="font-black text-3xl tracking-tight mb-8">Settings</h1>
        )}

        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">api key</div>
          <div className="font-bold mb-1">DeepSeek API key</div>
          <p className="text-sm text-ink-soft mb-4">
            {hasKey
              ? "A key is configured. Paste a new one to replace it."
              : "No key yet. In dev, DEEPSEEK_API_KEY in .env also works."}
          </p>
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (!valid) return;
              await window.hv.setApiKey(keyInput);
              setKeyInput("");
              onSaved();
            }}
            className="flex gap-2"
          >
            <input
              type="password"
              placeholder="sk-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="flex-1 min-w-0 font-mono text-sm rounded-xl border-2 border-line bg-paper px-3.5 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
            />
            <button
              type="submit"
              disabled={!valid}
              className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2.5 border-2 border-tangerine-deep shadow-sticker transition-all enabled:hover:brightness-105 enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none enabled:cursor-pointer disabled:opacity-40"
            >
              Save
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
