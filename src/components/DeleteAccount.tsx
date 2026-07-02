import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { deleteMyAccount } from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";

/**
 * In-app account deletion. Required by App Store guideline 5.1.1(v).
 * Two-step confirm to prevent accidental taps.
 */
export function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const run = useServerFn(deleteMyAccount);

  const onDelete = async () => {
    if (phrase.trim().toLowerCase() !== "delete") {
      toast.error('Type "delete" to confirm.');
      return;
    }
    setBusy(true);
    try {
      await run();
      await supabase.auth.signOut();
      toast.success("Account deleted.");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error((err as Error).message ?? "Could not delete account.");
      setBusy(false);
    }
  };

  return (
    <div className="rule-top mt-10 pt-6">
      <div className="ui small-caps text-xs text-accent-red mb-2">Danger zone</div>
      <h2 className="display text-xl font-black mb-2">Delete your account</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Permanently removes your profile, votes, searches, streaks, and sign-in credentials.
        This cannot be undone.
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="ui small-caps text-xs border border-accent-red text-accent-red px-4 py-2 hover:bg-accent-red hover:text-accent-foreground transition-colors"
        >
          Delete account
        </button>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            Type <span className="font-mono font-bold">delete</span> to confirm:
            <input
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              className="mt-1 w-full border border-ink/40 bg-background px-3 py-2 text-sm ui rounded focus:outline-none focus:border-accent-red"
              placeholder="delete"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              disabled={busy}
              className="ui small-caps text-xs bg-accent-red text-accent-foreground px-4 py-2 hover:bg-accent-red/85 transition-colors disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              onClick={() => { setConfirming(false); setPhrase(""); }}
              disabled={busy}
              className="ui small-caps text-xs border border-ink/40 px-4 py-2 hover:bg-ink hover:text-newsprint transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}