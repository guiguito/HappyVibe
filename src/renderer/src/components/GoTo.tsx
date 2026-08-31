import { createContext, useContext } from "react";
import { NAV, type View } from "./Sidebar";

/**
 * §20 round 17 — a pointer to another page is a LINK that goes there.
 *
 * The audit found five different phrasings for "go to another page" and not one
 * of them clickable, including `the gear in the sidebar`, which describes
 * chrome instead of naming a destination.
 *
 * The decision that shapes this: EVERY pointer links, including the ones
 * rendered in chat. A dead pointer is worse than a context switch the user
 * chose by clicking. That is why this cannot be a bare `setView` — a settings
 * destination also has to expand the sidebar's Settings group (the ⌘, pattern
 * at App.tsx:2190), and a workspace destination has to select the workspace
 * first. One `navigate(target)` callback in App owns all three, and the context
 * is what keeps the call sites from prop-drilling it through five levels.
 */
export type NavTarget = { view: View; workspace?: string };

/**
 * Defaults to a no-op so a component rendered outside the provider degrades to
 * inert text rather than throwing.
 */
export const NavContext = createContext<(t: NavTarget) => void>(() => {});

/**
 * DERIVED from the sidebar's own NAV: a pointer is phrased the way the sidebar
 * NAMES the destination, so the word you read is the word you then look for.
 * Never hand-list these — `tests/go-to.test.ts` checks them against Sidebar's
 * source text, so a NAV label renamed without its pointers fails there.
 */
export const GOTO_LABELS = Object.fromEntries(NAV.map((n) => [n.view, n.label])) as Record<View, string>;

export function GoTo({
  view,
  workspace,
  label,
}: NavTarget & { label?: string }): React.JSX.Element {
  const navigate = useContext(NavContext);
  return (
    <button
      type="button"
      onClick={() => navigate({ view, workspace })}
      className="font-bold underline underline-offset-2 hover:text-tangerine cursor-pointer"
    >
      {label ?? GOTO_LABELS[view] ?? view}
    </button>
  );
}
