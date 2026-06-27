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
  const w = 40;
  const h = 14;
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
  const fillId = `spk-${Math.random().toString(36).slice(2, 9)}`;
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.42" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const restoredRef = useRef(false);
  const offsetRef = useRef(0);
  const pointerRef = useRef({ active: false, startX: 0, startOffset: 0, moved: false });
  const STORAGE_KEY = "trenslate.ticker.scrollLeft";

  // Auto-scroll the tape with a GPU transform instead of writing scrollLeft on
  // every frame. That keeps desktop motion smooth while preserving drag/wheel
  // scrubbing and the saved ticker position.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;
    let raf = 0;
    let last = performance.now();
    const PX_PER_SEC = 40; // matches ~180s loop feel
    const getHalf = () => track.scrollWidth / 2;
    const normalize = (value: number) => {
      const half = getHalf();
      if (half <= 0) return 0;
      return ((value % half) + half) % half;
    };
    const render = () => {
      track.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    };
    const savePosition = () => {
      try { sessionStorage.setItem(STORAGE_KEY, String(offsetRef.current)); } catch {}
    };
    // Restore the user's previous scroll position once the track has width.
    if (!restoredRef.current) {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        const half = getHalf();
        if (saved && half > 0) {
          const v = parseFloat(saved);
          if (Number.isFinite(v)) offsetRef.current = normalize(v);
        }
        restoredRef.current = true;
      } catch {}
    }
    render();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!pausedRef.current) {
        offsetRef.current = normalize(offsetRef.current + PX_PER_SEC * dt);
        render();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const pause = () => { pausedRef.current = true; };
    const resume = () => { pausedRef.current = false; last = performance.now(); };
    // Per spec: the tape must never stop scrolling. No hover-pause on any
    // device — desktop and touch both run continuously like Apple's Stocks
    // ticker. Pause is reserved for active drag-scrubbing on touch.
    const canHover = false;
    // Drag-to-scrub and wheel-scrub are touch-only. On desktop the ticker is
    // strictly auto-scroll with hover-pause — no user scrolling on the bar.
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      pointerRef.current = { active: true, startX: e.clientX, startOffset: offsetRef.current, moved: false };
      pause();
      scroller.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointerRef.current.active) return;
      const dx = e.clientX - pointerRef.current.startX;
      if (Math.abs(dx) > 3) pointerRef.current.moved = true;
      offsetRef.current = normalize(pointerRef.current.startOffset - dx);
      render();
    };
    const endPointer = (e: PointerEvent) => {
      if (!pointerRef.current.active) return;
      pointerRef.current.active = false;
      scroller.releasePointerCapture?.(e.pointerId);
      savePosition();
      resume();
    };
    const preventDraggedClick = (e: MouseEvent) => {
      if (!pointerRef.current.moved) return;
      e.preventDefault();
      e.stopPropagation();
      pointerRef.current.moved = false;
    };
    if (!canHover) {
      scroller.addEventListener("pointerdown", onPointerDown);
      scroller.addEventListener("pointermove", onPointerMove);
      scroller.addEventListener("pointerup", endPointer);
      scroller.addEventListener("pointercancel", endPointer);
      scroller.addEventListener("click", preventDraggedClick, true);
    }
    return () => {
      cancelAnimationFrame(raf);
      savePosition();
      if (!canHover) {
        scroller.removeEventListener("pointerdown", onPointerDown);
        scroller.removeEventListener("pointermove", onPointerMove);
        scroller.removeEventListener("pointerup", endPointer);
        scroller.removeEventListener("pointercancel", endPointer);
        scroller.removeEventListener("click", preventDraggedClick, true);
      }
    };
  }, [rows.length]);

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

  // Seed each ticker item's sparkline with the tail of its real Price History
  // so cards show a unique stock graph immediately instead of a flat line.
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (rows.length === 0) return;
    const toFetch = rows.filter((r) => !seededRef.current.has(r.trend_id));
    if (toFetch.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        toFetch.map(async (r) => {
          seededRef.current.add(r.trend_id);
          const { data } = await supabase.rpc("get_trend_price_history", { _trend_id: r.trend_id });
          const pts = ((data ?? []) as { price: number }[])
            .map((p) => Number(p.price))
            .filter((n) => Number.isFinite(n))
            .slice(-24);
          return [r.trend_id, pts] as const;
        }),
      );
      if (cancelled) return;
      setHistory((h) => {
        const copy = { ...h };
        for (const [id, pts] of results) {
          if (pts.length > 1) copy[id] = pts;
        }
        return copy;
      });
    })();
    return () => { cancelled = true; };
  }, [rows]);

  if (rows.length === 0) return <div className="ticker-bar ticker-bar-sheen text-newsprint h-8" />;

  const items = [...rows, ...rows]; // duplicate for seamless scroll

  return (
    <div className="ticker-bar ticker-bar-sheen text-newsprint overflow-hidden ui text-[10px] sm:text-xs">
      <div className="flex items-stretch">
        <div className="w-9 h-9 sm:w-11 sm:h-11 small-caps bg-accent-red text-accent-foreground flex items-center justify-center font-bold text-[10px] sm:text-xs shrink-0 border-r border-newsprint/15">
          Live
        </div>
        <div
          ref={scrollerRef}
          className="flex-1 relative ticker-scroller"
          style={{ overflow: "hidden", touchAction: "pan-y", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
        >
          <div ref={trackRef} className="inline-flex gap-6 sm:gap-8 py-1 sm:py-1.5 whitespace-nowrap will-change-transform">
            {items.map((r, i) => {
              const delta = deltas[r.trend_id] ?? 0;
              const series = history[r.trend_id] ?? [r.price];
              // Compare the latest seeded price to the start of the seeded
              // tail (i.e. the chart segment shown in the sparkline) so the
              // ticker color matches what the user actually sees.
              const seriesUp = series.length > 1 && series[series.length - 1] >= series[0];
              // Until the price-history tail has been fetched, default to a
              // neutral "up" appearance instead of falling back to net_votes,
              // which often disagrees with the actual chart trend.
              const dir = delta > 0 ? "up" : delta < 0 ? "down" :
                series.length > 1 ? (seriesUp ? "up-static" : "down-static") :
                "up-static";
              const flashing = delta !== 0;
              const isUp = dir === "up" || dir === "up-static";
              const isDown = dir === "down" || dir === "down-static";
              // Sleek: no colored border/background. Color lives only in the
              // sparkline + arrow + delta text.
              return (
                <Link
                  key={`${r.trend_id}-${i}`}
                  to="/trends/$slug"
                  params={{ slug: r.slug }}
                  className={`inline-flex items-center gap-1.5 mx-0.5 sm:mx-1.5 px-1 py-0.5 rounded-md transition-colors hover:bg-newsprint/5 ${
                    flashing ? (isUp ? "text-ticker-up" : "text-ticker-down") : "hover:text-accent-red"
                  }`}
                >
                  <span className="small-caps font-bold tracking-wider">{r.term}</span>
                  <span className="tabular-nums">{r.price.toFixed(0)}</span>
                  <Sparkline
                    points={series}
                    up={isUp}
                    down={isDown}
                  />
                  {isUp && <ArrowUp className="w-3 h-3 text-ticker-up" />}
                  {isDown && <ArrowDown className="w-3 h-3 text-ticker-down" />}
                  {/* no flat state — sparkline defaults to up-static until seeded */}
                  {flashing && (
                    <span className={`tabular-nums text-[10px] ${isUp ? "text-ticker-up" : "text-ticker-down"}`}>
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