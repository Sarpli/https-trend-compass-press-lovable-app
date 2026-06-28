import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { todayLocalISO, useUserTimezone } from "@/lib/timezone";

const STREAK_HELP = `Streaks grow once per calendar day in your local timezone. Mark a term as learned to add +1. Miss a full day and the streak resets to zero. Resets happen at midnight your time.`;

export function StreakBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const tz = useUserTimezone();
  const today = todayLocalISO(tz);
  const [showTip, setShowTip] = useState(false);
  const { data: count = 0 } = useQuery({
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
  const completedToday = !!markedToday;
  const label = user
    ? `Daily streak: ${count} day${count === 1 ? "" : "s"}`
    : "Sign in to start your daily streak";

  const inner = (
    <span className="inline-flex items-center gap-1">
      <span
        data-testid="streak-badge"
        data-streak-count={count}
        className={`inline-flex items-center gap-1 tabular-nums ui small-caps text-[12px] leading-none text-foreground ${className}`}
      >
        <span
          aria-label={completedToday ? "Streak completed today" : "Daily streak not yet completed"}
          className={`text-[14px] leading-none ${completedToday ? "" : "grayscale opacity-60"}`}
        >
          🔥
        </span>
        <span aria-label={`${count} day streak`} data-testid="streak-count" className="font-semibold">
          {count}
        </span>
      </span>
      {user && (
        <span className="relative">
          <button
            type="button"
            aria-label="How streaks work"
            aria-describedby="streak-help"
            onClick={() => setShowTip((v) => !v)}
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onFocus={() => setShowTip(true)}
            onBlur={() => setShowTip(false)}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-foreground/40 bg-background text-[11px] leading-none text-foreground hover:border-accent-red hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            ?
          </button>
          <span
            id="streak-help"
            role="tooltip"
            aria-hidden={!showTip}
            className={`pointer-events-none absolute top-full right-0 mt-2 w-56 sm:w-64 rounded border border-border bg-popover p-2 shadow-lg text-[11px] leading-snug text-popover-foreground z-50 transition-opacity duration-150 ${
              showTip ? "opacity-100" : "opacity-0"
            }`}
          >
            {STREAK_HELP}
          </span>
        </span>
      )}
    </span>
  );

  return user ? (
    <Link to="/account" aria-label={label} className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  ) : (
    <Link to="/auth" aria-label={label} className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  );
}