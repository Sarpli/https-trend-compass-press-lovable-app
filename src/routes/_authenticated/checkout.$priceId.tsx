import { createFileRoute, Link } from '@tanstack/react-router';
import { StripeEmbeddedCheckout } from '@/components/StripeEmbeddedCheckout';
import { PaymentTestModeBanner } from '@/components/PaymentTestModeBanner';

export const Route = createFileRoute('/_authenticated/checkout/$priceId')({
  head: () => ({
    meta: [
      { title: 'Checkout — Trendslated' },
      { name: 'description', content: 'Complete your Trendslated Pro subscription.' },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { priceId } = Route.useParams();
  const plan = priceId === 'pro_annual' ? 'Pro Annual' : 'Pro Monthly';

  return (
    <>
      <PaymentTestModeBanner />
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-6">
          <Link to="/pricing" className="ui small-caps text-xs text-muted-foreground hover:text-accent-red">
            ← Back to plans
          </Link>
        </div>
        <div className="text-xs ui small-caps text-accent-red mb-2">Secure checkout</div>
        <h1 className="display text-4xl font-black mb-6">{plan}</h1>
        <div className="border border-ink/30 bg-card p-4">
          <StripeEmbeddedCheckout priceId={priceId} />
        </div>
      </div>
    </>
  );
}