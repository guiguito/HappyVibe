/** Privacy round: the switches as main holds them, live across windows. */
import { useCallback, useEffect, useState } from "react";
import type { PrivacyState } from "../../main/privacySwitches";

export function usePrivacy(): [PrivacyState | null, () => void] {
  const [s, setS] = useState<PrivacyState | null>(null);
  const reload = useCallback(() => void window.hv.privacyGet().then(setS), []);
  useEffect(() => {
    reload();
    return window.hv.onPrivacyChanged(setS);
  }, [reload]);
  return [s, reload];
}
