import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-1">Subscriber Services</div>
      <h1 className="display text-4xl font-black mb-6">Your account</h1>

      <dl className="grid sm:grid-cols-2 gap-6 rule-top pt-6">
        <Stat label="Email" value={user.email ?? "—"} />
        <Stat label="Display name" value={profile?.display_name ?? "—"} />
        <Stat label="Plan" value={tier === "pro_annual" ? "Pro · Annual" : tier === "pro_monthly" ? "Pro · Monthly" : "Free"} />
        <Stat label="Daily streak" value={`${profile?.streak_count ?? 0} day(s)`} />
        {isAnnual && <Stat label="Badge" value="★ Founding OAT voter" />}
        {isPro && <Stat label="Vote weight" value={isAnnual ? "2× weighted" : "Standard"} />}
      </dl>

      <StreakSection streak={profile?.streak_count ?? 0} lastActive={profile?.last_active_date} />

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
  const today = new Date().toISOString().slice(0, 10);
  const last = lastActive ? lastActive.slice(0, 10) : null;
  const status = last === today
    ? "Streak active today"
    : last
    ? `Last active ${lastActive!.slice(0, 10)}`
    : "Start your streak today";

  return (
    <div className="rule-top mt-10 pt-6">
      <div className="flex items-start sm:items-center gap-4">
        <div
          className={`flex items-center justify-center w-16 h-16 rounded-full border-2 text-3xl ${
            active ? "border-accent-red bg-accent-red/10" : "border-ink/20 bg-ink/5 grayscale"
          }`}
          aria-hidden="true"
        >
          🔥
        </div>
        <div className="flex-1">
          <div className="ui small-caps text-xs text-muted-foreground mb-1">{status}</div>
          <div className="display text-2xl font-black">
            {streak} day{streak === 1 ? "" : "s"} on fire
          </div>
          <p className="ui text-sm text-muted-foreground mt-1 max-w-md">
            {active
              ? "Keep voting or searching daily to keep the flame alive. Your streak resets after a missed day."
              : "Search or vote on any trend to ignite your first-day streak."}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChangePassword() {
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