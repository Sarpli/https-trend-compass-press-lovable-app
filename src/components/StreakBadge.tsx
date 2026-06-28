import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

function localDateISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STREAK_HELP = `Streaks grow once per calendar day in your local timezone. Mark a term as learned to add +1. Miss a full day and the streak resets to zero. Resets happen at midnight your time.`;

export function StreakBadge({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const today = localDateISO();
  const [showTip, setShowTip] = useState(false);
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
    <span className="inline-flex items-center gap-1">
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
            className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-ink/30 text-[10px] leading-none text-muted-foreground hover:border-accent-red hover:text-accent-red transition-colors"
          >
            ?
          </button>
          <span
            id="streak-help"
            role="tooltip"
            className={`pointer-events-none absolute top-full right-0 mt-2 w-56 sm:w-64 rounded border border-ink/10 bg-newsprint p-2 shadow-lg text-[11px] leading-snug text-ink z-50 transition-opacity duration-150 ${
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
    <Link to="/account" className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  ) : (
    <Link to="/auth" className="hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  );
}