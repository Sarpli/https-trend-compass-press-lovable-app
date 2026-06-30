import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { haptic, celebrate } from "@/lib/haptics";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLocalDateKey } from "@/lib/use-local-date";
import { useSettings } from "@/lib/settings";
import { StreakCelebration } from "./StreakCelebration";

export function LearnedBanner({ trendId }: { trendId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { date: today } = useLocalDateKey();
  // On local-midnight rollover, refetch streak + marked-today so the banner
  // flips back to "mark as learned" for the new day without a reload.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["effective-streak"] });
    qc.invalidateQueries({ queryKey: ["marked-today"] });
  }, [today, qc]);
  const mountedRef = useRef(true);
  const { motionReduced, streakAnimations } = useSettings();
  const animOK = streakAnimations && !motionReduced;

  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [burst, setBurst] = useState(0);
  const [celebration, setCelebration] = useState<{ key: number; streak: number } | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { data: dismissedRow, isLoading: dismissedLoading } = useQuery({
    queryKey: ["banner-dismissed", trendId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("dismissed_banners")
        .select("trend_id")
        .eq("user_id", user!.id)
        .eq("trend_id", trendId)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (dismissedRow) setDismissed(true);
  }, [dismissedRow]);

  const { data: learned, isLoading: learnedLoading } = useQuery({
    queryKey: ["learned", trendId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("learned_trends")
        .select("trend_id")
        .eq("user_id", user!.id)
        .eq("trend_id", trendId)
        .maybeSingle();
      return !!data;
    },
  });

  const { data: streak } = useQuery({
    queryKey: ["effective-streak", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("get_effective_streak", { _local_date: today });
      return Number(data ?? 0);
    },
  });

  const { data: markedToday } = useQuery({
    queryKey: ["marked-today", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("last_active_local_date")
        .eq("id", user!.id)
        .maybeSingle();
      return data?.last_active_local_date === today;
    },
  });

  const dismissBanner = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("dismissed_banners")
        .upsert({ user_id: user!.id, trend_id: trendId }, { onConflict: "user_id,trend_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["banner-dismissed"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mark = useMutation({
    mutationFn: async () => {
      // Capture whether this mark will be the *first* of the local day
      // (before we invalidate `marked-today`).
      const wasFirstToday = !markedToday;
      const { data, error } = await supabase.rpc("mark_trend_learned", {
        _trend_id: trendId,
        _local_date: today,
      });
      if (error) throw error;
      return { newCount: Number(data ?? 0), wasFirstToday };
    },
    onSuccess: ({ newCount, wasFirstToday }) => {
      haptic("up");
      // Trigger confetti burst + dismiss the banner with a fade-out.
      setBurst((n) => n + 1);
      // First mark of the local day → full-screen celebration + chime.
      if (wasFirstToday && animOK) {
        setCelebration({ key: Date.now(), streak: newCount });
        try { celebrate(); } catch {}
      }
      toast.success(`🔥 Streak: ${newCount} day${newCount === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["learned", trendId] });
      qc.invalidateQueries({ queryKey: ["effective-streak"] });
      qc.invalidateQueries({ queryKey: ["profile-streak"] });
      qc.invalidateQueries({ queryKey: ["marked-today"] });
      window.setTimeout(() => {
        if (!mountedRef.current) return;
        setLeaving(true);
        dismissBanner.mutate();
        window.setTimeout(() => {
          if (mountedRef.current) setDismissed(true);
        }, 320);
      }, wasFirstToday && animOK ? 1500 : 700);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) {
    return (
      <div className="mt-6 border border-accent-red/40 bg-accent-red/5 p-4 flex items-center justify-between gap-3">
        <div className="ui text-sm">
          🔥 <span className="font-semibold">Sign in to start your streak</span> — mark terms as learned to build it up.
        </div>
        <Link to="/auth" className="ui small-caps text-xs underline whitespace-nowrap">Sign in →</Link>
      </div>
    );
  }

  if (learnedLoading || dismissedLoading) {
    return celebration ? (
      <StreakCelebration key={celebration.key} streak={celebration.streak} />
    ) : null;
  }

  if (learned) {
    const alreadyTodayLearned = !!markedToday;
    return (
      <>
        {celebration && <StreakCelebration key={celebration.key} streak={celebration.streak} />}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 border border-ticker-up/50 bg-ticker-up/10 px-2.5 py-1 ui small-caps text-[10px] text-ticker-up"
            aria-label="You learned this term"
          >
            <span aria-hidden="true">✓</span>
            <span className="font-semibold tracking-wider">I learned this</span>
          </span>
          {!alreadyTodayLearned && (
            <button
              type="button"
              onClick={() => { if (!mark.isPending) mark.mutate(); }}
              disabled={mark.isPending}
              className="inline-flex items-center gap-1.5 border border-accent-red/50 bg-accent-red/10 hover:bg-accent-red/20 px-2.5 py-1 ui small-caps text-[10px] text-accent-red disabled:opacity-60"
              aria-label="Use this term to keep your streak alive"
            >
              <span aria-hidden="true">🔥</span>
              <span className="font-semibold tracking-wider">
                {mark.isPending ? "Saving…" : "Use for today's streak"}
              </span>
            </button>
          )}
        </div>
      </>
    );
  }

  if (dismissed) {
    return celebration ? (
      <StreakCelebration key={celebration.key} streak={celebration.streak} />
    ) : null;
  }

  const hasStreak = (streak ?? 0) > 0;
  const alreadyToday = !!markedToday;
  const showFlames = !alreadyToday;
  const label = alreadyToday
    ? "Mark as learned"
    : hasStreak
      ? "Mark as learned to keep your streak alive"
      : "I know this one — start your streak";

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dismissBanner.isPending || mark.isPending || leaving) return;
    setLeaving(true);
    dismissBanner.mutate();
    window.setTimeout(() => {
      if (mountedRef.current) setDismissed(true);
    }, 320);
  };

  return (
    <>
    {celebration && <StreakCelebration key={celebration.key} streak={celebration.streak} />}
    <div
      className={`mt-6 relative overflow-visible border border-accent-red/50 bg-accent-red/5 hover:bg-accent-red/10 ${
        animOK ? "transition-all duration-300" : ""
      } flex items-stretch ${
        leaving ? "opacity-0 scale-95 -translate-y-1" : "opacity-100 scale-100"
      } ${animOK && (mark.isPending || burst > 0) ? "streak-pulse animate-[pulse_1.4s_ease-in-out_1]" : ""}`}
    >
      {animOK && burst > 0 && <ConfettiBurst key={burst} />}
      <button
        type="button"
        onClick={() => {
          if (mark.isPending || leaving) return;
          mark.mutate();
        }}
        disabled={mark.isPending}
        className="flex-1 p-4 ui text-sm text-left flex items-center justify-between gap-3 disabled:opacity-60"
        aria-label={label}
      >
        <span>
          {showFlames && (
            <>
              <span aria-hidden="true" className="inline-block">🔥</span>{" "}
            </>
          )}
          <span className="font-semibold">{label}</span>
          {showFlames && <>{" "}<span aria-hidden="true">🔥</span></>}
        </span>
        <span className="ui small-caps text-xs whitespace-nowrap">
          {mark.isPending ? "Saving…" : "Mark learned →"}
        </span>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss banner"
        className="px-3 border-l border-accent-red/30 hover:bg-accent-red/15 transition-colors flex items-center"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    </>
  );
}

const CONFETTI = ["🔥", "✨", "🎉", "⭐", "💥"];
function ConfettiBurst() {
  const pieces = Array.from({ length: 14 }, (_, i) => {
    const angle = (Math.PI * (i / 13)) - Math.PI / 2; // -90deg .. +90deg arc upward
    const dist = 70 + Math.random() * 50;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30;
    const rot = (Math.random() * 360 - 180).toFixed(0);
    return { i, dx: dx.toFixed(1), dy: dy.toFixed(1), rot, e: CONFETTI[i % CONFETTI.length] };
  });
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible z-10" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.i}
          className="absolute text-lg select-none"
          style={{
            animation: "learned-burst 900ms ease-out forwards",
            // @ts-expect-error CSS vars
            "--dx": `${p.dx}px`,
            "--dy": `${p.dy}px`,
            "--rot": `${p.rot}deg`,
          }}
        >
          {p.e}
        </span>
      ))}
      <style>{`
        @keyframes learned-burst {
          0%   { transform: translate(0, 0) rotate(0deg) scale(0.6); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
