import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Fetches the set of trend_ids the current user has marked as learned.
 * Shared across all <LearnedFlag /> instances via React Query cache.
 */
function useLearnedSet() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["learned-set", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learned_trends")
        .select("trend_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.trend_id as string));
    },
  });
}

type Props = {
  trendId: string | null | undefined;
  className?: string;
  /** Compact pin-style flag for tight spaces (e.g. ranked lists). */
  size?: "sm" | "xs";
};

export function LearnedFlag({ trendId, className = "", size = "sm" }: Props) {
  const { data: learned } = useLearnedSet();
  if (!trendId || !learned?.has(trendId)) return null;

  const pad = size === "xs" ? "px-1.5 py-0.5 text-[9px] gap-1" : "px-2 py-0.5 text-[10px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center ${pad} border border-ticker-up/50 bg-ticker-up/10 text-ticker-up ui small-caps font-semibold tracking-wider align-middle ${className}`}
      aria-label="You learned this term"
      title="You learned this term"
    >
      <span aria-hidden="true">✓</span>
      <span>Learned</span>
    </span>
  );
}