import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Point = { t: string; score: number };
type Cat = "week" | "month" | "year" | "oat";

const PERIOD_LABEL: Record<Cat, string> = {
  week: "This week",
  month: "This month",
  year: "This year",
  oat: "All time",
};

function periodStart(category: Cat): Date {
  const d = new Date();
  if (category === "week") {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() - (day - 1));
    return t;
  }
  if (category === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (category === "year") return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(2020, 0, 1));
}

export function CategoryChart({ category, periodKey }: { category: Cat; periodKey: string }) {
  const qc = useQueryClient();
  const queryKey = ["category-history", category, periodKey];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_category_vote_history", {
        _category: category,
        _period_key: periodKey,
      });
      if (error) throw error;
      return ((data ?? []) as Point[]).map((p) => ({ t: p.t, score: Number(p.score) }));
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    const ch = supabase
      .channel(`cat-${category}-${periodKey}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vote_events" }, () => {
        qc.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, periodKey]);

  const start = periodStart(category).getTime();
  const now = Date.now();
  const series: Point[] = [{ t: new Date(start).toISOString(), score: 0 }];
  if (data && data.length > 0) series.push(...data);
  series.push({ t: new Date(now).toISOString(), score: series[series.length - 1].score });

  const w = 800;
  const h = 120;
  const padX = 32;
  const padY = 14;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const xs = series.map((p) => new Date(p.t).getTime());
  const ys = series.map((p) => p.score);
  const xMin = start;
  const xMax = Math.max(now, ...xs);
  const xRange = xMax - xMin || 1;
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const yPad = Math.max(2, (yMax - yMin) * 0.15);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const yRange = yHi - yLo || 1;

  const toX = (t: number) => padX + ((t - xMin) / xRange) * innerW;
  const toY = (v: number) => padY + (1 - (v - yLo) / yRange) * innerH;

  const path = series
    .map((p, i) => {
      const x = toX(new Date(p.t).getTime());
      const y = toY(p.score);
      if (i === 0) return `M${x.toFixed(2)},${y.toFixed(2)}`;
      const prevY = toY(series[i - 1].score);
      return `L${x.toFixed(2)},${prevY.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const last = series[series.length - 1].score;
  const up = last >= 0;
  const stroke = up ? "var(--ticker-up)" : "var(--ticker-down)";
  const areaPath = `${path} L${toX(xMax).toFixed(2)},${(h - padY).toFixed(2)} L${toX(xMin).toFixed(2)},${(h - padY).toFixed(2)} Z`;
  const zeroY = toY(0);
  const gradId = `cat-grad-${category}-${periodKey}`;

  return (
    <div className="border border-ink/20 bg-card p-3 mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <div className="ui small-caps text-[10px] text-muted-foreground">
          {PERIOD_LABEL[category]} · Vote index
        </div>
        <div className={`ui text-xs tabular-nums ${up ? "text-ticker-up" : "text-ticker-down"}`}>
          {last > 0 ? "+" : ""}{last.toFixed(0)}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} x2={w - padX} y1={zeroY} y2={zeroY} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}