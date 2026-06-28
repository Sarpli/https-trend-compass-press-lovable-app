import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

function localDateISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StreakBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const today = localDateISO();
  const { data: count = 0 } = useQuery({
    queryKey: ["effective-streak", user?.id, today],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("get_effective_streak", { _local_date: today });
      return Number(data ?? 0);
    },
  });
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