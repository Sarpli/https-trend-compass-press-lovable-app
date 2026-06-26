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

function ChangePassword() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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