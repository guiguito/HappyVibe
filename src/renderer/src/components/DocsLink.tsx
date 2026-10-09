import { createContext } from "react";
import { DOC_SLUG, docUrl } from "../docsLinks";
import type { View } from "./Sidebar";

/** Opens a guide page in the app (App's openDocs). A context, like NavContext, so a lock
    line three components deep needs no prop threaded down to it. */
export const OpenDocsContext = createContext<(url: string) => void>(() => {});

/**
 * Docs round (2026-09-28): the one help link every settings screen gets. It sits
 * under the page, pushed to the bottom, so it never covers a page's own header
 * actions (Terminal's "Reset all" sits top right).
 */
export function DocsLink({ view, onOpen }: { view: View; onOpen: (url: string) => void }): React.JSX.Element | null {
  const slug = DOC_SLUG[view];
  if (!slug) return null;
  return (
    <div className="mt-auto shrink-0 border-t-2 border-line px-6 py-2 flex justify-end">
      <button
        type="button"
        onClick={() => onOpen(docUrl(slug))}
        className="text-[13px] font-bold text-ink-soft hover:text-ink cursor-pointer"
      >
        How this page works ↗
      </button>
    </div>
  );
}
