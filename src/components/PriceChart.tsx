import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Point = { t: string; price: number };

export function PriceChart({ trendId, basePrice }: { trendId: string; basePrice: number }) {
  const { data } = useQuery({
    queryKey: ["trend-history", trendId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trend_price_history", { _trend_id: trendId });
      if (error) throw error;
      return ((data ?? []) as Point[]).map((p) => ({ t: p.t, price: Number(p.price) }));
    },
    refetchInterval: 10000,
  });

  const points: Point[] = [];
  const first = data?.[0];
  // Always anchor the chart at base_price, slightly before the first vote (or "now" if none yet).
  const anchorTime = first ? new Date(new Date(first.t).getTime() - 60_000).toISOString() : new Date(Date.now() - 60_000).toISOString();
  points.push({ t: anchorTime, price: Number(basePrice) });
  if (data && data.length > 0) {
    points.push(...data);
  } else {
    points.push({ t: new Date().toISOString(), price: Number(basePrice) });
  }

  const w = 800;
  const h = 220;
  const padX = 40;
  const padY = 20;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const xs = points.map((p) => new Date(p.t).getTime());
  const ys = points.map((p) => p.price);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = xMax - xMin || 1;
  const yMin = Math.min(...ys, Number(basePrice));
  const yMax = Math.max(...ys, Number(basePrice));
  const yPad = Math.max(2, (yMax - yMin) * 0.1);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const yRange = yHi - yLo || 1;

  const toX = (t: number) => padX + ((t - xMin) / xRange) * innerW;
  const toY = (v: number) => padY + (1 - (v - yLo) / yRange) * innerH;

  // Stepped line — feels like a stock chart with discrete vote events.
  const path = points
    .map((p, i) => {
      const x = toX(new Date(p.t).getTime());
      const y = toY(p.price);
      if (i === 0) return `M${x.toFixed(2)},${y.toFixed(2)}`;
      const prevY = toY(points[i - 1].price);
      return `L${x.toFixed(2)},${prevY.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const lastPrice = points[points.length - 1].price;
  const firstPrice = Number(basePrice);
  const up = lastPrice >= firstPrice;
  const stroke = up ? "var(--ticker-up)" : "var(--ticker-down)";
  const areaPath = `${path} L${toX(xMax).toFixed(2)},${(h - padY).toFixed(2)} L${toX(xMin).toFixed(2)},${(h - padY).toFixed(2)} Z`;

  // Y-axis gridlines at 4 evenly spaced ticks.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = yLo + f * yRange;
    return { y: toY(v), v };
  });

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="border border-ink/20 bg-card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="display text-lg font-bold">Price history</h3>
        <div className="ui small-caps text-xs text-muted-foreground">
          Base {firstPrice.toFixed(0)} → Now <span className={up ? "text-ticker-up" : "text-ticker-down"}>{lastPrice.toFixed(0)}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${trendId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padX} x2={w - padX} y1={tk.y} y2={tk.y} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="2 3" />
            <text x={padX - 6} y={tk.y + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity={0.5} className="ui tabular-nums">
              {tk.v.toFixed(0)}
            </text>
          </g>
        ))}
        {/* Base price reference */}
        <line x1={padX} x2={w - padX} y1={toY(firstPrice)} y2={toY(firstPrice)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 4" />
        <path d={areaPath} fill={`url(#grad-${trendId})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        {/* X-axis labels: first and last */}
        <text x={padX} y={h - 4} fontSize="10" fill="currentColor" fillOpacity={0.5} className="ui">
          {fmtTime(points[0].t)}
        </text>
        <text x={w - padX} y={h - 4} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity={0.5} className="ui">
          {fmtTime(points[points.length - 1].t)}
        </text>
      </svg>
      {(!data || data.length === 0) && (
        <div className="ui small-caps text-[11px] text-muted-foreground mt-1">No votes yet — chart starts at base price.</div>
      )}
    </div>
  );
}