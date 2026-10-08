/** Privacy round D1/D2: the one shape of a switch an environment variable holds off. Names no variable. */
import { useContext } from "react";
import { OpenDocsContext } from "./DocsLink";
import { docUrl } from "../docsLinks";

export const LOCK_COPY = { line: "Turned off on this computer by an environment setting.", more: "Learn more" } as const;

export function LockLine(): React.JSX.Element {
  const openDocs = useContext(OpenDocsContext);
  return (
    <p className="text-xs text-ink-soft mt-1">
      {LOCK_COPY.line}{" "}
      <button type="button" className="underline cursor-pointer" onClick={() => openDocs(docUrl("privacy", "on-a-managed-computer"))}>
        {LOCK_COPY.more}
      </button>
    </p>
  );
}
