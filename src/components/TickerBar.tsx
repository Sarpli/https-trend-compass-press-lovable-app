import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { combinedDailyPct } from "@/lib/daily-drift";

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

function TickerBarInner() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["ticker"],
    queryFn: fetchScores,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const [pcts, setPcts] = useState<Record<string, number>>({});
  const [loopCopies, setLoopCopies] = useState(4);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const restoredRef = useRef(false);
  const offsetRef = useRef(0);
  const pointerRef = useRef({ active: false, startX: 0, startOffset: 0, moved: false });
  const STORAGE_KEY = "trenslate.ticker.scrollLeft";

  // Ensure the scrolling track is always at least 2.5× the viewport width so
  // the ticker never runs out of content and there is no empty strip on the
  // right, regardless of screen size or number of terms.
  useEffect(() => {
    if (rows.length === 0) return;
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;
    const ensureCoverage = () => {
      const viewport = scroller.clientWidth;
      if (!viewport || !track.scrollWidth) return;
      const singleCopy = track.scrollWidth / loopCopies;
      if (singleCopy <= 0) return;
      const needed = Math.ceil((viewport * 2.5) / singleCopy);
      const next = Math.max(4, needed);
      if (next !== loopCopies) setLoopCopies(next);
    };
    ensureCoverage();
    window.addEventListener("resize", ensureCoverage);
    return () => window.removeEventListener("resize", ensureCoverage);
  }, [rows.length, loopCopies]);

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
    const EASE_IN_SEC = 0.3; // ramp from 0 back to full speed after a pause
    let speed = 1; // current velocity multiplier; resets to 0 on resume
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
        // Ramp speed back up after a pause/drag so the tape doesn't snap
        // instantly from 0 to full velocity.
        speed = Math.min(1, speed + dt / EASE_IN_SEC);
        offsetRef.current = normalize(offsetRef.current + PX_PER_SEC * speed * dt);
        render();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const pause = () => { pausedRef.current = true; };
    const resume = () => { pausedRef.current = false; last = performance.now(); speed = 0; };
    // Desktop: pause on hover so the mouse can read items. Mobile/touch:
    // auto-scroll continues and users can drag-to-scrub the tape.
    const canHover = true;
    const SCRUB_MULTIPLIER = 1.7; // looser scroll: 1 px finger drag = 1.7 px tape
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      pointerRef.current = { active: true, startX: e.clientX, startOffset: offsetRef.current, moved: false };
      pause();
      scroller.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pointerRef.current.active) return;
      const rawDx = e.clientX - pointerRef.current.startX;
      if (Math.abs(rawDx) > 3) pointerRef.current.moved = true;
      const dx = rawDx * SCRUB_MULTIPLIER;
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
    const onMouseEnter = () => { pause(); };
    const onMouseLeave = () => { resume(); };
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", endPointer);
    scroller.addEventListener("pointercancel", endPointer);
    scroller.addEventListener("click", preventDraggedClick, true);
    if (canHover) {
      scroller.addEventListener("mouseenter", onMouseEnter);
      scroller.addEventListener("mouseleave", onMouseLeave);
    }
    return () => {
      cancelAnimationFrame(raf);
      savePosition();
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", endPointer);
      scroller.removeEventListener("pointercancel", endPointer);
      scroller.removeEventListener("click", preventDraggedClick, true);
      if (canHover) {
        scroller.removeEventListener("mouseenter", onMouseEnter);
        scroller.removeEventListener("mouseleave", onMouseLeave);
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

  // Each ticker shows a fake-but-stable daily drift plus the live vote impact,
  // so percentages stay non-zero and feel alive even with no recent votes.
  useEffect(() => {
    if (rows.length === 0) return;
    const nextPcts: Record<string, number> = {};
    rows.forEach((r) => {
      nextPcts[r.trend_id] = combinedDailyPct(r.trend_id, r.net_votes);
    });
    setPcts(nextPcts);
  }, [rows]);

  if (rows.length === 0) return <div className="ticker-bar ticker-bar-sheen text-newsprint h-9 sm:h-10" />;

  const items = Array.from({ length: loopCopies }, () => rows).flat();

  return (
    <div className="ticker-bar ticker-bar-sheen text-newsprint overflow-hidden ui text-xs sm:text-sm h-9 sm:h-10">
      <div className="flex items-center h-full">
        <div className="w-9 h-9 sm:w-10 sm:h-10 small-caps bg-accent-red text-accent-foreground flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 border-r border-newsprint/15">
          Live
        </div>
        <div
          ref={scrollerRef}
          className="flex-1 relative ticker-scroller h-full"
          style={{ overflow: "hidden", touchAction: "pan-y", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
        >
          <div ref={trackRef} className="inline-flex items-center h-full whitespace-nowrap will-change-transform px-1 sm:px-2">
            {items.map((r, i) => {
              const pct = pcts[r.trend_id] ?? 0;
              const isUp = pct > 0;
              const isDown = pct < 0;
              return (
                <Link
                  key={`${r.trend_id}-${i}`}
                  to="/trends/$slug"
                  params={{ slug: r.slug }}
                  className={`inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 mx-0.5 sm:mx-1 rounded-sm transition-colors hover:bg-newsprint/5 ${
                    isUp ? "text-ticker-up" : isDown ? "text-ticker-down" : "hover:text-accent-red"
                  }`}
                >
                  <span className="small-caps font-bold tracking-wider uppercase leading-none">{r.term}</span>
                  <span className="tabular-nums text-xs sm:text-sm leading-none">
                    {isUp ? "+" : ""}{pct.toFixed(2)}%
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
