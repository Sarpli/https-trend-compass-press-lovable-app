import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { currentPeriodKey, CATEGORY_LABEL } from "@/lib/period";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { beginVoteMutation, endVoteMutation } from "@/lib/vote-reconcile";

type Category = "week" | "month" | "year" | "oat";

interface Props {
  trendId: string;
  category: Category;
  compact?: boolean;
  wide?: boolean;
}

export function VoteButtons({ trendId, category, compact, wide }: Props) {
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
      beginVoteMutation();
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
      const lbKey = ["leaderboard", category, periodKey] as const;
      const myKey = ["myvote", trendId, category, periodKey, user?.id] as const;
      const scoreKey = ["trend-score", trendId] as const;
      await qc.cancelQueries({ queryKey: lbKey });
      await qc.cancelQueries({ queryKey: myKey });
      await qc.cancelQueries({ queryKey: scoreKey });
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

      const prevLb = qc.getQueryData<Array<{ id: string; net: number; price: number; base_price: number }>>(lbKey);
      qc.setQueryData(lbKey, (old: typeof prevLb) => {
        if (!old) return old;
        return [...old]
          .map((r) =>
            r.id === trendId
              ? { ...r, net: r.net + delta, price: Number(r.base_price) + r.net + delta }
              : r,
          )
          .sort((a, b) => b.net - a.net);
      });

      const prevMy = qc.getQueryData(myKey);
      const nextMy = myVote
        ? myVote.direction === direction
          ? null
          : { ...myVote, direction }
        : { id: "optimistic", direction };
      qc.setQueryData(myKey, nextMy);

      const prevScore = qc.getQueryData<{ price: number; net_votes: number } | undefined>(scoreKey);
      if (prevScore) {
        qc.setQueryData(scoreKey, {
          ...prevScore,
          net_votes: Number(prevScore.net_votes) + delta,
          price: Number(prevScore.price) + delta,
        });
      }

      return { prevTicker, prevLb, prevMy, prevScore, lbKey, myKey, scoreKey };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prevTicker) qc.setQueryData(["ticker"], ctx.prevTicker);
      if (ctx?.lbKey) qc.setQueryData(ctx.lbKey, ctx.prevLb);
      if (ctx?.myKey) qc.setQueryData(ctx.myKey, ctx.prevMy);
      if (ctx?.scoreKey && ctx.prevScore !== undefined) qc.setQueryData(ctx.scoreKey, ctx.prevScore);
      const raw = e.message || "";
      if (raw.includes("PRO_REQUIRED")) {
        toast.error("Pro required to vote on Year & All-Time", {
          description: "Upgrade to Pro to cast votes on these leaderboards.",
          action: { label: "Upgrade", onClick: () => navigate({ to: "/pricing" }) },
        });
      } else {
        toast.error("Vote didn't go through — we rolled it back", {
          description: raw || "Your vote was returned to its previous state. Try again in a moment.",
        });
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["ticker"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["myvote", trendId] });
      qc.invalidateQueries({ queryKey: ["trend-score", trendId] });
      // Release any realtime invalidations that arrived during the mutation.
      endVoteMutation();
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
    if (mut.isPending) return;
    if (!user) { navigate({ to: "/auth" }); return; }
    haptic(d);
    mut.mutate(d);
  };

  return (
    <div className={cn("inline-flex items-center gap-1.5 ui", compact ? "text-xs" : "text-sm")}>
      <button
        onClick={() => handle("up")}
        disabled={mut.isPending}
        className={cn(
          "border border-ink/30 hover:bg-ink hover:text-newsprint transition-all duration-200 ease-out flex items-center justify-center active:opacity-70 will-change-transform disabled:opacity-40 disabled:cursor-not-allowed",
          wide ? "px-6 py-1.5 min-w-[68px]" : "px-2.5 py-1.5",
          myVote?.direction === "up" && "bg-ticker-up text-newsprint border-ticker-up",
        )}
        aria-label="Vote up"
      >
        {mut.isPending && mut.variables === "up" ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ChevronUp className="w-6 h-6 transition-transform duration-200 ease-out" strokeWidth={2.5} />
        )}
      </button>
      <button
        onClick={() => handle("down")}
        disabled={mut.isPending}
        className={cn(
          "border border-ink/30 hover:bg-ink hover:text-newsprint transition-all duration-200 ease-out flex items-center justify-center active:opacity-70 will-change-transform disabled:opacity-40 disabled:cursor-not-allowed",
          wide ? "px-6 py-1.5 min-w-[68px]" : "px-2.5 py-1.5",
          myVote?.direction === "down" && "bg-ticker-down text-newsprint border-ticker-down",
        )}
        aria-label="Vote down"
      >
        {mut.isPending && mut.variables === "down" ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ChevronDown className="w-6 h-6 transition-transform duration-200 ease-out" strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
}