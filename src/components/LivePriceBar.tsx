import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Point = { t: string; price: number };

export function LivePriceBar({
  trendId,
  term,
  basePrice,
}: {
  trendId: string;
  term: string;
  basePrice: number;
}) {
  const { data } = useQuery({
    queryKey: ["trend-history", trendId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trend_price_history", {
        _trend_id: trendId,
      });
      if (error) throw error;
      return ((data ?? []) as Point[]).map((p) => ({
        t: p.t,
        price: Number(p.price),
      }));
    },
    refetchInterval: 10000,
  });

  // Pulse the live dot every couple seconds.
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 1100);
    return () => clearInterval(id);
  }, []);

  const series = data ?? [];
  const last = series[series.length - 1]?.price ?? Number(basePrice);
  const open = series.length > 0 ? series[0].price : Number(basePrice);
  // Live delta is derived from the SAME price history the chart renders,
  // so the badge can never disagree with the chart below it. We compare
  // the last point to the point ~24h earlier (or the previous point if
  // the series is coarser than that).
  const nowMs = series.length ? new Date(series[series.length - 1].t).getTime() : Date.now();
  const prior = series.length
    ? [...series].reverse().find((p) => new Date(p.t).getTime() <= nowMs - 24 * 60 * 60 * 1000)
        ?? series[Math.max(0, series.length - 2)]
    : null;
  const priorPrice = prior ? prior.price : last;
  const dayPct = priorPrice > 0 ? ((last - priorPrice) / priorPrice) * 100 : 0;
  const day = last * (dayPct / 100);
  const total = last - open;
  const totalPct = open ? (total / open) * 100 : 0;
  const dayUp = dayPct >= 0;
  const up = dayUp;

  // Mini sparkline (last 24 points or all of them).
  const tail = series.slice(-24);
  const w = 120;
  const h = 28;
  const xs = tail.map((_, i) => i);
  const ys = tail.map((p) => p.price);
  const yMin = ys.length ? Math.min(...ys) : open;
  const yMax = ys.length ? Math.max(...ys) : open;
  const yRange = yMax - yMin || 1;
  const path = tail
    .map((p, i) => {
      const x = (i / Math.max(1, xs.length - 1)) * w;
      const y = h - ((p.price - yMin) / yRange) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke = up ? "var(--ticker-up)" : "var(--ticker-down)";

  return (
    <div className="glass glass-sheen border border-ink/25 px-4 py-3 mb-4 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full transition-opacity duration-700"
          style={{
            background: "var(--ticker-up)",
            opacity: pulse ? 1 : 0.25,
            boxShadow: "0 0 8px var(--ticker-up)",
          }}
        />
        <span className="ui small-caps text-[10px] text-muted-foreground">
          Live
        </span>
        <span className="display font-black tracking-tight uppercase text-sm truncate">
          {term}
        </span>
      </div>

      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="display text-2xl font-black">{last.toFixed(2)}</span>
        <span
          className={`ui text-xs font-semibold ${
            dayUp ? "text-ticker-up" : "text-ticker-down"
          }`}
        >
          {dayUp ? "▲" : "▼"} {Math.abs(day).toFixed(2)} ({dayUp ? "+" : ""}
          {dayPct.toFixed(2)}%)
        </span>
      </div>

      {tail.length > 1 && (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
          className="shrink-0"
          preserveAspectRatio="none"
        >
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}

      <div className="ml-auto ui small-caps text-[10px] text-muted-foreground tabular-nums">
        Since launch{" "}
        <span
          className={`font-semibold ${
            up ? "text-ticker-up" : "text-ticker-down"
          }`}
        >
          {up ? "+" : ""}
          {total.toFixed(2)} ({up ? "+" : ""}
          {totalPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}