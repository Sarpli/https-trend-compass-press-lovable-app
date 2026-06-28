import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { todayLocalISO, yesterdayLocalISO } from "@/lib/timezone";
import { useBump } from "@/lib/use-bump";
import { ChangePassword } from "@/components/ChangePassword";



export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — Trenslate" }] }),
  component: Account,
});

function Account() {
  const { user, tier, isPro, isAnnual, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();


  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const { data: searchCount = 0 } = useQuery({
    queryKey: ["searches", user?.id],
    enabled: !!user && !isPro,
    queryFn: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("searches")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .gte("created_at", since.toISOString());
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!user || isPro) return;
    const channel = supabase
      .channel("account-searches")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "searches", filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["searches", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isPro, qc]);

  if (!user) return null;

  const today = todayLocalISO();
  const yesterday = yesterdayLocalISO();
  const lastLocal = profile?.last_active_local_date;
  const effectiveStreak = lastLocal === today || lastLocal === yesterday ? (profile?.streak_count ?? 0) : 0;
  const isActiveToday = lastLocal === today;
  const maxStreak = profile?.max_streak ?? 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Subscriber Services</div>
      <h1 className="display text-4xl font-black mb-6">Your account</h1>

      <Link
        to="/settings"
        className="block w-full border border-ink/40 px-4 py-3 ui small-caps text-xs hover:bg-ink hover:text-newsprint transition-colors mb-6"
      >
        Settings →
      </Link>

      <dl className="grid sm:grid-cols-2 gap-6 rule-top pt-6">
        <Stat label="Email" value={user.email ?? "—"} />
        <Stat label="Display name" value={profile?.display_name ?? "—"} />
        <Stat label="Plan" value={tier === "pro_annual" ? "Pro · Annual" : tier === "pro_monthly" ? "Pro · Monthly" : "Free"} />
        {!isPro && <Stat label="Searches today" value={`${searchCount} of 3 used`} />}
        <Stat label="Daily streak" value={`${profile?.streak_count ?? 0} day(s)`} />
        <Stat label="Max streak" value={`${maxStreak} day${maxStreak === 1 ? "" : "s"}`} />
        {isAnnual && <Stat label="Badge" value="★ Founding OAT voter" />}
        {isPro && <Stat label="Vote weight" value={isAnnual ? "2× weighted" : "Standard"} />}
      </dl>

      <StreakSection
        streak={profile?.streak_count ?? 0}
        lastActive={profile?.last_active_date}
        completedToday={isActiveToday}
      />

      <MaxStreakSection maxStreak={maxStreak} currentStreak={effectiveStreak} isActiveToday={isActiveToday} />

      <TimezoneSelector userId={user.id} currentTz={profile?.timezone ?? null} />


      <div className="rule-top mt-10 pt-6 flex gap-3">
        {!isPro && (
          <Link to="/pricing" className="ui small-caps text-xs bg-accent-red text-accent-foreground px-4 py-2">
            Upgrade to Pro
          </Link>
        )}
        {isAdmin && (
          <Link to="/admin/trends" className="ui small-caps text-xs border border-ink/40 px-4 py-2 hover:bg-ink hover:text-newsprint">
            Editor's desk
          </Link>
        )}
        <button onClick={() => { signOut(); navigate({ to: "/" }); }} className="ui small-caps text-xs border border-ink/40 px-4 py-2 hover:bg-ink hover:text-newsprint">
          Sign out
        </button>
      </div>

      <ChangePassword />
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="ui small-caps text-xs text-muted-foreground">{label}</dt>
      <dd className="display text-xl font-bold">{value}</dd>
    </div>
  );
}

function StreakSection({ streak, lastActive, completedToday = false }: { streak: number; lastActive?: string | null; completedToday?: boolean }) {
  const active = streak > 0;
  const bumping = useBump(streak, { bumpOnInitial: completedToday });
  const today = new Date().toISOString().slice(0, 10);
  const last = lastActive ? lastActive.slice(0, 10) : null;
  const status = last === today
    ? "Streak active today"
    : last
    ? `Last active ${lastActive!.slice(0, 10)}`
    : "Start your streak today";

  return (
    <div className="rule-top mt-6 pt-4">
      <div className="flex items-center gap-4">
        <div
          className={`relative flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 text-2xl shadow transition-transform duration-300 ${
            active
              ? "border-accent-red bg-gradient-to-br from-accent-red/20 to-accent-red/5 shadow-accent-red/20"
              : "border-ink/20 bg-ink/5 grayscale"
          } ${bumping ? "scale-110" : ""}`}
          aria-hidden="true"
        >
          🔥
          {active && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-red text-newsprint text-[9px] font-bold shadow">
              {streak}
            </span>
          )}
        </div>
        <div className="flex-1">
          <div className="ui small-caps text-[10px] text-muted-foreground">{status}</div>
          <div className={`display text-xl sm:text-2xl font-black leading-tight transition-all duration-300 ${bumping ? "scale-105 text-accent-red" : ""}`}>
            {active ? `${streak} day${streak === 1 ? "" : "s"}` : "No streak"}
          </div>
          <p className="ui text-xs text-muted-foreground mt-0.5 max-w-md">
            Vote or search once a day to keep it. Miss a day and it resets.
          </p>
        </div>
      </div>
    </div>
  );
}

