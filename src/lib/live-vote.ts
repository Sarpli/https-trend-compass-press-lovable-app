export const TREND_VOTE_IMPACT_EVENT = "trend-vote-impact";

export type TrendVoteImpactDetail = {
  trendId: string;
  direction: "up" | "down";
  weight: number;
  netDelta: number;
  eventType: "insert" | "update" | "delete";
};

export const LIVE_PCT_PER_NET_VOTE = 0.1;

export function parseNetDelta(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
