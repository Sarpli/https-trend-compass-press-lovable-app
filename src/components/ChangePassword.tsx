import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function ChangePassword() {
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
      setPw("");
      setConfirm("");
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
              type="password"
              required
              minLength={8}
              maxLength={128}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
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
              type="password"
              required
              minLength={8}
              maxLength={128}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
