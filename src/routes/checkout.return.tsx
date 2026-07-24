import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';

export const Route = createFileRoute('/checkout/return')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === 'string' ? search.session_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: 'Payment complete — Trendslated' },
      { name: 'description', content: 'Your Trendslated Pro subscription is active.' },
    ],
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id: sessionId } = Route.useSearch();
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      {sessionId ? (
        <>
          <CheckCircle2 className="w-16 h-16 text-accent-red mx-auto mb-4" />
          <div className="ui small-caps text-xs text-accent-red mb-2">Subscription confirmed</div>
          <h1 className="display text-4xl font-black mb-3">Welcome to Pro.</h1>
          <p className="text-muted-foreground mb-8">
            Your subscription is now active. It may take a moment for Pro features to unlock across the app.
          </p>
          <div className="flex gap-3 justify-center">
            <Link to="/" className="ui small-caps text-xs py-3 px-6 bg-accent-red text-accent-foreground hover:bg-ink transition-colors">
              Start reading
            </Link>
            <Link to="/account" className="ui small-caps text-xs py-3 px-6 border border-ink/40 hover:bg-ink/5 transition-colors">
              View account
            </Link>
          </div>
        </>
      ) : (
        <>
          <h1 className="display text-3xl font-black mb-3">No session information found.</h1>
          <Link to="/pricing" className="underline">Return to plans</Link>
        </>
      )}
    </div>
  );
}