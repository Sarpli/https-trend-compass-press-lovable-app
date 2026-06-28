import { useEffect, useRef, useState } from "react";

type BumpOptions = {
  /**
   * When true, also fire a bump the first time `value` is observed as a
   * positive number (e.g. immediately after login when the streak is
   * already complete for today). Defaults to false.
   */
  bumpOnInitial?: boolean;
};

/**
 * Returns true for ~750ms whenever `value` increases from its previous known value.
 * Resets to false automatically. Useful for animating streak counters, etc.
 *
 * With `{ bumpOnInitial: true }`, also fires once when the value is first seen
 * as > 0 (handy for celebrating an already-complete streak on login / hydration).
 */
export function useBump(
  value: number | null | undefined,
  options: BumpOptions = {},
): boolean {
  const { bumpOnInitial = false } = options;
  const [bumping, setBumping] = useState(false);
  const previousRef = useRef<number | null>(null);
  const initialFiredRef = useRef(false);

  useEffect(() => {
    const current = value ?? 0;
    const previous = previousRef.current;
    previousRef.current = current;

    const isInitialPositive =
      bumpOnInitial &&
      !initialFiredRef.current &&
      previous === null &&
      current > 0;

    const isIncrement = previous !== null && current > previous;

    if (!isInitialPositive && !isIncrement) {
      // Don't clear an in-flight bump — let its timer finish naturally.
      return;
    }

    if (isInitialPositive) initialFiredRef.current = true;
    setBumping(true);
    const timer = setTimeout(() => setBumping(false), 750);
    return () => clearTimeout(timer);
  }, [value, bumpOnInitial]);

  return bumping;
}
