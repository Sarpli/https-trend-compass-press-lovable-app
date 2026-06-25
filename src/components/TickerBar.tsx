import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowDown, ArrowUp } from "lucide-react";

type Row = {
  trend_id: string;
  slug: string;
  term: string;
  base_price: number;
  net_votes: number;
  price: number;
};

async function fetchScores(): Promise<Row[]> {
  const { data, error } = await supabase.rpc("get_trend_scores");
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map((r) => ({ ...r, price: Number(r.price), net_votes: Number(r.net_votes) }))
    .sort((a, b) => b.price - a.price);
}

export function TickerBar() {
  return <TickerBarInner />;
}

function Sparkline({ points, up, down }: { points: number[]; up: boolean; down: boolean }) {
  const w = 36;
  const h = 12;
  if (points.length < 2) {
    return <svg width={w} height={h} className="opacity-40"><line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="currentColor" strokeWidth={1} /></svg>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(h - ((p - min) / range) * h).toFixed(2)}`)
    .join(" ");
  const stroke = up ? "var(--ticker-up)" : down ? "var(--ticker-down)" : "currentColor";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TickerBarInner() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["ticker"],
    queryFn: fetchScores,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const prevRef = useRef<Record<string, number>>({});
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const ch = supabase
      .channel("ticker-vote-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vote_events" },
        () => {
          qc.invalidateQueries({ queryKey: ["ticker"] });
          qc.invalidateQueries({ queryKey: ["leaderboard"] });
          qc.invalidateQueries({ queryKey: ["trend-score"] });
          qc.invalidateQueries({ queryKey: ["myvote"] });
          qc.invalidateQueries({ queryKey: ["trend-history"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Track per-trend price deltas so we can flash arrows green/red on change.
  useEffect(() => {
    if (rows.length === 0) return;
    const next: Record<string, number> = {};
    const changed: Record<string, number> = {};
    rows.forEach((r) => {
      next[r.trend_id] = r.price;
      const last = prevRef.current[r.trend_id];
      if (last !== undefined && last !== r.price) changed[r.trend_id] = r.price - last;
    });
    prevRef.current = next;
    setHistory((h) => {
      const copy = { ...h };
      rows.forEach((r) => {
        const arr = copy[r.trend_id] ? [...copy[r.trend_id]] : [];
        if (arr.length === 0 || arr[arr.length - 1] !== r.price) arr.push(r.price);
        if (arr.length > 24) arr.splice(0, arr.length - 24);
        copy[r.trend_id] = arr;
      });
      return copy;
    });
    if (Object.keys(changed).length > 0) {
      setDeltas((d) => ({ ...d, ...changed }));
      const id = setTimeout(() => {
        setDeltas((d) => {
          const copy = { ...d };
          Object.keys(changed).forEach((k) => delete copy[k]);
          return copy;
        });
      }, 2500);
      return () => clearTimeout(id);
    }
  }, [rows]);

  if (rows.length === 0) return <div className="bg-ink text-newsprint h-8" />;

  const items = [...rows, ...rows]; // duplicate for seamless scroll

  return (
    <div className="bg-ink text-newsprint overflow-hidden ui text-xs">
      <div className="flex items-stretch">
        <div className="px-3 py-2 small-caps bg-accent-red text-accent-foreground flex items-center font-bold">
          Live · Trend Tape
        </div>
        <div className="flex-1 overflow-hidden relative ticker-track-pause">
          <div className="ticker-track py-2 whitespace-nowrap">
            {items.map((r, i) => {
              const delta = deltas[r.trend_id] ?? 0;
              const dir = delta > 0 ? "up" : delta < 0 ? "down" : r.net_votes > 0 ? "up-static" : r.net_votes < 0 ? "down-static" : "flat";
              const flashing = delta !== 0;
              return (
                <Link
                  key={`${r.trend_id}-${i}`}
                  to="/trends/$slug"
                  params={{ slug: r.slug }}
                  className={`inline-flex items-center gap-2 mx-4 transition-colors ${
                    flashing
                      ? dir === "up"
                        ? "text-ticker-up"
                        : "text-ticker-down"
                      : "hover:text-accent-red"
                  }`}
                >
                  <span className="small-caps font-bold tracking-wider">{r.term}</span>
                  <span className="tabular-nums">{r.price.toFixed(0)}</span>
                  <Sparkline
                    points={history[r.trend_id] ?? [r.price]}
                    up={dir === "up" || dir === "up-static"}
                    down={dir === "down" || dir === "down-static"}
                  />
                  {(dir === "up" || dir === "up-static") && <ArrowUp className="w-3 h-3 text-ticker-up" />}
                  {(dir === "down" || dir === "down-static") && <ArrowDown className="w-3 h-3 text-ticker-down" />}
                  {dir === "flat" && <span className="text-newsprint/40">—</span>}
                  {flashing && (
                    <span className={`tabular-nums text-[10px] ${dir === "up" ? "text-ticker-up" : "text-ticker-down"}`}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(0)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}