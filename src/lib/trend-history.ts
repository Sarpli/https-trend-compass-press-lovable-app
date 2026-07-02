import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TrendHistoryPoint = { t: string; price: number };

export async function fetchTrendPriceHistory(trendId: string): Promise<TrendHistoryPoint[]> {
  const { data, error } = await supabase.rpc("get_trend_price_history", {
    _trend_id: trendId,
  });
  if (error) throw error;
  return ((data ?? []) as TrendHistoryPoint[]).map((p) => ({
    t: p.t,
    price: Number(p.price),
  }));
}

export const trendHistoryQueryOptions = (trendId: string) =>
  queryOptions({
    queryKey: ["trend-history", trendId],
    queryFn: () => fetchTrendPriceHistory(trendId),
    refetchInterval: 10000,
  });

export function getTrendHistoryStats(series: TrendHistoryPoint[] | undefined, basePrice: number) {
  const safeSeries = series ?? [];
  const fallback = Number(basePrice);
  const last = safeSeries[safeSeries.length - 1]?.price ?? fallback;
  const open = safeSeries.length > 0 ? safeSeries[0].price : fallback;
  const nowMs = safeSeries.length
    ? new Date(safeSeries[safeSeries.length - 1].t).getTime()
    : Date.now();
  const prior = safeSeries.length
    ? [...safeSeries].reverse().find((p) => new Date(p.t).getTime() <= nowMs - 24 * 60 * 60 * 1000) ??
      safeSeries[Math.max(0, safeSeries.length - 2)]
    : null;
  const priorPrice = prior ? prior.price : last;
  const dayPct = priorPrice > 0 ? ((last - priorPrice) / priorPrice) * 100 : 0;
  const day = last - priorPrice;
  const total = last - open;
  const totalPct = open ? (total / open) * 100 : 0;

  return { last, open, priorPrice, day, dayPct, total, totalPct };
}