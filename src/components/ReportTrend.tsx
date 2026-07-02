import { useState } from "react";
import { toast } from "sonner";
import { Flag, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";

type Reason = "offensive" | "inaccurate" | "hate_speech" | "harassment" | "spam" | "other";

const REASONS: { value: Reason; label: string }[] = [
  { value: "offensive", label: "Offensive or objectionable" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inaccurate", label: "Inaccurate or misleading" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

/**
 * Lets any signed-in user report a trend entry. Required by App Store
 * guideline 1.2 for apps with user-generated content: users must have a
 * mechanism to flag objectionable content.
 */
export function ReportTrend({ trendId }: { trendId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("offensive");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("trend_reports").insert({
        trend_id: trendId,
        reporter_id: user.id,
        reason,
        details: details.trim() || null,
      });
      if (error) throw error;
      toast.success("Report received. Our editors review flags within 24 hours.");
      setOpen(false);
      setDetails("");
    } catch (err) {
      toast.error((err as Error).message ?? "Could not send report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 ui small-caps text-[11px] text-muted-foreground hover:text-accent-red transition-colors"
        aria-label="Report this trend"
      >
        <Flag className="w-3 h-3" />
        Report this entry
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass w-full md:max-w-md bg-background border border-ink/20 rounded-t-2xl md:rounded-lg shadow-2xl p-6 relative"
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 p-1.5 rounded hover:bg-foreground/10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="text-[10px] ui small-caps text-accent-red mb-1 tracking-widest">
              Editors' desk
            </div>
            <h2 className="display text-2xl font-black mb-1">Report this entry</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Flag content that is offensive, hateful, or violates our{" "}
              <Link to="/terms" className="underline">community guidelines</Link>.
              Reviewed within 24 hours.
            </p>

            {!user ? (
              <div className="space-y-3">
                <p className="text-sm">You need to be signed in to file a report.</p>
                <Link
                  to="/auth"
                  className="inline-block ui small-caps text-xs bg-ink text-newsprint px-4 py-2 rounded hover:bg-accent-red transition-colors"
                >
                  Sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-2">
                  {REASONS.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                  placeholder="Additional context (optional)"
                  rows={3}
                  className="w-full border border-ink/40 bg-background px-3 py-2 text-sm rounded focus:outline-none focus:border-accent-red"
                />
                <button
                  disabled={busy}
                  className="w-full bg-accent-red text-accent-foreground py-2.5 ui small-caps text-xs tracking-wider hover:bg-accent-red/85 disabled:opacity-50 rounded"
                >
                  {busy ? "Sending…" : "Submit report"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}