import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { currentPeriodKey, CATEGORY_LABEL } from "@/lib/period";
import { cn } from "@/lib/utils";

type Category = "week" | "month" | "year" | "oat";

interface Props {
  trendId: string;
  category: Category;
  compact?: boolean;
}

export function VoteButtons({ trendId, category, compact }: Props) {
  const { user, isPro, isAnnual } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const periodKey = currentPeriodKey(category);
  const locked = (category === "year" || category === "oat") && !isPro;

  const { data: myVote } = useQuery({
    queryKey: ["myvote", trendId, category, periodKey, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("votes")
        .select("id,direction")
        .eq("trend_id", trendId)
        .eq("category", category)
        .eq("period_key", periodKey)
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const mut = useMutation({
    mutationFn: async (direction: "up" | "down") => {
      if (!user) throw new Error("auth");
      const weight = isAnnual ? 2 : 1;
      if (myVote) {
        if (myVote.direction === direction) {
          const { error } = await supabase.from("votes").delete().eq("id", myVote.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("votes").update({ direction, weight }).eq("id", myVote.id);
          if (error) throw error;
        }
      } else {
        const { error } = await supabase.from("votes").insert({
          user_id: user.id, trend_id: trendId, category, direction, weight, period_key: periodKey,
        });
        if (error) throw error;
      }
    },
    onMutate: async (direction: "up" | "down") => {
      const weight = isAnnual ? 2 : 1;
      // Compute the net-vote delta this click produces.
      let delta = 0;
      if (myVote) {
        if (myVote.direction === direction) {
          // Toggling off: remove previous contribution.
          delta = myVote.direction === "up" ? -weight : weight;
        } else {
          // Flipping sides: remove old + add new.
          delta = direction === "up" ? 2 * weight : -2 * weight;
        }
      } else {
        delta = direction === "up" ? weight : -weight;
      }

      await qc.cancelQueries({ queryKey: ["ticker"] });
      const prevTicker = qc.getQueryData<Array<{ trend_id: string; price: number; net_votes: number }>>(["ticker"]);
      qc.setQueryData(["ticker"], (old: typeof prevTicker) => {
        if (!old) return old;
        return old
          .map((r) =>
            r.trend_id === trendId
              ? { ...r, net_votes: Number(r.net_votes) + delta, price: Number(r.price) + delta }
              : r,
          )
          .sort((a, b) => Number(b.price) - Number(a.price));
      });
      return { prevTicker };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prevTicker) qc.setQueryData(["ticker"], ctx.prevTicker);
      toast.error(e.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["ticker"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["myvote", trendId] });
    },
  });

  if (locked) {
    return (
      <button
        onClick={() => navigate({ to: "/pricing" })}
        className="ui text-xs small-caps inline-flex items-center gap-1 text-muted-foreground hover:text-accent-red"
        title={`${CATEGORY_LABEL[category]} — Pro only`}
      >
        <Lock className="w-3 h-3" /> Pro
      </button>
    );
  }

  const handle = (d: "up" | "down") => {
    if (!user) { navigate({ to: "/auth" }); return; }
    mut.mutate(d);
  };

  return (
    <div className={cn("inline-flex items-center gap-1 ui", compact ? "text-xs" : "text-sm")}>
      <button
        onClick={() => handle("up")}
        className={cn(
          "px-1.5 py-0.5 border border-ink/30 hover:bg-ink hover:text-newsprint transition-colors",
          myVote?.direction === "up" && "bg-ticker-up text-newsprint border-ticker-up",
        )}
        aria-label="Vote up"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => handle("down")}
        className={cn(
          "px-1.5 py-0.5 border border-ink/30 hover:bg-ink hover:text-newsprint transition-colors",
          myVote?.direction === "down" && "bg-ticker-down text-newsprint border-ticker-down",
        )}
        aria-label="Vote down"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}