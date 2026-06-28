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
    const sync = () => {
      const nextDate = todayLocalISO();
      const nextTz = deviceTimezone();
      setDate((prev) => (prev === nextDate ? prev : nextDate));
      setTimeZone((prev) => (prev === nextTz ? prev : nextTz));
    };
    const scheduleMidnight = () => {
      const now = new Date();
      // Compute the next local midnight in the *resolved* IANA zone (not the
      // system zone, which can differ) and pad +5s so the rollover has
      // already happened by the time we re-read the date. This works through
      // DST spring-forward (the missing hour is skipped) and fall-back (the
      // repeated hour is collapsed) because nextLocalMidnightUTC searches
      // for the first UTC instant whose local date is "tomorrow".
      const next = nextLocalMidnightUTC(now, deviceTimezone());
      const ms = Math.max(1000, next.getTime() - now.getTime() + 5_000);
      return window.setTimeout(() => {
        sync();
        timer = scheduleMidnight();
      }, ms);
    };
    let timer = scheduleMidnight();
    const heartbeat = window.setInterval(sync, 15_000);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("languagechange", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("languagechange", onFocus);
    };
  }, []);

  return { date, timeZone };
}