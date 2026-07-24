import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { type StripeEnv, verifyWebhook } from '@/lib/stripe.server';

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function tierFromPriceId(priceId: string | null | undefined): 'pro_monthly' | 'pro_annual' | 'free' {
  if (priceId === 'pro_monthly') return 'pro_monthly';
  if (priceId === 'pro_annual') return 'pro_annual';
  return 'free';
}

function resolvePriceId(item: any): string | null {
  return (
    item?.price?.lookup_key ||
    item?.price?.metadata?.lovable_external_id ||
    item?.price?.id ||
    null
  );
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error('No userId in subscription metadata');
    return;
  }
  const item = subscription.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  const nowSec = Math.floor(Date.now() / 1000);
  // Grant Pro during active/trialing/past_due, and until period end after cancellation.
  const grantPro =
    ['active', 'trialing', 'past_due'].includes(subscription.status) ||
    (subscription.status === 'canceled' && periodEnd && periodEnd > nowSec);
  const tier = grantPro ? tierFromPriceId(priceId) : 'free';

  // Mark the moment this user's subscription first becomes Pro-active,
  // so the client can show a one-time welcome toast on the next visit.
  // Only set on transitions into an active/trialing state.
  const shouldMarkWelcome =
    subscription.status === 'active' || subscription.status === 'trialing';
  const existing = await getSupabase()
    .from('subscriptions')
    .select('pro_welcomed_at')
    .eq('user_id', userId)
    .maybeSingle();
  const proWelcomedAt = shouldMarkWelcome && !existing.data?.pro_welcomed_at
    ? new Date().toISOString()
    : existing.data?.pro_welcomed_at ?? null;

  await getSupabase().from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      price_id: priceId,
      tier,
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      environment: env,
      pro_welcomed_at: proWelcomedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  await getSupabase()
    .from('subscriptions')
    .update({
      status: 'canceled',
      tier: 'free',
      cancel_at_period_end: false,
      environment: env,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertSubscription(event.data.object, env);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    default:
      console.log('Unhandled event:', event.type);
  }
}

export const Route = createFileRoute('/api/public/payments/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get('env');
        if (rawEnv !== 'sandbox' && rawEnv !== 'live') {
          console.error('Webhook received with invalid env:', rawEnv);
          return Response.json({ received: true, ignored: 'invalid env' });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error('Webhook error:', e);
          return new Response('Webhook error', { status: 400 });
        }
      },
    },
  },
});