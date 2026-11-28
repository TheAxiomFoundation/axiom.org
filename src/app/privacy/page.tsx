export default function PrivacyPage() {
  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[800px] mx-auto">
        <header className="text-center mb-16">
          <h1 className="heading-page mb-4">
            Privacy policy
          </h1>
          <p className="font-mono text-sm text-[var(--color-ink-muted)]">
            Last updated: November 2026
          </p>
        </header>

        <div className="flex flex-col gap-12">
          <section>
            <h2 className="heading-sub mb-4">
              Information we collect
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              We collect minimal data. Our website uses PostHog and Google Analytics for usage analytics.
              We track page views and axiom browsing interactions (which rules are viewed, navigation patterns)
              to understand how our tools are used. We do not intentionally collect personal information or send
              personal information to analytics providers. PostHog is configured to respect Do Not Track browser
              settings.
            </p>
          </section>

          <section>
            <h2 className="heading-sub mb-4">
              How we use information
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              To improve our tools and understand how they&apos;re used.
            </p>
          </section>

          <section>
            <h2 className="heading-sub mb-4">
              Events and newsletters
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              We use Zoom for event registration and MailChimp for newsletters.
              We ask for name, organization affiliation, and email addresses as
              part of registering. We do not share or sell your information.
            </p>
          </section>

          <section>
            <h2 className="heading-sub mb-4">
              Third-party services
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              Vercel (hosting), GitHub (code hosting), Supabase (database for experiment tracking),
              PostHog and Google Analytics (usage analytics), Zoom (event registration),
              MailChimp (newsletters)
            </p>
          </section>

          <section>
            <h2 className="heading-sub mb-4">
              Open source
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              Our open-source code is at{" "}
              <a
                href="https://github.com/TheAxiomFoundation"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/TheAxiomFoundation
              </a>
              . We release the rules engine, the encoder, the oracle harness,
              and this site under the MIT License, which permits commercial
              use, modification, and redistribution as long as copies and
              substantial portions keep its copyright and permission notices.
              We dedicate the published RuleSpec encodings, with their tests,
              parameter values, and provenance metadata, to the public domain
              under CC0 1.0, so anyone may use them for any purpose; where that
              dedication can&rsquo;t take effect, CC0 grants an unconditional
              licence instead. We ask for a citation but don&rsquo;t require
              one. The incidental tooling inside each RuleSpec repository (CI
              harnesses, runners, and conversion utilities) stays under the
              Apache License 2.0.
            </p>
          </section>

          <section>
            <h2 className="heading-sub mb-4">
              Contact
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
              For privacy questions, email{" "}
              <a href="mailto:hello@axiom.org">
                hello@axiom.org
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
