import { DUR } from "../motion";
import { usePresence } from "../usePresence";

/**
 * A height reveal that animates in BOTH directions (Animations round,
 * 2026-09-10).
 *
 * The naive version — a `grid-template-rows` 0fr↔1fr wrapper around
 * `{open && children}` — opens beautifully and closes with a SNAP, and the
 * reason is worth stating because it is invisible in review: the open row's
 * height comes from its content, so the moment React unmounts that content the
 * row is 0px whatever the transition says. There is nothing left to animate
 * from. Measured in the running app: 280px → 0px in one frame.
 *
 * So the children outlive the close by exactly the transition, via
 * `usePresence`, and only then unmount. That keeps the other half of the
 * bargain too: a collapsed delegation transcript or a collapsed raw envelope is
 * still not rendered, which is what makes this reveal affordable on a card that
 * may hold hundreds of lines.
 *
 * `min-h-0` on the inner element is load-bearing — a grid item's default
 * `min-height: auto` refuses to shrink below its content, so without it the row
 * never reaches 0fr and the thing simply never closes.
 */
export function Unfold({
  open,
  ms = DUR.panel,
  children,
}: {
  open: boolean;
  /** Kept in step with the CSS duration below; override only with a matching class. */
  ms?: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const present = usePresence(open, ms);
  return (
    <div
      className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-180 motion-safe:ease-hv-out ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{present.mounted && children}</div>
    </div>
  );
}
