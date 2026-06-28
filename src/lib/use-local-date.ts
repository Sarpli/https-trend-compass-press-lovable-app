import { useEffect, useState } from "react";
import { deviceTimezone, nextLocalMidnightUTC, todayLocalISO } from "./timezone";

/**
 * Reactive local-date key (YYYY-MM-DD) in the device's own time zone.
 * Re-evaluates at local midnight, on a 15s heartbeat (catches manual clock
 * / OS time-zone changes), on tab focus + visibility, and on `languagechange`
 * (browsers fire this when the OS locale/zone shifts). Components that key a
 * query off this value automatically refetch when the day rolls over —
 * spotlight, front-page stories, streak badge, learned banner.
 */
export function useLocalDateKey(): { date: string; timeZone: string } {
  const [date, setDate] = useState(todayLocalISO);
  const [timeZone, setTimeZone] = useState(deviceTimezone);

  useEffect(() => {
    let timer: number | undefined;
    let lastTick = Date.now();

    const sync = () => {
      const nextDate = todayLocalISO();
      const nextTz = deviceTimezone();
      setDate((prev) => (prev === nextDate ? prev : nextDate));
      setTimeZone((prev) => (prev === nextTz ? prev : nextTz));
    };

    const scheduleMidnight = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const now = new Date();
      const next = nextLocalMidnightUTC(now, deviceTimezone());
      const ms = Math.max(1000, next.getTime() - now.getTime() + 5_000);
      timer = window.setTimeout(() => {
        sync();
        scheduleMidnight();
      }, ms);
    };

    scheduleMidnight();

    // Wall-clock drift detector. setTimeout/setInterval fire on monotonic
    // time, so if the user (or NTP, or daylight-savings on a non-IANA OS,
    // or a VM resume) shifts the system clock mid-day, the midnight timer
    // could fire late, early, or never. Each heartbeat compares the
    // expected interval against the observed `Date.now()` delta; a jump
    // beyond ±60s of the 15s tick is treated as a clock change and we
    // both re-sync and reschedule the midnight rollover.
    const HEARTBEAT_MS = 15_000;
    const DRIFT_TOLERANCE_MS = 60_000;
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      const drift = now - lastTick - HEARTBEAT_MS;
      lastTick = now;
      sync();
      if (Math.abs(drift) > DRIFT_TOLERANCE_MS) {
        // Clock moved unexpectedly — the scheduled midnight callback is no
        // longer trustworthy. Tear it down and recompute against the new
        // wall-clock reading so the next rollover fires at the right moment.
        scheduleMidnight();
      }
    }, HEARTBEAT_MS);

    const onFocus = () => {
      // Tabs that were backgrounded skip heartbeats; on return, force a
      // sync and a fresh midnight schedule in case the clock or zone
      // changed while we were away.
      lastTick = Date.now();
      sync();
      scheduleMidnight();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("languagechange", onFocus);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("languagechange", onFocus);
    };
  }, []);

  return { date, timeZone };
}