function MaxStreakSection({
  maxStreak,
  currentStreak,
  isActiveToday,
}: {
  maxStreak: number;
  currentStreak: number;
  isActiveToday: boolean;
}) {
  const hasRecord = maxStreak > 0;
  const isCurrentBest = hasRecord && currentStreak === maxStreak && currentStreak > 0;

  return (
    <div className="rule-top mt-6 pt-4">
      <div className="flex items-center gap-4">
        <div
          className={`relative flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 text-2xl ${
            hasRecord
              ? "border-accent-red bg-gradient-to-br from-accent-red/20 to-accent-red/5"
              : "border-ink/20 bg-ink/5 grayscale"
          }`}
          aria-hidden="true"
        >
          🔥
          {hasRecord && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-red text-newsprint text-[9px] font-bold shadow">
              {maxStreak}
            </span>
          )}
        </div>
        <div className="flex-1">
          <div className="ui small-caps text-[10px] text-muted-foreground">All-time best</div>
          <div className="display text-xl sm:text-2xl font-black leading-tight">
            {hasRecord ? `${maxStreak} day${maxStreak === 1 ? "" : "s"}` : "No record"}
          </div>
          <p className="ui text-xs text-muted-foreground mt-0.5 max-w-md">
            {isCurrentBest
              ? "Your current streak is your best."
              : hasRecord
              ? "Best run before it was lost."
              : "Build a streak to see your longest run."}
          </p>
          {hasRecord && !isActiveToday && currentStreak > 0 && (
            <p className="ui text-[10px] text-muted-foreground mt-0.5">
              Current: {currentStreak} day{currentStreak === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}





function TimezoneSelector({ userId, currentTz }: { userId: string; currentTz: string | null }) {
  const qc = useQueryClient();
  const device = deviceTimezone();
  const effective = currentTz || device;
  const [value, setValue] = useState(effective);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(effective); }, [effective]);

  const zones: string[] = (() => {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    if (typeof anyIntl.supportedValuesOf === "function") {
      try { return anyIntl.supportedValuesOf("timeZone"); } catch { /* noop */ }
    }
    return [
      "UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
      "America/Anchorage","America/Phoenix","America/Toronto","America/Mexico_City",
      "America/Sao_Paulo","Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid",
      "Europe/Rome","Europe/Moscow","Africa/Cairo","Africa/Johannesburg",
      "Asia/Dubai","Asia/Karachi","Asia/Kolkata","Asia/Bangkok","Asia/Singapore",
      "Asia/Hong_Kong","Asia/Shanghai","Asia/Tokyo","Asia/Seoul",
      "Australia/Perth","Australia/Sydney","Pacific/Auckland",
    ];
  })();

  const save = async (next: string) => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ timezone: next }).eq("id", userId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Timezone updated — streak will reset at midnight local time.");
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["profile-timezone"] });
    qc.invalidateQueries({ queryKey: ["effective-streak"] });
    qc.invalidateQueries({ queryKey: ["marked-today"] });
  };

  const nowInZone = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: value, hour: "2-digit", minute: "2-digit", weekday: "short", month: "short", day: "numeric",
      }).format(new Date());
    } catch { return "—"; }
  })();

  return (
    <div className="rule-top mt-6 pt-4">
      <div className="ui small-caps text-[10px] text-muted-foreground mb-1">Streak timezone</div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          aria-label="Streak timezone"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="ui text-xs border border-ink/40 bg-background px-3 py-2 max-w-sm w-full"
        >
          {!zones.includes(value) && <option value={value}>{value}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={saving || value === effective}
          onClick={() => save(value)}
          className="ui small-caps text-xs bg-ink text-newsprint px-3 py-2 disabled:opacity-50 hover:bg-accent-red transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {value !== device && (
          <button
            type="button"
            onClick={() => { setValue(device); save(device); }}
            className="ui small-caps text-[10px] border border-ink/40 px-2 py-1 hover:bg-ink hover:text-newsprint transition-colors"
          >
            Use this device ({device})
          </button>
        )}
      </div>
      <div className="ui text-[10px] text-muted-foreground mt-1">
        Reset at midnight · <span className="font-semibold">{value.replace(/_/g, " ")}</span>: {nowInZone}
      </div>
    </div>
  );
}
