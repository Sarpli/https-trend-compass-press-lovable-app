import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowDown, ArrowUp } from "lucide-react";

type Row = {
  trend_id: string | null;
  slug: string | null;
  term: string | null;
  base_price: number | null;
  net_votes: number | null;
  price: number | null;
};

async function fetchScores(): Promise<Row[]> {
  const { data, error } = await supabase
    .from("trend_scores")
    .select("*")
    .order("price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Row[];
}

export function TickerBar() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["ticker"], queryFn: fetchScores, refetchInterval: 15000 });
  const [prev, setPrev] = useState<Record<string, number>>({});

  useEffect(() => {
    const ch = supabase
      .channel("ticker-votes")
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, () => {
        qc.invalidateQueries({ queryKey: ["ticker"] });
        qc.invalidateQueries({ queryKey: ["leaderboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  useEffect(() => {
    const next: Record<string, number> = {};
    rows.forEach((r) => { if (r.trend_id) next[r.trend_id] = Number(r.price ?? 0); });
    setPrev((p) => (Object.keys(p).length === 0 ? next : p));
    const id = setTimeout(() => setPrev(next), 200);
    return () => clearTimeout(id);
  }, [rows]);

  if (rows.length === 0) return <div className="bg-ink text-newsprint h-8" />;

  const items = [...rows, ...rows]; // duplicate for seamless scroll

  return (
    <div className="bg-ink text-newsprint overflow-hidden ui text-xs">
      <div className="flex items-stretch">
        <div className="px-3 py-2 small-caps bg-accent-red text-accent-foreground flex items-center font-bold">
          Live · Trend Tape
        </div>
        <div className="flex-1 overflow-hidden relative">
          <div className="ticker-track py-2">
            {items.map((r, i) => {
              const price = Number(r.price ?? 0);
              const last = prev[r.trend_id ?? ""] ?? price;
              const delta = price - last;
              const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
              return (
                <Link
                  key={`${r.trend_id}-${i}`}
                  to="/trends/$slug"
                  params={{ slug: r.slug ?? "" }}
                  className="inline-flex items-center gap-2 hover:text-accent-red"
                >
                  <span className="small-caps font-bold tracking-wider">{r.term}</span>
                  <span className="tabular-nums">{price.toFixed(0)}</span>
                  {dir === "up" && <ArrowUp className="w-3 h-3 text-ticker-up" />}
                  {dir === "down" && <ArrowDown className="w-3 h-3 text-ticker-down" />}
                  {dir === "flat" && <span className="text-newsprint/40">—</span>}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}