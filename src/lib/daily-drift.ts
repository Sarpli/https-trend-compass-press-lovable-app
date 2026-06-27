// Deterministic per-trend, per-day "drift" used to give every ticker a
// small fake daily percentage move when there's no real vote activity.
// Range: roughly -0.99% .. +0.99%.

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Stable signed percentage in (-1, 1) for a given trend on a given day. */
export function dailyDriftPct(trendId: string, date = new Date()): number {
  const h = hashString(`${trendId}::${dayKey(date)}`);
  // Map to [-1, 1), then shrink slightly so we stay strictly under 1%.
  const u = (h % 100000) / 100000; // [0, 1)
  const signed = u * 2 - 1; // [-1, 1)
  return Number((signed * 0.99).toFixed(4));
}

/** Per-vote contribution stacked on top of the daily drift. */
export const VOTE_PCT_WEIGHT = 0.1; // each net vote adds 0.10% to the day's move

export function combinedDailyPct(trendId: string, netVotes: number): number {
  return dailyDriftPct(trendId) + netVotes * VOTE_PCT_WEIGHT;
}