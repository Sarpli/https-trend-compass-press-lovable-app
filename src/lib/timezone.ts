import { supabase } from "@/integrations/supabase/client";

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Format an instant as YYYY-MM-DD in the supplied IANA zone.
 *
 * Uses `Intl.DateTimeFormat` so DST is handled by tzdata — the resulting
 * calendar date is well-defined for every UTC instant, including:
 *  - the "missing" local hour during spring-forward (e.g. 02:30 in NYC on
 *    Mar 8 2026 never occurs locally, but every UTC instant still maps to
 *    exactly one local date);
 *  - the "repeated" local hour during fall-back (01:30 EDT and 01:30 EST
 *    on Nov 1 2026 are two distinct UTC instants; both resolve to Nov 1).
 */
export function localDateInZone(instant: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    // Last-resort fallback: format the instant in UTC. Better than throwing.
    const d = instant;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
}

export function todayLocalISO(): string {
  return localDateInZone(new Date(), deviceTimezone());
}

/**
 * Add `n` calendar days to a YYYY-MM-DD string. Pure string math at UTC
 * noon so DST jumps cannot shift the result by ±1 day.
 */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Anchor at noon UTC so a ±1h DST adjustment (which doesn't apply to UTC
  // anyway) could never cross a date boundary.
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + n * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function yesterdayLocalISO(): string {
  return addDaysISO(todayLocalISO(), -1);
}

/**
 * UTC instant of the first moment of the next local day in `zone`.
 *
 * Robust to DST irregularities by finding the smallest UTC instant whose
 * local date is `tomorrow`. Handles:
 *  - spring-forward where local 00:00 might not exist (it always does for
 *    every real-world zone today, but if a zone skipped midnight the
 *    first existing instant after the gap is returned);
 *  - fall-back where local 00:00 occurs once but neighboring hours repeat;
 *  - zones with non-hour DST offsets and historical 30/45-minute shifts.
 *
 * The search granularity is one minute, sufficient for all real zones.
 */
export function nextLocalMidnightUTC(now: Date, zone: string): Date {
  const today = localDateInZone(now, zone);
  const tomorrow = addDaysISO(today, 1);
  // Bracket: somewhere in the next 48 hours, the local date must equal
  // `tomorrow`. Find the lowest minute where that holds via binary search.
  let lo = now.getTime();
  let hi = lo + 48 * 60 * 60_000;
  // Guard: if `hi` is already not `tomorrow` (zone skipped a day, e.g.
  // Samoa 2011), widen the window to 72h before falling back.
  if (localDateInZone(new Date(hi), zone) < tomorrow) {
    hi = lo + 72 * 60 * 60_000;
  }
  // Tighten to millisecond precision (~28 iterations for a 48h window).
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDateInZone(new Date(mid), zone) >= tomorrow) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** Streaks now always follow the device timezone — no manual selector. */
export function useUserTimezone(): string {
  return deviceTimezone();
}
