import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  localDateInZone,
  nextLocalMidnightUTC,
} from "./timezone";

// Helper: build a UTC instant from an ISO string.
const at = (iso: string) => new Date(iso);

describe("localDateInZone — DST ambiguous & nonexistent local times", () => {
  it("collapses the repeated fall-back hour to a single local date (NYC 2026-11-01)", () => {
    // 01:30 EDT (first 01:30) and 01:30 EST (second 01:30) are distinct UTC
    // instants. Both must resolve to Nov 1 in America/New_York.
    expect(localDateInZone(at("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(localDateInZone(at("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-11-01");
  });

  it("handles the missing spring-forward hour (NYC 2026-03-08 02:00→03:00)", () => {
    // 01:59 EST, then the clock jumps to 03:00 EDT. Both straddling instants
    // must still be Mar 8 locally.
    expect(localDateInZone(at("2026-03-08T06:59:00Z"), "America/New_York")).toBe("2026-03-08");
    expect(localDateInZone(at("2026-03-08T07:01:00Z"), "America/New_York")).toBe("2026-03-08");
    // The pre-jump local Mar 7 23:59 EST is 2026-03-08T04:59Z.
    expect(localDateInZone(at("2026-03-08T04:59:00Z"), "America/New_York")).toBe("2026-03-07");
    // 00:00 EST Mar 8 = 2026-03-08T05:00Z.
    expect(localDateInZone(at("2026-03-08T05:00:00Z"), "America/New_York")).toBe("2026-03-08");
  });

  it("respects UTC+14 zone boundaries (Pacific/Kiritimati)", () => {
    expect(localDateInZone(at("2026-06-28T08:00:00Z"), "Pacific/Kiritimati")).toBe("2026-06-28");
    expect(localDateInZone(at("2026-06-28T10:00:00Z"), "Pacific/Kiritimati")).toBe("2026-06-29");
  });

  it("respects fractional offsets (Asia/Kathmandu UTC+5:45)", () => {
    // 18:14Z is 23:59 local; 18:16Z is 00:01 next day local.
    expect(localDateInZone(at("2026-06-28T18:14:00Z"), "Asia/Kathmandu")).toBe("2026-06-28");
    expect(localDateInZone(at("2026-06-28T18:16:00Z"), "Asia/Kathmandu")).toBe("2026-06-29");
  });

  it("falls back to a UTC date for an invalid zone id without throwing", () => {
    const result = localDateInZone(at("2026-06-28T12:00:00Z"), "Not/AZone");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDaysISO — calendar math independent of DST", () => {
  it("crosses the spring-forward day without losing a day", () => {
    expect(addDaysISO("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysISO("2026-03-08", -1)).toBe("2026-03-07");
  });
  it("crosses the fall-back day without gaining a day", () => {
    expect(addDaysISO("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysISO("2026-11-01", -1)).toBe("2026-10-31");
  });
  it("rolls month and year boundaries", () => {
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01"); // non-leap
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2027-01-01", -1)).toBe("2026-12-31");
  });
  it("supports multi-day jumps", () => {
    expect(addDaysISO("2026-03-01", 14)).toBe("2026-03-15");
    expect(addDaysISO("2026-03-15", -14)).toBe("2026-03-01");
  });
});

describe("nextLocalMidnightUTC — DST-aware rollover scheduling", () => {
  it("targets midnight EST on the spring-forward day (NYC Mar 7 → Mar 8 00:00 EST = 05:00Z)", () => {
    // From any instant during Mar 7 local, next local midnight is Mar 8 00:00.
    // EST is UTC-5, so that's 2026-03-08T05:00:00Z. The DST jump is at 07:00Z,
    // *after* midnight, so it does not affect this rollover.
    const now = at("2026-03-07T20:00:00Z"); // 15:00 EST Mar 7
    const next = nextLocalMidnightUTC(now, "America/New_York");
    expect(next.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(localDateInZone(next, "America/New_York")).toBe("2026-03-08");
  });

  it("targets midnight EDT on the fall-back day (NYC Oct 31 → Nov 1 00:00 EDT = 04:00Z)", () => {
    const now = at("2026-10-31T20:00:00Z"); // 16:00 EDT Oct 31
    const next = nextLocalMidnightUTC(now, "America/New_York");
    expect(next.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(localDateInZone(next, "America/New_York")).toBe("2026-11-01");
  });

  it("after fall-back midnight, next rollover is 24h+1 later than naive (Nov 1 → Nov 2 00:00 EST = 05:00Z)", () => {
    // Inside Nov 1 local (post-fall-back, EST). Next midnight is Nov 2 00:00 EST.
    const now = at("2026-11-01T12:00:00Z"); // 07:00 EST Nov 1
    const next = nextLocalMidnightUTC(now, "America/New_York");
    expect(next.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("returns an instant strictly after `now` and exactly on the date boundary", () => {
    const now = at("2026-06-28T22:00:00Z"); // 18:00 EDT
    const next = nextLocalMidnightUTC(now, "America/New_York");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(localDateInZone(next, "America/New_York")).toBe("2026-06-29");
    // One minute earlier must still be the previous local date.
    expect(localDateInZone(new Date(next.getTime() - 60_000), "America/New_York")).toBe("2026-06-28");
  });

  it("works in a UTC+14 zone (Pacific/Kiritimati)", () => {
    const now = at("2026-06-28T08:00:00Z"); // 22:00 local Jun 28
    const next = nextLocalMidnightUTC(now, "Pacific/Kiritimati");
    // Next local midnight = Jun 29 00:00 +14 = Jun 28 10:00 UTC.
    expect(next.toISOString()).toBe("2026-06-28T10:00:00.000Z");
  });

  it("works in a fractional-offset zone (Asia/Kathmandu, UTC+5:45)", () => {
    const now = at("2026-06-28T12:00:00Z"); // 17:45 local Jun 28
    const next = nextLocalMidnightUTC(now, "Asia/Kathmandu");
    // Next local midnight = Jun 29 00:00 +5:45 = Jun 28 18:15 UTC.
    expect(next.toISOString()).toBe("2026-06-28T18:15:00.000Z");
  });
});