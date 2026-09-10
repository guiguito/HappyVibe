import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";

/**
 * Keep a conditionally-rendered element mounted for `ms` after `show` goes
 * false, so CSS can play an exit before React unmounts it.
 *
 * `@starting-style` gives us enters for free, and `transition-discrete` gives
 * us exits across `display: none` — but an element React REMOVES is gone before
 * any transition can run, and that is most of the app's overlays. Hence this.
 *
 * It is a TIMER, deliberately not `transitionend`: that event never fires for a
 * pane that is hidden, for a reduced-motion user, or for a transition the
 * browser optimises away — and the element would then stay mounted forever,
 * which is a worse bug than a missing animation. Under reduced motion the wait
 * is zero, so there is no exit at all: the settled frame is "gone".
 */
export function usePresence(show: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (show) {
      // Re-showing during an exit must cancel it, or the element vanishes a
      // moment after the user re-opened it.
      setMounted(true);
      setLeaving(false);
      return;
    }
    const wait = reducedMotion() ? 0 : ms;
    if (wait === 0) {
      setMounted(false);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    timer.current = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
      timer.current = null;
    }, wait);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [show, ms]);

  return { mounted, leaving };
}
