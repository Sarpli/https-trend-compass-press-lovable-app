import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { haptic } from "@/lib/haptics";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

function localDateISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function LearnedBanner({ trendId }: { trendId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = localDateISO();
  const dismissKey = user ? `learned-banner-dismissed:${user.id}:${trendId}` : "";
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!dismissKey) return;
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  const { data: learned, isLoading } = useQuery({
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

  const mark = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("mark_trend_learned", {
        _trend_id: trendId,
        _local_date: today,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (newCount) => {
      haptic("up");
      toast.success(`🔥 Streak: ${newCount} day${newCount === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["learned", trendId] });
      qc.invalidateQueries({ queryKey: ["effective-streak"] });
      qc.invalidateQueries({ queryKey: ["profile-streak"] });
      qc.invalidateQueries({ queryKey: ["marked-today"] });
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

  if (isLoading || learned || dismissed) return null;

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
    if (dismissKey) localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  };

  return (
    <div className="mt-6 relative border border-accent-red/50 bg-accent-red/5 hover:bg-accent-red/10 transition-colors flex items-stretch">
      <button
        type="button"
        onClick={() => {
          mark.mutate();
          if (dismissKey) localStorage.setItem(dismissKey, "1");
        }}
        disabled={mark.isPending}
        className="flex-1 p-4 ui text-sm text-left flex items-center justify-between gap-3 disabled:opacity-60"
        aria-label={label}
      >
        <span>
          {showFlames && <><span aria-hidden="true">🔥</span>{" "}</>}
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
  );
}