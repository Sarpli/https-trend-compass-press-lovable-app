import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function StreakBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ["profile-streak", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("streak_count,last_active_date")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const count = profile?.streak_count ?? 0;
  const active = count > 0;
  const label = user
    ? `Daily streak: ${count} day${count === 1 ? "" : "s"}`
    : "Sign in to start your daily streak";

  const inner = (
    <span
      data-testid="streak-badge"
      data-streak-count={count}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 tabular-nums ui small-caps text-[11px] leading-none ${className}`}
    >
      <Flame
        className={`w-3.5 h-3.5 ${active ? "text-accent-red" : "text-muted-foreground"}`}
        fill={active ? "currentColor" : "none"}
        strokeWidth={2}
      />
      <span data-testid="streak-count">{count}</span>
    </span>
  );

  return user ? (
    <Link to="/account" className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  ) : (
    <Link to="/auth" className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  );
}