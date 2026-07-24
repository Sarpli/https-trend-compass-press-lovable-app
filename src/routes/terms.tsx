import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Trendslated" },
      { name: "description", content: "The rules for using Trendslated, including community guidelines for user-generated content." },
      { property: "og:title", content: "Terms of Use — Trendslated" },
      { property: "og:description", content: "The rules for using Trendslated, including community guidelines for user-generated content." },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs ui small-caps text-accent-red mb-2">Legal</div>
      <h1 className="display text-4xl font-black mb-2">Terms of Use</h1>
      <p className="text-xs text-muted-foreground ui mb-8">Last updated: July 2, 2026</p>

      <div className="prose max-w-none space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="display text-xl font-bold mb-2">Accepting these terms</h2>
          <p>
            By creating an account or using Trendslated you agree to these Terms and to our
            Privacy Policy. You must be at least 13 years old to use the app.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Community guidelines (EULA)</h2>
          <p>
            Trendslated is a shared cultural reference. We do not tolerate objectionable content
            or abusive behavior. This includes:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Hate speech, slurs, or content that attacks people based on race, ethnicity, religion, gender identity, sexual orientation, disability, or nationality.</li>
            <li>Harassment, threats, doxxing, or targeted abuse of any individual or group.</li>
            <li>Sexually explicit, violent, or graphic content.</li>
            <li>Content that promotes illegal activity or self-harm.</li>
            <li>Spam, deceptive submissions, or coordinated vote manipulation.</li>
          </ul>
          <p className="mt-3">
            Violations may result in content removal, account suspension, or permanent ban.
            There is zero tolerance for objectionable content or abusive users.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Reporting and moderation</h2>
          <p>
            Any signed-in user can flag a trend entry from its page using the "Report this entry"
            control. Our editors review flagged content within 24 hours and remove anything that
            violates these guidelines. You may also block an abusive user by tapping the block
            control on their profile once we introduce user pages; until then, contact us at{" "}
            <a className="underline" href="mailto:abuse@trendslated.app">abuse@trendslated.app</a>{" "}
            and we will act within 24 hours.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Subscriptions</h2>
          <p>
            Pro is billed monthly or annually through our payment processor. You can cancel any
            time from your Account page. When you cancel, Pro features remain active until the
            end of the current billing period. No refunds for partial periods except where
            required by law.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Account deletion</h2>
          <p>
            You may permanently delete your account at any time from the Account page. Deletion
            removes your profile, votes, streaks, learned entries, and sign-in credentials.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Content ownership</h2>
          <p>
            Definitions and editorial content on Trendslated are © Trendslated. Your votes and
            learned-term records are yours; we hold them under license to run the service.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Disclaimer</h2>
          <p>
            Trendslated is provided "as is" without warranties of any kind. We are not liable for
            indirect or consequential damages arising from your use of the service.
          </p>
        </section>

        <section>
          <h2 className="display text-xl font-bold mb-2">Contact</h2>
          <p>
            <a className="underline" href="mailto:hello@trendslated.app">hello@trendslated.app</a>
          </p>
        </section>
      </div>
    </article>
  );
}