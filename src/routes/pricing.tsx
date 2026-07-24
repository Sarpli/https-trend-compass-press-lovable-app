import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Star } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Subscribe — Trendslated" },
      { name: "description", content: "Trendslated Pro: unlimited search, full voting, personal glossary, early access." },
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

type PlanId = "pro_monthly" | "pro_annual";

const PLAN_DETAILS: Record<PlanId, {
  name: string;
  price: string;
  cadence: string;
  perDay: string;
  renewalCopy: string;
}> = {
  pro_monthly: {
    name: "Pro Monthly",
    price: "$4.99 USD",
    cadence: "billed monthly",
    perDay: "≈ $0.16 / day",
    renewalCopy: "Renews automatically every month at $4.99 USD until canceled.",
  },
  pro_annual: {
    name: "Pro Annual",
    price: "$39.99 USD",
    cadence: "billed once per year",
    perDay: "≈ $0.11 / day · save 33% vs. monthly",
    renewalCopy: "Renews automatically every 12 months at $39.99 USD until canceled.",
  },
};

function Pricing() {
  const { user, isPro, tier } = useAuth();
  const navigate = useNavigate();
  const [confirmPlan, setConfirmPlan] = useState<PlanId | null>(null);

  const handleSubscribe = (planId: PlanId) => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    // Show the price disclosure modal before starting any checkout.
    setConfirmPlan(planId);
  };

  const proceedToCheckout = (_planId: PlanId) => {
    // Paid subscriptions are temporarily unavailable — checkout will be
    // wired up when the payment provider is enabled. The disclosure step
    // above is the mandatory pre-checkout screen once it is.
    setConfirmPlan(null);
  };

  return (
    <>
      <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-12">
        <div className="text-xs ui small-caps text-accent-red mb-2">Subscriber Services</div>
        <h1 className="display text-5xl md:text-6xl font-black mb-3">Subscribe to Trendslated.</h1>
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
      {confirmPlan && (
        <PriceDisclosureModal
          plan={PLAN_DETAILS[confirmPlan]}
          onCancel={() => setConfirmPlan(null)}
          onConfirm={() => proceedToCheckout(confirmPlan)}
        />
      )}
    </>
  );
}

function PriceDisclosureModal({
  plan,
  onCancel,
  onConfirm,
}: {
  plan: (typeof PLAN_DETAILS)[PlanId];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-disclosure-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-ink/30 max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui small-caps text-[10px] text-accent-red mb-2">
          Order Confirmation
        </div>
        <h2 id="price-disclosure-title" className="display text-2xl font-bold mb-1">
          Confirm your subscription
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Please review before continuing to checkout.
        </p>

        <dl className="border border-ink/20 divide-y divide-ink/15 mb-4 text-sm">
          <div className="flex justify-between p-3">
            <dt className="ui small-caps text-[11px] text-muted-foreground">Plan</dt>
            <dd className="font-medium">{plan.name}</dd>
          </div>
          <div className="flex justify-between p-3">
            <dt className="ui small-caps text-[11px] text-muted-foreground">Amount due today</dt>
            <dd className="font-medium">{plan.price}</dd>
          </div>
          <div className="flex justify-between p-3">
            <dt className="ui small-caps text-[11px] text-muted-foreground">Billing</dt>
            <dd className="text-right">{plan.cadence}</dd>
          </div>
          <div className="flex justify-between p-3">
            <dt className="ui small-caps text-[11px] text-muted-foreground">Effective rate</dt>
            <dd className="text-right text-muted-foreground">{plan.perDay}</dd>
          </div>
        </dl>

        <ul className="text-xs text-muted-foreground space-y-1.5 mb-6 leading-relaxed">
          <li>• {plan.renewalCopy}</li>
          <li>
            • Applicable sales tax or VAT may be added at checkout based on your billing
            location.
          </li>
          <li>
            • Cancel anytime from your{" "}
            <Link to="/account" className="underline">account page</Link>. You keep Pro
            access through the end of the paid period.
          </li>
          <li>
            • By continuing, you agree to the{" "}
            <Link to="/terms" className="underline">Terms</Link> and acknowledge the{" "}
            <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </li>
        </ul>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 ui small-caps text-xs py-3 border border-ink/40 hover:bg-ink/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 ui small-caps text-xs py-3 bg-accent-red text-accent-foreground hover:bg-ink transition-colors"
          >
            Agree & continue
          </button>
        </div>
      </div>
    </div>
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