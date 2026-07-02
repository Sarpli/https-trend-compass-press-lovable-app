import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runOrDeferRealtime } from "@/lib/vote-reconcile";
import { trendHistoryQueryOptions } from "@/lib/trend-history";

export function LivePriceBar({
  trendId,
  term,
  basePrice,
}: {
  trendId: string;
  term: string;
  basePrice: number;
}) {
  const { data } = useQuery(trendHistoryQueryOptions(trendId));
  const qc = useQueryClient();

  // Live fluctuations from every viewer's vote: append a small tick to the
  // shared price-history cache each time a vote_event lands for this trend.
  // vote_events doesn't carry direction, so we pick a random ± sign so the
  // series wiggles both ways when many people are voting at once.
  useEffect(() => {
    const ch = supabase
      .channel(`live-bar-${trendId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_events", filter: `trend_id=eq.${trendId}` },
        () => {
          runOrDeferRealtime(`live-bar:${trendId}`, () => {
            const key = ["trend-history", trendId] as const;
            const prev = qc.getQueryData<Array<{ t: string; price: number }>>(key);
            if (!prev || prev.length === 0) return;
            const last = prev[prev.length - 1];
            const lastT = new Date(last.t).getTime();
            const prevT =
              prev.length > 1
                ? new Date(prev[prev.length - 2].t).getTime()
                : lastT - 24 * 60 * 60 * 1000;
            const stride = Math.max(60_000, lastT - prevT);
            const sign = Math.random() < 0.5 ? -1 : 1;
            const magnitude = 0.5 + Math.random() * 1.5;
            qc.setQueryData(key, [
              ...prev,
              { t: new Date(lastT + stride).toISOString(), price: Number(last.price) + sign * magnitude },
            ]);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [trendId, qc]);

  // Pulse the live dot every couple seconds.
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 1100);
    return () => clearInterval(id);
  }, []);

  const fullSeries = data ?? [];
  // Only show today's data (last 24 hours).
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const todaySeries = fullSeries.filter((p) => new Date(p.t).getTime() >= cutoff);
  const series = todaySeries.length > 1 ? todaySeries : fullSeries.slice(-2);
  const fallback = Number(basePrice);
  const last = series[series.length - 1]?.price ?? fallback;
  const open = series[0]?.price ?? fallback;
  const day = last - open;
  const dayPct = open ? (day / open) * 100 : 0;
  const high = series.length ? Math.max(...series.map((p) => p.price)) : last;
  const low = series.length ? Math.min(...series.map((p) => p.price)) : last;
  const dayUp = dayPct >= 0;

  const tail = series;
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
  const stroke = dayUp ? "var(--ticker-up)" : "var(--ticker-down)";

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
        Day range{" "}
        <span className="font-semibold text-foreground">
          {low.toFixed(2)} – {high.toFixed(2)}
        </span>
      </div>
    </div>
  );
}