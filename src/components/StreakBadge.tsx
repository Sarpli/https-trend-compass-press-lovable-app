import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
      className={`inline-flex items-center gap-1 tabular-nums ui small-caps text-[12px] leading-none ${className}`}
    >
      <span
        aria-hidden="true"
        className={`text-[14px] leading-none ${active ? "" : "grayscale opacity-60"}`}
      >
        🔥
      </span>
      <span data-testid="streak-count" className="font-semibold">{count}</span>
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