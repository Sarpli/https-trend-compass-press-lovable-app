import { useEffect, useState } from "react";
import { deviceTimezone, todayLocalISO } from "./timezone";

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
      const next = new Date(now);
      next.setHours(24, 0, 5, 0); // 5s after local midnight
      const ms = Math.max(1000, next.getTime() - now.getTime());
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