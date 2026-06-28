import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { todayLocalISO, useUserTimezone } from "@/lib/timezone";
import { useBump } from "@/lib/use-bump";
import { useSettings } from "@/lib/settings";

export function StreakBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const tz = useUserTimezone();
  const today = todayLocalISO(tz);
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
  const { motionReduced, streakAnimations } = useSettings();
  // When the user lands on a page (e.g. right after login) and today's
  // streak is already complete, fire a one-shot welcome bump.
  const rawBump = useBump(count, { bumpOnInitial: !!markedToday });
  const bumping = rawBump && streakAnimations && !motionReduced;
  const completedToday = !!markedToday;
  const label = user
    ? `Daily streak: ${count} day${count === 1 ? "" : "s"}`
    : "Sign in to start your daily streak";

  const inner = (
    <span
      data-testid="streak-badge"
      data-streak-count={count}
      className={`inline-flex items-center gap-1 tabular-nums ui small-caps text-[12px] leading-none text-foreground ${className}`}
    >
      <span
        aria-label={completedToday ? "Streak completed today" : "Daily streak not yet completed"}
        className={`text-[14px] leading-none transition-all duration-300 ${
          completedToday ? "" : "grayscale opacity-60"
        } ${bumping ? "scale-125" : ""}`}
      >
        🔥
      </span>
      <span
        aria-label={`${count} day streak`}
        data-testid="streak-count"
        className={`font-semibold transition-all duration-300 ${
          bumping ? "scale-125 text-accent-red drop-shadow" : ""
        }`}
      >
        {count}
      </span>
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