import { useEffect, useRef, useState } from "react";

/**
 * Returns true for ~750ms whenever `value` increases from its previous known value.
 * Resets to false automatically. Useful for animating streak counters, etc.
 */
export function useBump(value: number | null | undefined): boolean {
  const [bumping, setBumping] = useState(false);
  const previousRef = useRef<number | null>(null);

  useEffect(() => {
    const current = value ?? 0;
    const previous = previousRef.current;
    previousRef.current = current;

    if (previous === null || current <= previous) {
      setBumping(false);
      return;
    }

    setBumping(true);
    const timer = setTimeout(() => setBumping(false), 750);
    return () => clearTimeout(timer);
  }, [value]);

  return bumping;
}
