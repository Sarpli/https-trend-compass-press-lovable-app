import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Trenslate" },
      { name: "description", content: "How Trenslate collects, uses, and protects your personal information." },
      { property: "og:title", content: "Privacy Policy — Trenslate" },
      { property: "og:description", content: "How Trenslate collects, uses, and protects your personal information." },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-2">Legal</div>
      <h1 className="display text-4xl font-black mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground ui mb-8">Last updated: July 2, 2026</p>

      <div className="prose max-w-none space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="display text-xl font-bold mb-2">What we collect</h2>
          <p>
            When you create an account we store your email address, a hashed password (if using
            email sign-in), and the identifier returned by your OAuth provider (Apple, Google).
            We do not sell your data to third parties.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">How we use it</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Authenticate you across sessions and devices.</li>
            <li>Record your votes, streaks, learned terms, and daily search count.</li>
            <li>Detect abuse (rate-limits, fraud, moderation).</li>
            <li>Send transactional email such as password resets.</li>
          </ul>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Third parties</h2>
          <p>
            Trenslate uses Supabase for authentication and database hosting and
            Lovable AI for semantic archive search. Each processor handles data
            under its own terms.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Your rights</h2>
          <p>
            You may request a copy of your data or delete your account at any time. Deletion is
            available inside the app on the{" "}
            <Link to="/account" className="underline">Account page</Link> and permanently removes
            your profile, votes, streaks, and sign-in credentials.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Children</h2>
          <p>
            Trenslate is not directed to children under 13. If we learn we have collected personal
            information from a child under 13, we will delete it.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Contact</h2>
          <p>
            Questions about this policy: <a className="underline" href="mailto:privacy@trenslate.app">privacy@trenslate.app</a>.
          </p>
        </section>
      </div>
    </article>
  );
}