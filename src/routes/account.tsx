import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { deviceTimezone, useUserTimezone, todayLocalISO, yesterdayLocalISO } from "@/lib/timezone";
import { useBump } from "@/lib/use-bump";
import { useTheme } from "@/lib/theme";
import { useSettings } from "@/lib/settings";



export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — Trenslate" }] }),
  component: Account,
});

function Account() {
  const { user, tier, isPro, isAnnual, signOut, loading } = useAuth();
  const navigate = useNavigate();

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

  if (!user) return null;

  const tz = useUserTimezone();
  const today = todayLocalISO(tz);
  const yesterday = yesterdayLocalISO(tz);
  const lastLocal = profile?.last_active_local_date;
  const effectiveStreak = lastLocal === today || lastLocal === yesterday ? (profile?.streak_count ?? 0) : 0;
  const isActiveToday = lastLocal === today;
  const maxStreak = profile?.max_streak ?? 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Subscriber Services</div>
      <h1 className="display text-4xl font-black mb-6">Your account</h1>

      <SettingsPanel />

      <dl className="grid sm:grid-cols-2 gap-6 rule-top pt-6">
        <Stat label="Email" value={user.email ?? "—"} />
        <Stat label="Display name" value={profile?.display_name ?? "—"} />
        <Stat label="Plan" value={tier === "pro_annual" ? "Pro · Annual" : tier === "pro_monthly" ? "Pro · Monthly" : "Free"} />
        <Stat label="Daily streak" value={`${profile?.streak_count ?? 0} day(s)`} />
        <Stat label="Max streak" value={`${maxStreak} day${maxStreak === 1 ? "" : "s"}`} />
        {isAnnual && <Stat label="Badge" value="★ Founding OAT voter" />}
        {isPro && <Stat label="Vote weight" value={isAnnual ? "2× weighted" : "Standard"} />}
      </dl>

      <StreakSection streak={profile?.streak_count ?? 0} lastActive={profile?.last_active_date} />

      <MaxStreakSection maxStreak={maxStreak} currentStreak={effectiveStreak} isActiveToday={isActiveToday} />

      <StreakCalendar userId={user.id} streak={profile?.streak_count ?? 0} />

      <StreakHistory userId={user.id} />

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

function StreakSection({ streak, lastActive }: { streak: number; lastActive?: string | null }) {
  const active = streak > 0;
  const bumping = useBump(streak);
  const today = new Date().toISOString().slice(0, 10);
  const last = lastActive ? lastActive.slice(0, 10) : null;
  const status = last === today
    ? "Streak active today"
    : last
    ? `Last active ${lastActive!.slice(0, 10)}`
    : "Start your streak today";

  return (
    <div className="rule-top mt-10 pt-6">
      <div className="flex items-center gap-5 sm:gap-6">
        <div
          className={`relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 text-5xl shadow-lg transition-transform duration-300 ${
            active
              ? "border-accent-red bg-gradient-to-br from-accent-red/20 to-accent-red/5 shadow-accent-red/20"
              : "border-ink/20 bg-ink/5 grayscale"
          } ${bumping ? "scale-110" : ""}`}
          aria-hidden="true"
        >
          🔥
          {active && (
            <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent-red text-newsprint text-[10px] font-bold shadow">
              {streak}
            </span>
          )}
        </div>
        <div className="flex-1">
          <div className="ui small-caps text-xs text-muted-foreground mb-1">{status}</div>
          <div className={`display text-3xl sm:text-4xl font-black leading-tight transition-all duration-300 ${bumping ? "scale-105 text-accent-red" : ""}`}>
            {active ? `${streak} day${streak === 1 ? "" : "s"} on fire` : "No streak yet"}
          </div>

          <p className="ui text-sm sm:text-base text-muted-foreground mt-1 max-w-md">
            {active
              ? "Keep voting or searching daily to keep the flame alive. Your streak resets after a missed day."
              : "Your streak starts the first day you vote or search. Come back tomorrow and the flame keeps growing!"}
          </p>
          {!active && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <Link
                to="/recommended"
                className="ui small-caps text-xs bg-accent-red text-accent-foreground px-4 py-2 hover:opacity-90 transition-opacity"
              >
                Start streak with today's picks
              </Link>
              <span className="text-muted-foreground">or</span>
              <Link
                to="/vote"
                className="ui small-caps text-xs border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-newsprint transition-colors"
              >
                Cast a vote
              </Link>
              <Link
                to="/"
                className="ui small-caps text-xs border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-newsprint transition-colors"
              >
                Explore trends
              </Link>
            </div>
          )}
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
    <div className="rule-top mt-10 pt-6">
      <div className="ui small-caps text-xs text-muted-foreground mb-1">Record books</div>
      <h2 className="display text-2xl font-black mb-4">All-time best streak</h2>
      <div className="flex items-center gap-5 sm:gap-6">
        <div
          className={`relative flex items-center justify-center w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 text-4xl ${
            hasRecord
              ? "border-accent-red bg-gradient-to-br from-accent-red/20 to-accent-red/5"
              : "border-ink/20 bg-ink/5 grayscale"
          }`}
          aria-hidden="true"
        >
          🔥
          {hasRecord && (
            <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent-red text-newsprint text-[10px] font-bold shadow">
              {maxStreak}
            </span>
          )}
        </div>
        <div className="flex-1">
          <div className="display text-3xl sm:text-4xl font-black leading-tight">
            {hasRecord ? `${maxStreak} day${maxStreak === 1 ? "" : "s"}` : "No record yet"}
          </div>
          <p className="ui text-sm sm:text-base text-muted-foreground mt-1 max-w-md">
            {isCurrentBest
              ? "Your current streak is your all-time best. Keep it going!"
              : hasRecord
              ? "Best run before it was lost."
              : "Build a streak to see your longest run here."}
          </p>
          {hasRecord && !isActiveToday && currentStreak > 0 && (
            <p className="ui text-xs text-muted-foreground mt-1">
              Current streak: {currentStreak} day{currentStreak === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


function ChangePassword() {
  return _ChangePassword();
}

function StreakCalendar({ userId, streak }: { userId: string; streak: number }) {
  const WEEKS = 18;
  const DAYS = WEEKS * 7;
  const bumping = useBump(streak);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align grid end to the current week (Saturday on the right)
  const endOffset = 6 - today.getDay(); // days to add to reach Saturday
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + endOffset);
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - (DAYS - 1));


  const startIso = toLocalISO(gridStart);

  const { data: learnedDays } = useQuery({
    queryKey: ["learned-calendar", userId, startIso],
    queryFn: async () => {
      const startUtc = new Date(gridStart);
      startUtc.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("learned_trends")
        .select("created_at")
        .gte("created_at", startUtc.toISOString());
      const set = new Set<string>();
      const counts = new Map<string, number>();
      (data ?? []).forEach((r: { created_at: string }) => {
        const d = new Date(r.created_at);
        const key = toLocalISO(d);
        set.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      return { set, counts };
    },
  });

  const days: { date: Date; iso: string; count: number; isToday: boolean; isFuture: boolean }[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const iso = toLocalISO(d);
    days.push({
      date: d,
      iso,
      count: learnedDays?.counts.get(iso) ?? 0,
      isToday: iso === toLocalISO(today),
      isFuture: d.getTime() > today.getTime(),
    });
  }

  // Build columns (each week is a column of 7 days, Sun-Sat)
  const columns: typeof days[] = [];
  for (let w = 0; w < WEEKS; w++) {
    columns.push(days.slice(w * 7, w * 7 + 7));
  }

  const learnedCount = days.filter((d) => d.count > 0 && !d.isFuture).length;
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  columns.forEach((col, idx) => {
    const firstNonFuture = col.find((d) => !d.isFuture) ?? col[0];
    const m = firstNonFuture.date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: idx, label: firstNonFuture.date.toLocaleString(undefined, { month: "short" }) });
      lastMonth = m;
    }
  });

  return (
    <div className="rule-top mt-10 pt-6">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground">Streak progress</div>
          <h2 className="display text-2xl font-black">Last {WEEKS} weeks</h2>
        </div>
        <div className="ui small-caps text-xs text-muted-foreground">
          {learnedCount} day{learnedCount === 1 ? "" : "s"} learned · {streak} day streak
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block">
          {/* Month labels */}
          <div className="flex gap-[3px] pl-7 mb-1">
            {columns.map((_, idx) => {
              const m = monthLabels.find((x) => x.col === idx);
              return (
                <div key={idx} className="w-[14px] ui text-[10px] text-muted-foreground">
                  {m?.label ?? ""}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px]">
            {/* Day-of-week labels */}
            <div className="flex flex-col gap-[3px] pr-1 ui text-[9px] text-muted-foreground">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="w-4 h-[14px] leading-[14px] text-right">
                  {i % 2 === 1 ? d : ""}
                </div>
              ))}
            </div>
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((d) => (
                  <div
                    key={d.iso}
                    title={d.isFuture ? "" : `${d.iso} — ${d.count} learned`}
                    className={`w-[14px] h-[14px] rounded-[2px] border ${
                      d.isFuture
                        ? "border-transparent bg-transparent"
                        : d.count >= 3
                        ? "border-accent-red bg-accent-red"
                        : d.count === 2
                        ? "border-accent-red/60 bg-accent-red/60"
                        : d.count === 1
                        ? "border-accent-red/40 bg-accent-red/30"
                        : "border-ink/15 bg-ink/5"
                    } ${d.isToday ? "ring-1 ring-ink/60" : ""} ${
                      d.isToday && bumping ? "animate-pulse ring-2 ring-accent-red" : ""
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 ui text-[10px] text-muted-foreground">
            <span>Less</span>
            <span className="w-[14px] h-[14px] rounded-[2px] border border-ink/15 bg-ink/5" />
            <span className="w-[14px] h-[14px] rounded-[2px] border border-accent-red/40 bg-accent-red/30" />
            <span className="w-[14px] h-[14px] rounded-[2px] border border-accent-red/60 bg-accent-red/60" />
            <span className="w-[14px] h-[14px] rounded-[2px] border border-accent-red bg-accent-red" />
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function StreakHistory({ userId }: { userId: string }) {
  const { data: learnedDays } = useQuery({
    queryKey: ["learned-days", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("learned_trends")
        .select("created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      const grouped = new Map<string, number>();
      (data ?? []).forEach((r: { created_at: string }) => {
        const key = r.created_at.slice(0, 10);
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      });
      return Array.from(grouped.entries())
        .slice(0, 7)
        .map(([date, count]) => ({ date, count }));
    },
  });

  const { data: lastIncrease } = useQuery({
    queryKey: ["streak-history", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("streak_history")
        .select("action_date, new_streak_count")
        .eq("user_id", userId)
        .order("action_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  return (
    <div className="rule-top mt-10 pt-6">
      <div className="ui small-caps text-xs text-muted-foreground mb-1">Streak history</div>
      <h2 className="display text-2xl font-black mb-4">Recent activity</h2>
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground mb-2">Most recent learned days</div>
          {learnedDays && learnedDays.length > 0 ? (
            <ul className="space-y-1.5">
              {learnedDays.map((day) => (
                <li
                  key={day.date}
                  className="flex items-center justify-between ui text-sm border-b border-ink/10 py-1.5"
                >
                  <span>{formatDateLabel(day.date)}</span>
                  <span className="text-muted-foreground">
                    {day.count} term{day.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui text-sm text-muted-foreground">No learned days yet.</p>
          )}
        </div>
        <div>
          <div className="ui small-caps text-xs text-muted-foreground mb-2">Last streak-increasing action</div>
          {lastIncrease ? (
            <div className="p-4 rounded border border-ink/10 bg-ink/5">
              <div className="display text-xl font-black">{formatDateLabel(lastIncrease.action_date)}</div>
              <div className="ui text-sm text-muted-foreground mt-1">
                Streak reached {lastIncrease.new_streak_count} day
                {lastIncrease.new_streak_count === 1 ? "" : "s"}
              </div>
            </div>
          ) : (
            <p className="ui text-sm text-muted-foreground">No streak-increasing actions yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function _ChangePassword() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const strength = scorePassword(pw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
    if (pw !== confirm) return toast.error("Passwords do not match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password updated.");
      setPw(""); setConfirm("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rule-top mt-10 pt-6 max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between border border-ink/40 px-4 py-3 ui small-caps text-xs hover:bg-ink hover:text-newsprint transition-colors"
      >
        <span>Change password</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
      <form onSubmit={submit} className="space-y-3 mt-4">
        <div>
          <label className="ui small-caps text-xs block mb-1">New password</label>
          <input
            type="password" required minLength={8} maxLength={128}
            value={pw} onChange={(e) => setPw(e.target.value)}
            className="w-full border border-ink/40 bg-background px-3 py-2 ui focus:outline-none focus:border-accent-red"
          />
          {pw.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-sm transition-colors"
                    style={{
                      backgroundColor:
                        i < strength.score ? strength.color : "hsl(var(--ink) / 0.15)",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="ui small-caps text-[10px]" style={{ color: strength.color }}>
                  {strength.label}
                </span>
                {strength.hint && (
                  <span className="ui text-[10px] text-muted-foreground">{strength.hint}</span>
                )}
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="ui small-caps text-xs block mb-1">Confirm new password</label>
          <input
            type="password" required minLength={8} maxLength={128}
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full border border-ink/40 bg-background px-3 py-2 ui focus:outline-none focus:border-accent-red"
          />
        </div>
        <button
          disabled={busy}
          className="ui small-caps text-xs bg-ink text-newsprint px-4 py-2 hover:bg-accent-red transition-colors disabled:opacity-50"
        >
          {busy ? "Updating..." : "Update password"}
        </button>
      </form>
      )}
    </div>
  );
}

function scorePassword(pw: string): { score: number; label: string; color: string; hint: string } {
  if (!pw) return { score: 0, label: "", color: "", hint: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1);

  const missing: string[] = [];
  if (pw.length < 12) missing.push("12+ chars");
  if (!(/[A-Z]/.test(pw) && /[a-z]/.test(pw))) missing.push("mixed case");
  if (!/\d/.test(pw)) missing.push("number");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("symbol");

  const tiers = [
    { label: "Too weak", color: "hsl(0 70% 45%)" },
    { label: "Weak", color: "hsl(15 80% 50%)" },
    { label: "Fair", color: "hsl(40 85% 45%)" },
    { label: "Good", color: "hsl(90 50% 40%)" },
    { label: "Strong", color: "hsl(140 55% 35%)" },
  ];
  const tier = tiers[score];
  return {
    score,
    label: tier.label,
    color: tier.color,
    hint: score >= 4 ? "" : `Add ${missing.slice(0, 2).join(", ")}`,
  };
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
    <div className="rule-top mt-10 pt-6">
      <div className="ui small-caps text-xs text-muted-foreground mb-1">Streak timezone</div>
      <h2 className="display text-2xl font-black mb-2">Daily reset timezone</h2>
      <p className="ui text-sm text-muted-foreground mb-4 max-w-xl">
        Your streak rolls over at midnight in this timezone, no matter which device you're on. Defaults to this device's timezone.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <select
          aria-label="Streak timezone"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="ui text-sm border border-ink/40 bg-background px-3 py-2 max-w-sm w-full"
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
          className="ui small-caps text-xs bg-accent-red text-accent-foreground px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save timezone"}
        </button>
        {value !== device && (
          <button
            type="button"
            onClick={() => { setValue(device); save(device); }}
            className="ui small-caps text-xs border border-ink/40 px-3 py-1.5 hover:bg-ink hover:text-newsprint transition-colors"
          >
            Use this device ({device})
          </button>
        )}
      </div>
      <div className="ui text-xs text-muted-foreground mt-2">
        Current time in <span className="font-semibold">{value.replace(/_/g, " ")}</span>: {nowInZone}
      </div>
    </div>
  );
}

function SettingsPanel() {
  const { theme, setTheme } = useTheme();
  const {
    reducedMotion, setReducedMotion,
    tickerSpeed, setTickerSpeed,
    streakAnimations, setStreakAnimations,
    motionReduced,
  } = useSettings();

  return (
    <section
      aria-label="Preferences"
      className="rule-top pt-6 mb-6 grid gap-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground">Appearance</div>
          <div className="display text-lg font-bold">Theme</div>
        </div>
        <div className="inline-flex border border-ink/40 ui small-caps text-xs overflow-hidden">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              className={`px-3 py-1.5 transition-colors ${
                theme === t ? "bg-ink text-newsprint" : "hover:bg-ink/10"
              }`}
            >
              {t === "light" ? "Morning" : "After hours"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground">Top ticker</div>
          <div className="display text-lg font-bold">Scroll speed</div>
          <div className="ui text-xs text-muted-foreground">
            {tickerSpeed === 0 ? "Paused" : `${tickerSpeed.toFixed(2)}× default`}
          </div>
        </div>
        <div className="flex items-center gap-3 min-w-[240px]">
          <input
            type="range"
            min={0}
            max={2}
            step={0.25}
            value={tickerSpeed}
            onChange={(e) => setTickerSpeed(Number(e.target.value))}
            aria-label="Ticker scroll speed"
            className="flex-1 accent-accent-red"
          />
          <button
            type="button"
            onClick={() => setTickerSpeed(1)}
            className="ui small-caps text-xs border border-ink/40 px-2 py-1 hover:bg-ink hover:text-newsprint"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground">Accessibility</div>
          <div className="display text-lg font-bold">Reduced motion</div>
          <div className="ui text-xs text-muted-foreground">
            Minimizes pulse, confetti, and banner fades.
            {motionReduced ? " Currently active." : ""}
          </div>
        </div>
        <div className="inline-flex border border-ink/40 ui small-caps text-xs overflow-hidden">
          {(["auto", "on", "off"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setReducedMotion(m)}
              aria-pressed={reducedMotion === m}
              className={`px-3 py-1.5 transition-colors ${
                reducedMotion === m ? "bg-ink text-newsprint" : "hover:bg-ink/10"
              }`}
            >
              {m === "auto" ? "System" : m === "on" ? "On" : "Off"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="ui small-caps text-xs text-muted-foreground">Streaks</div>
          <div className="display text-lg font-bold">Streak animations</div>
          <div className="ui text-xs text-muted-foreground">
            Confetti and flame pulses when your streak grows.
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <span className="ui small-caps text-xs">{streakAnimations ? "On" : "Off"}</span>
          <input
            type="checkbox"
            checked={streakAnimations}
            onChange={(e) => setStreakAnimations(e.target.checked)}
            className="h-4 w-4 accent-accent-red"
            aria-label="Streak animations"
          />
        </label>
      </div>
    </section>
  );
}