import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/return")({
  head: () => ({
    meta: [{ title: "Payment complete — Trenslate" }],
  }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 text-center">
      <div className="text-xs ui small-caps text-accent-red mb-2">Subscriber Services</div>
      <h1 className="display text-4xl md:text-5xl font-black mb-4">
        {session_id ? "Welcome to Pro." : "No session found."}
      </h1>
      <p className="text-muted-foreground mb-8">
        {session_id
          ? "Your subscription is being provisioned. It may take a few seconds to appear on your account."
          : "We couldn't locate your checkout session."}
      </p>
      <div className="flex gap-3 justify-center">
        <Link to="/account" className="ui small-caps text-xs py-3 px-6 bg-ink text-newsprint hover:bg-accent-red">
          Go to my account
        </Link>
        <Link to="/" className="ui small-caps text-xs py-3 px-6 border border-ink/30">
          Back to the front page
        </Link>
      </div>
    </div>
  );
}