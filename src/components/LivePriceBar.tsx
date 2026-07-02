import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trendHistoryQueryOptions } from "@/lib/trend-history";

const MAX_TICKS = 40;

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

  // Baseline price = last historical point from the RPC, or basePrice.
  const baseline = useMemo(() => {
    const series = data ?? [];
    return series.length ? Number(series[series.length - 1].price) : Number(basePrice);
  }, [data, basePrice]);

  // Local live ticks, bounded. Each entry is a small +/- delta appended when
  // a vote_event arrives for this trend. Reset when trend changes.
  const [ticks, setTicks] = useState<number[]>([]);
  useEffect(() => setTicks([]), [trendId]);

  // Realtime: every vote (own or others') pushes a small random-signed tick.
  // vote_events doesn't carry direction, so the sign is random — that's what
  // produces the two-way wiggle when many people vote at once.
  const pendingRef = useRef<number[]>([]);
  useEffect(() => {
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!pendingRef.current.length) return;
      const drained = pendingRef.current;
      pendingRef.current = [];
      setTicks((prev) => {
        const next = [...prev, ...drained];
        return next.length > MAX_TICKS ? next.slice(next.length - MAX_TICKS) : next;
      });
    };
    const ch = supabase
      .channel(`live-bar-${trendId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_events", filter: `trend_id=eq.${trendId}` },
        () => {
          const sign = Math.random() < 0.5 ? -1 : 1;
          const magnitude = 0.4 + Math.random() * 1.2;
          pendingRef.current.push(sign * magnitude);
          if (!raf) raf = requestAnimationFrame(flush);
        },
      )
      .subscribe();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      supabase.removeChannel(ch);
    };
  }, [trendId]);

  // Pulse the live dot every couple seconds.
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 1100);
    return () => clearInterval(id);
  }, []);

  // Build the live series: baseline, then baseline + cumulative tick sums.
  const liveSeries = useMemo(() => {
    const out: number[] = [baseline];
    let running = baseline;
    for (const t of ticks) {
      running += t;
      out.push(running);
    }
    return out;
  }, [baseline, ticks]);

  const last = liveSeries[liveSeries.length - 1];
  const open = liveSeries[0];
  const change = last - open;
  const changePct = open ? (change / open) * 100 : 0;
  const up = change >= 0;
  const high = Math.max(...liveSeries);
  const low = Math.min(...liveSeries);

  const w = 120;
  const h = 28;
  const yRange = high - low || 1;
  const path = liveSeries
    .map((price, i) => {
      const x = (i / Math.max(1, liveSeries.length - 1)) * w;
      const y = h - ((price - low) / yRange) * h;
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
            up ? "text-ticker-up" : "text-ticker-down"
          }`}
        >
          {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}
          {changePct.toFixed(2)}%)
        </span>
      </div>

      {liveSeries.length > 1 && (
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
        Live range{" "}
        <span className="font-semibold text-foreground">
          {low.toFixed(2)} – {high.toFixed(2)}
        </span>
      </div>
    </div>
  );
}