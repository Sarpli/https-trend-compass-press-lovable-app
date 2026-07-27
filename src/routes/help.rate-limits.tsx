import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/help/rate-limits")({
  head: () => ({
    meta: [
      { title: "Rate limits — Trendslated" },
      {
        name: "description",
        content:
          "Why Trendslated shows 'Too many requests' messages, how the countdown works, and what to do next.",
      },
      { property: "og:title", content: "Rate limits — Trendslated" },
      {
        property: "og:description",
        content:
          "Why Trendslated shows 'Too many requests' messages, how the countdown works, and what to do next.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RateLimitsHelp,
});

function RateLimitsHelp() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 prose prose-neutral">
      <p className="ui small-caps text-[10px] text-accent-red tracking-widest mb-2">
        Help · Rate limits
      </p>
      <h1 className="display text-3xl md:text-4xl font-black leading-tight mb-4">
        Why you're seeing "Too many requests"
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Trendslated caps how fast a single visitor can hit sensitive endpoints
        (sign in, sign up, password reset, AI search, admin actions). This
        keeps the newsroom fast for everyone and blocks credential-stuffing
        and scraping.
      </p>

      <h2 className="display text-xl font-black mt-6 mb-2">The countdown</h2>
      <p className="text-sm mb-4">
        Every 429 response carries an exact <code>Retry-After</code> value in
        seconds. That's the number the toast counts down — once it hits zero,
        you can try again with no penalty.
      </p>

      <h2 className="display text-xl font-black mt-6 mb-2">Typical limits</h2>
      <ul className="text-sm list-disc pl-5 space-y-1 mb-4">
        <li>Sign in: 10 attempts per minute per IP, 5 per email per 5 minutes.</li>
        <li>Sign up: 5 per 5 minutes per IP, 3 per hour per email.</li>
        <li>Password reset & confirmation resend: a few per hour per email.</li>
        <li>AI search: 10 per minute, 60 per hour per visitor.</li>
      </ul>

      <h2 className="display text-xl font-black mt-6 mb-2">Still stuck?</h2>
      <p className="text-sm mb-2">
        Wait for the countdown, then try again. If you keep getting throttled
        without a burst of activity, you may be behind a shared network or VPN.
        Switching networks usually resolves it.
      </p>
      <p className="text-sm mb-6">
        Believe you're locked out in error?{" "}
        <a className="underline" href="mailto:support@trendslated.app">
          support@trendslated.app
        </a>
        .
      </p>

      <Link to="/" className="ui small-caps text-xs text-accent-red">
        ← Back to the front page
      </Link>
    </main>
  );
}