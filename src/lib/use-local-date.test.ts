/**
 * @vitest-environment happy-dom
 *
 * Verifies that `useLocalDateKey`:
 *   1. Initialises to the local calendar date in the device zone.
 *   2. Flips exactly when wall-clock time crosses local midnight.
 *   3. Detects a forward wall-clock jump (>60s drift on the 15s heartbeat
 *      — simulating sleep/resume, NTP correction, or a manual clock change)
 *      and immediately re-syncs without waiting for the next midnight.
 *   4. Does NOT flip on small jumps that stay inside the same local day.
 *   5. Re-syncs on `focus` / `visibilitychange` even if no heartbeat fired.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalDateKey } from "./use-local-date";

const TZ = "America/New_York";

// Pin the device timezone so the test is deterministic regardless of CI host.
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
function pinTimezone(zone: string) {
  Intl.DateTimeFormat.prototype.resolvedOptions = function () {
    const r = realResolved.call(this);
    return { ...r, timeZone: zone };
  };
}
function restoreTimezone() {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolved;
}

beforeEach(() => {
  vi.useFakeTimers();
  pinTimezone(TZ);
});
afterEach(() => {
  vi.useRealTimers();
  restoreTimezone();
});

describe("useLocalDateKey — wall-clock jumps & midnight flips", () => {
  it("initialises to today's local date in the device zone", () => {
    // 2026-06-28T14:00:00Z = 10:00 EDT Jun 28.
    vi.setSystemTime(new Date("2026-06-28T14:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");
    expect(result.current.timeZone).toBe(TZ);
  });

  it("flips exactly when the scheduled midnight timer fires (no drift)", () => {
    // 23:55 EDT Jun 28 = 03:55Z Jun 29. Next local midnight = 04:00Z Jun 29.
    vi.setSystemTime(new Date("2026-06-29T03:55:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");

    // Advance 4 min: still Jun 28 locally.
    act(() => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(result.current.date).toBe("2026-06-28");

    // Cross the boundary (hook schedules midnight + 5s slack).
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(result.current.date).toBe("2026-06-29");
  });

  it("ignores small same-day forward jumps that do not breach drift tolerance", () => {
    // 10:00 EDT Jun 28. Jump forward 30s mid-heartbeat — well under the
    // 60s drift threshold and inside the same local day.
    vi.setSystemTime(new Date("2026-06-28T14:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");

    // Advance the heartbeat plus a tiny additional skew. Date remains stable.
    act(() => {
      vi.setSystemTime(new Date("2026-06-28T14:00:30Z"));
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current.date).toBe("2026-06-28");
  });

  it("detects a large forward jump on the heartbeat and re-syncs immediately (same day)", () => {
    // 10:00 EDT Jun 28. The wall clock leaps to 18:00 EDT (8h later, still
    // Jun 28). The hook's drift detector fires on the next 15s heartbeat
    // and re-syncs; date stays Jun 28 but the midnight timer is rescheduled.
    vi.setSystemTime(new Date("2026-06-28T14:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());

    act(() => {
      vi.setSystemTime(new Date("2026-06-28T22:00:00Z")); // 8h forward
      vi.advanceTimersByTime(15_000); // trigger heartbeat → drift detected → resync
    });
    expect(result.current.date).toBe("2026-06-28");

    // The rescheduled midnight timer must now fire at 04:00Z Jun 29
    // (= 00:00 EDT Jun 29), exactly 6 hours away from the new wall clock.
    act(() => {
      // 5h59m later: still Jun 28.
      vi.setSystemTime(new Date("2026-06-29T03:59:00Z"));
      vi.advanceTimersByTime(5 * 3_600_000 + 59 * 60_000 - 15_000);
    });
    expect(result.current.date).toBe("2026-06-28");

    act(() => {
      // Cross midnight + slack.
      vi.setSystemTime(new Date("2026-06-29T04:00:10Z"));
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(result.current.date).toBe("2026-06-29");
  });

  it("flips to the new local day when a large jump crosses midnight (simulated sleep/resume)", () => {
    // 22:00 EDT Jun 28 = 02:00Z Jun 29. Sleep, then resume 6h later =
    // 04:00 EDT Jun 29 = 08:00Z Jun 29. Heartbeat detects drift and
    // immediately re-syncs to Jun 29 without waiting for the (now-stale)
    // scheduled midnight callback.
    vi.setSystemTime(new Date("2026-06-29T02:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");

    act(() => {
      vi.setSystemTime(new Date("2026-06-29T08:00:00Z")); // +6h jump
      vi.advanceTimersByTime(15_000); // next heartbeat tick
    });
    expect(result.current.date).toBe("2026-06-29");
  });

  it("re-syncs on focus / visibilitychange after a long background pause", () => {
    // 10:00 EDT Jun 28. Tab backgrounded for 18h (heartbeats may have been
    // throttled). On focus, the hook re-syncs without waiting for timers.
    vi.setSystemTime(new Date("2026-06-28T14:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");

    act(() => {
      vi.setSystemTime(new Date("2026-06-29T08:00:00Z")); // 18h later, Jun 29 local
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.date).toBe("2026-06-29");

    // Same check via document visibilitychange.
    act(() => {
      vi.setSystemTime(new Date("2026-06-30T08:00:00Z"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.date).toBe("2026-06-30");
  });

  it("does not flip backwards on a backwards clock jump within the same local day", () => {
    // Some NTP corrections push the clock backwards by a few seconds. The
    // hook should remain on the same local date and simply reschedule.
    vi.setSystemTime(new Date("2026-06-28T14:00:00Z"));
    const { result } = renderHook(() => useLocalDateKey());
    expect(result.current.date).toBe("2026-06-28");

    act(() => {
      vi.setSystemTime(new Date("2026-06-28T13:58:00Z")); // -2 min
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current.date).toBe("2026-06-28");
  });
});