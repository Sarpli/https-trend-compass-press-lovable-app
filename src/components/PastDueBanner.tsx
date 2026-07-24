import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { createPortalSession } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export function PastDueBanner() {
  const { isPastDue } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!isPastDue) return null;

  const openPortal = async () => {
    setLoading(true);
    try {
      const result = await createPortalSession({
        data: {
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/account`,
        },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open billing portal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-amber-100 border-b border-amber-300 px-4 py-2.5 text-sm text-amber-900 flex flex-wrap items-center justify-center gap-3">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>
        <strong className="font-semibold">Payment issue.</strong> Your last renewal didn't
        go through. You still have Pro access while we retry — please update your card.
      </span>
      <button
        onClick={openPortal}
        disabled={loading}
        className="ui small-caps text-xs underline underline-offset-2 hover:no-underline disabled:opacity-50"
      >
        {loading ? "Opening…" : "Update card"}
      </button>
    </div>
  );
}