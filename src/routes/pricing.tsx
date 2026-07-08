import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Star, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { isPaymentsConfigured } from "@/lib/stripe";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Subscribe — Trenslate" },
      { name: "description", content: "Trenslate Pro: unlimited search, full voting, personal glossary, early access." },
    ],
  }),
  component: Pricing,
});

const FREE = [
  "3 trend searches per day",
  "Read Trend of the Month",
  "Daily streak tracking",
  "Vote on Weekly + Monthly trends",
];

const PRO = [
  "Unlimited trend searches",
  "Vote on Year + All-Time trends",
  "Full trend archive",
  "Personal saved glossary",
  "Push notifications",
  "Early access to new trends",
];

const ANNUAL_BONUS = [
  "Founding OAT-voter badge",
  "Weighted vote (counts 2×)",
  "Priority trend submissions",
  "Weekly edition 24 hrs early",
  "Personalized year-in-trends recap",
];

function Pricing() {
  const { user, isPro, tier } = useAuth();
  const navigate = useNavigate();
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();

  const handleSubscribe = (priceId: "pro_monthly" | "pro_annual") => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isPaymentsConfigured()) return;
    openCheckout({ priceId });
  };

  return (
    <>
      <PaymentTestModeBanner />
      <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-12">
        <div className="text-xs ui small-caps text-accent-red mb-2">Subscriber Services</div>
        <h1 className="display text-5xl md:text-6xl font-black mb-3">Subscribe to Trenslate.</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Choose the edition that fits how you read culture.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Tier
          name="Free" price="$0" period="forever" features={FREE}
          cta={user ? "Current plan" : "Sign up"}
          onCta={() => { if (!user) navigate({ to: "/auth" }); }}
          disabled={!!user && tier === "free"}
        />
        <Tier
          name="Pro Monthly" price="$4.99" period="per month" features={PRO}
          cta={tier === "pro_monthly" ? "Current plan" : "Subscribe"}
          onCta={() => handleSubscribe("pro_monthly")}
          disabled={tier === "pro_monthly"}
          highlight
        />
        <Tier
          name="Pro Annual" price="$39.99" period="per year"
          features={[...PRO, "—", ...ANNUAL_BONUS]}
          cta={tier === "pro_annual" ? "Current plan" : "Subscribe annually"}
          onCta={() => handleSubscribe("pro_annual")}
          disabled={tier === "pro_annual"}
          badge="Founding voter"
        />
      </div>

      {isPro && (
        <p className="text-center mt-10 text-xs text-muted-foreground ui">
          You're already a Pro subscriber. Manage your subscription from your{" "}
          <Link to="/account" className="underline">account page</Link>.
        </p>
      )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-newsprint w-full max-w-2xl mt-8 relative border border-ink/40">
            <button
              onClick={closeCheckout}
              className="absolute top-2 right-2 z-10 p-2 hover:bg-ink/10"
              aria-label="Close checkout"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-2">{checkoutElement}</div>
          </div>
        </div>
      )}
    </>
  );
}

function Tier({ name, price, period, features, cta, onCta, disabled, highlight, badge }: {
  name: string; price: string; period: string; features: string[]; cta: string;
  onCta?: () => void; disabled?: boolean; highlight?: boolean; badge?: string;
}) {
  return (
    <div className={`border ${highlight ? "border-accent-red border-2" : "border-ink/30"} p-6 bg-card`}>
      {badge && (
        <div className="ui small-caps text-[10px] inline-flex items-center gap-1 bg-ink text-newsprint px-2 py-1 mb-3">
          <Star className="w-3 h-3" /> {badge}
        </div>
      )}
      <h2 className="display text-2xl font-bold">{name}</h2>
      <div className="my-3">
        <span className="display text-4xl font-black">{price}</span>
        <span className="ui text-sm text-muted-foreground ml-1">/ {period}</span>
      </div>
      <ul className="space-y-2 text-sm">
        {features.map((f) => (
          f === "—"
            ? <li key={f} className="rule-top pt-2 ui small-caps text-[10px] text-accent-red">Annual perks</li>
            : (
              <li key={f} className="flex gap-2">
                <Check className="w-4 h-4 text-accent-red mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            )
        ))}
      </ul>
      <button
        onClick={onCta}
        disabled={disabled}
        className={`mt-6 block w-full text-center ui small-caps text-xs py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          highlight ? "bg-accent-red text-accent-foreground hover:bg-ink" : "bg-ink text-newsprint hover:bg-accent-red"
        }`}
      >
        {cta}
      </button>
    </div>
  );
}