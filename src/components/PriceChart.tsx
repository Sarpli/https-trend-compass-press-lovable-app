import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { dailyDriftPct } from "@/lib/daily-drift";

type Point = { t: string; price: number };

export function PriceChart({ trendId, basePrice }: { trendId: string; basePrice: number }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{
    idx: number;
    xPx: number;
    yPx: number;
    containerW: number;
  } | null>(null);
  const { data } = useQuery({
    queryKey: ["trend-history", trendId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trend_price_history", { _trend_id: trendId });
      if (error) throw error;
      return ((data ?? []) as Point[]).map((p) => ({ t: p.t, price: Number(p.price) }));
    },
    refetchInterval: 10000,
  });

  // The RPC always returns a synthetic first point at Jan 1 of the term's
  // creation year (price = base_price), so we just use the series as-is.
  // Append a trailing "now" point so the chart extends to the current time
  // even when there are no recent votes.
  const series: Point[] = (data ?? []).map((p) => ({ t: p.t, price: Number(p.price) }));
  if (series.length === 0) {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
    series.push({ t: startOfYear, price: Number(basePrice) });
  }
  const last = series[series.length - 1];
  const nowIso = new Date().toISOString();
  // Apply the same deterministic daily drift used by the top ticker so the
  // chart's "now" point reflects today's fake percentage move when there are
  // no recent votes. Real votes are already baked into `last.price` by the RPC.
  const drift = dailyDriftPct(trendId) / 100;
  const nowPrice = Math.max(1, last.price * (1 + drift));
  if (new Date(last.t).getTime() < Date.now() - 1000) {
    series.push({ t: nowIso, price: nowPrice });
  } else {
    series[series.length - 1] = { t: last.t, price: nowPrice };
  }
  const points = series;

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

  // Continuous line — straight segments between points, like a real stock chart.
  const path = points
    .map((p, i) => {
      const x = toX(new Date(p.t).getTime());
      const y = toY(p.price);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
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

  const spansYears =
    new Date(points[0].t).getFullYear() !==
    new Date(points[points.length - 1].t).getFullYear();
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return spansYears
      ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const fmtTooltipTime = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fracX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const svgX = fracX * w;
    // Convert svgX back to a timestamp using the same linear mapping toX uses.
    const t = xMin + ((svgX - padX) / innerW) * xRange;
    // Nearest point to the cursor.
    let idx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - t);
      if (d < bestDiff) { bestDiff = d; idx = i; }
    }
    const pointXPx = (toX(xs[idx]) / w) * rect.width;
    const pointYPx = (toY(points[idx].price) / h) * rect.height;
    setHover({ idx, xPx: pointXPx, yPx: pointYPx, containerW: rect.width });
  };

  const tooltipPoint = hover ? points[hover.idx] : null;

  return (
    <div className="border border-ink/20 bg-card p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="display text-lg font-bold">Price history</h3>
        <div className="ui small-caps text-xs text-muted-foreground">
          Base {firstPrice.toFixed(0)} → Now <span className={up ? "text-ticker-up" : "text-ticker-down"}>{lastPrice.toFixed(0)}</span>
        </div>
      </div>
      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full block touch-none"
        style={{ aspectRatio: `${w} / ${h}` }}
        preserveAspectRatio="none"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setHover(null)}
      >
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
        {hover && tooltipPoint && (
          <g pointerEvents="none">
            <line
              x1={toX(xs[hover.idx])}
              x2={toX(xs[hover.idx])}
              y1={padY}
              y2={h - padY}
              stroke={stroke}
              strokeOpacity={0.45}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={toX(xs[hover.idx])}
              cy={toY(tooltipPoint.price)}
              r={4}
              fill="var(--card)"
              stroke={stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>
      {hover && tooltipPoint && (
        <div
          className="ui pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap border border-ink/30 bg-card px-2 py-1 text-[11px] shadow-sm"
          style={{
            left: Math.min(Math.max(hover.xPx, 60), hover.containerW - 60),
            top: Math.max(hover.yPx - 44, 4),
          }}
        >
          <div className="small-caps text-muted-foreground">
            {fmtTooltipTime(tooltipPoint.t)}
          </div>
          <div className="tabular-nums font-semibold">
            {Number(tooltipPoint.price).toFixed(0)}
          </div>
        </div>
      )}
      </div>
      <div
        className="ui small-caps text-[11px] text-muted-foreground mt-1"
        style={{ visibility: !data || data.length === 0 ? "visible" : "hidden" }}
      >
        No votes yet — chart starts at base price.
      </div>
    </div>
  );
}