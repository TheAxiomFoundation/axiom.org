import { Fragment } from "react";
import Link from "next/link";

/**
 * The published planning model. Every displayed cell is the published
 * planning value; the numeric constants underneath let tests verify the
 * arithmetic chains reproduce each cell within rounding (published cells
 * round at intermediate steps, so end-to-end recomputation can differ by
 * one unit in the last displayed digit).
 */
export const PLANNING_MODEL = {
  asOf: "2026-07-11",
  devAsOf: "2026-08-14",
  // Measured encoder base
  runs: 3_582,
  tokensPerPass: 55_000, // [M] ~55k total tokens per pass
  mix: { fresh: 30_300, cachedRead: 18_700, output: 3_800 }, // [D]/[M]/[M] medians, non-additive
  attemptsPerAccepted: 1.43, // [M]
  firstPassAcceptance: { low: 0.63, high: 0.73 }, // [M]; hard-fail allocation uses the 0.73 bound
  throughputPerDay: { recent: 100, peak: 138 }, // [D]
  systemMultiplier: 3.0, // [D] merged-PR composition proxy
  // Coverage tiers — published cells
  tiers: [
    {
      id: "A",
      name: "A — oracle universe",
      scope:
        "Policies checkable against an independent oracle: the 137 programs currently scored in PolicyEngine-US, 51 income-tax jurisdictions, state benefit manuals",
      modules: 20_000,
      modulesLabel: "~20,000",
      modulesProvenance: "D" as const,
      directTokens: "2.1B",
      systemTokens: "6.4B",
      calendar: "199 → 20 days",
    },
    {
      id: "B",
      name: "B — operative detail",
      scope: "+ SSA POMS, IRS/CMS guidance, deep state manuals",
      modules: 49_000,
      modulesLabel: "~49,000",
      modulesProvenance: "D" as const,
      directTokens: "5.2B",
      systemTokens: "15.7B",
      calendar: "16 → 1.6 months",
    },
    {
      id: "C",
      name: "C — full statutory breadth",
      scope:
        "+ complete revenue/welfare titles × 51 (denominator carries roughly 2× uncertainty)",
      modules: 346_000,
      modulesLabel: "~346,000",
      modulesProvenance: "A" as const,
      directTokens: "37B",
      systemTokens: "111B",
      calendar: "9.5 → 0.95 years",
    },
  ],
  // Cost per module at each vendor's public list prices ($/M tokens), the
  // same pinned price table the public dashboard uses (verified 2026-07-11).
  // The billing mix was measured in OpenAI tokens, so OpenAI rows are native
  // units; Claude rows carry the counts unchanged (≈+30% caveat in prose).
  models: [
    {
      vendor: "OpenAI" as const,
      name: "gpt-5.6-luna",
      prices: { input: 1, cached: 0.1, output: 6 },
      pricesLabel: "$1/$6",
      standard: "$0.108",
      batch: "$0.054",
      system: "$0.162",
      tierA: "$3.2k",
      tierB: "$7.9k",
      today: "did not qualify — July bake-off",
    },
    {
      vendor: "OpenAI" as const,
      name: "gpt-5.6-terra",
      prices: { input: 2.5, cached: 0.25, output: 15 },
      pricesLabel: "$2.5/$15",
      standard: "$0.269",
      batch: "$0.135",
      system: "$0.404",
      tierA: "$8.1k",
      tierB: "$19.8k",
      today: "pinned production encoder",
    },
    {
      vendor: "OpenAI" as const,
      name: "gpt-5.5",
      prices: { input: 5, cached: 0.5, output: 30 },
      pricesLabel: "$5/$30",
      standard: "$0.538",
      batch: "$0.269",
      system: "$0.808",
      tierA: "$16.2k",
      tierB: "$39.6k",
      today: "prior workhorse — 3,289 of the 3,582 measured runs",
    },
    {
      vendor: "OpenAI" as const,
      name: "gpt-5.6-sol",
      prices: { input: 5, cached: 0.5, output: 30 },
      pricesLabel: "$5/$30",
      standard: "$0.538",
      batch: "$0.269",
      system: "$0.808",
      tierA: "$16.2k",
      tierB: "$39.6k",
      today: "review/judge lane (cross-family)",
    },
    {
      vendor: "Anthropic" as const,
      name: "Haiku 4.5",
      prices: { input: 1, cached: 0.1, output: 5 },
      pricesLabel: "$1/$5",
      standard: "$0.100",
      batch: "$0.050",
      system: "$0.150",
      tierA: "$3.0k",
      tierB: "$7.3k",
      today: "dev fleet (mechanical tasks); encoder pending bake-off",
    },
    {
      vendor: "Anthropic" as const,
      name: "Sonnet 5, intro to 2026-08-31",
      prices: { input: 2, cached: 0.2, output: 10 },
      pricesLabel: "$2/$10",
      standard: "$0.200",
      batch: "$0.100",
      system: "$0.300",
      tierA: "$6.0k",
      tierB: "$14.7k",
      today: "encoder candidate — pending bake-off",
    },
    {
      vendor: "Anthropic" as const,
      name: "Sonnet 5, list",
      prices: { input: 3, cached: 0.3, output: 15 },
      pricesLabel: "$3/$15",
      standard: "$0.300",
      batch: "$0.150",
      system: "$0.451",
      tierA: "$9.0k",
      tierB: "$22.0k",
      today: "—",
    },
    {
      vendor: "Anthropic" as const,
      name: "Opus 4.8",
      prices: { input: 5, cached: 0.5, output: 25 },
      pricesLabel: "$5/$25",
      standard: "$0.501",
      batch: "$0.250",
      system: "$0.751",
      tierA: "$14.9k",
      tierB: "$36.7k",
      today: "dev fleet (lane agents); encoder pending bake-off",
    },
    {
      vendor: "Anthropic" as const,
      name: "Fable 5",
      prices: { input: 10, cached: 1, output: 50 },
      pricesLabel: "$10/$50",
      standard: "$1.001",
      batch: "$0.501",
      system: "$1.502",
      tierA: "$29.9k",
      tierB: "$73.4k",
      today: "dev fleet (main loops) + cross-family judging",
    },
  ],
  // Development-fleet usage — strict-accounting dashboard figures
  // (methodology hardened 2026-07-12; snapshot 2026-08-14)
  devUsage: [
    { window: "Trailing 7 days", claude: 16.3, codex: 9.3, total: 25.6 },
    { window: "Trailing 30 days", claude: 94.8, codex: 62.7, total: 157.5 },
    {
      window: "Lifetime (since 2025-11-30)",
      claude: 177.7,
      codex: 156.7,
      total: 334.4,
    },
  ],
};

type ProvenanceKind = "M" | "D" | "A";

const PROVENANCE_TITLES: Record<ProvenanceKind, string> = {
  M: "Measured — from run records or session logs",
  D: "Derived — arithmetic on measured inputs, method shown",
  A: "Assumed — planning assumption, stated as such",
};

function Provenance({ kind }: { kind: ProvenanceKind }) {
  return (
    <span
      title={PROVENANCE_TITLES[kind]}
      className="font-mono text-[10px] px-1 py-0.5 rounded border border-[var(--color-rule)] bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)] whitespace-nowrap align-middle"
    >
      [{kind}]
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="heading-sub mb-4">{children}</h2>;
}

const thBase =
  "font-medium px-4 py-3 font-mono text-[10px] uppercase tracking-wider";

export function PlanningModelPage() {
  const m = PLANNING_MODEL;
  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[880px] mx-auto">
        <header className="mb-14">
          <h1 className="heading-page mb-6">Compute planning model</h1>
          <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed">
            The token economics behind Axiom&apos;s encoding plan, published
            with the provenance discipline we use everywhere: every figure is
            labeled <Provenance kind="M" /> measured, <Provenance kind="D" />{" "}
            derived, or <Provenance kind="A" /> assumed, and the arithmetic is
            shown so anything here can be recomputed. Encoder figures as of{" "}
            <span className="font-mono">{m.asOf}</span>; usage figures as of{" "}
            <span className="font-mono">{m.devAsOf}</span>.
          </p>
        </header>

        <section className="mb-14">
          <SectionHeading>The measured base</SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Each rule module is produced by an agentic encoder loop: the agent
            reads the provision from an immutable, cryptographically pinned
            corpus release, writes the module, runs a deterministic gate
            battery (schema, citation resolution, dependency closure, oracle
            conformance where one exists), and iterates. The module is the
            provision-level increment every figure below counts — for
            example,{" "}
            <a
              href="https://app.axiom-foundation.org/us/statute/26/24"
              target="_blank"
              rel="noopener noreferrer"
            >
              26 U.S.C. § 24
            </a>{" "}
            (the child tax credit) or{" "}
            <a
              href="https://app.axiom-foundation.org/us-co/regulation/10-ccr-2506-1/4.110"
              target="_blank"
              rel="noopener noreferrer"
            >
              10 CCR 2506-1 § 4.110
            </a>{" "}
            (Colorado food assistance), browsable with citations and tests in
            the Axiom app. Encoders are chosen
            empirically by production bake-off — gate pass-rates on the live
            task mix, never benchmark reputation. Today gpt-5.6-terra is the
            pinned encoder (gpt-5.5 was the workhorse for 3,289 of the 3,582
            measured runs); adjudication runs cross-family — OpenAI and Claude
            models judging each other&apos;s output — and the development
            fleet runs Claude main loops alongside codex lanes, per the usage
            table below. Oracle conformance runs
            against PolicyEngine, TAXSIM, EUROMOD/UKMOD, and the SOUTHMOD
            country models, plus state administrative records (95.3%
            exact-match against Colorado SNAP quality-control determinations{" "}
            <Provenance kind="M" />); cross-family judge models review every
            audit-logged run.
          </p>
          <ul className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed space-y-2 list-disc pl-5">
            <li>
              <span className="font-mono">3,582</span> encoder runs in the
              measurement window <Provenance kind="M" />
            </li>
            <li>
              ≈<span className="font-mono">55k</span> total tokens per pass{" "}
              <Provenance kind="M" />, with a billing mix of ≈
              <span className="font-mono">30.3k</span> fresh input{" "}
              <Provenance kind="D" /> / <span className="font-mono">18.7k</span>{" "}
              cached-read / <span className="font-mono">3.8k</span> output{" "}
              <Provenance kind="M" /> — independently computed representative
              medians, deliberately non-additive
            </li>
            <li>
              <span className="font-mono">1.43</span> attempts per accepted
              module <Provenance kind="M" />; 63–73% first-pass gate acceptance{" "}
              <Provenance kind="M" />
            </li>
            <li>
              ~<span className="font-mono">100</span> accepted modules/day over
              the recent active window, <span className="font-mono">138</span>
              /day peak <Provenance kind="D" />
            </li>
            <li>
              Surrounding oracle, judging, and infrastructure work carried as a{" "}
              <span className="font-mono">3.0×</span> system-token planning
              proxy <Provenance kind="D" /> — a derived multiplier from
              merged-PR composition, not a literal token measurement
            </li>
          </ul>
        </section>

        <section className="mb-14">
          <SectionHeading>Coverage tiers and token demand</SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Tiers nest: B includes A, C includes B — token columns are
            cumulative totals to finish that tier, not additive increments.
          </p>
          <div className="overflow-x-auto border border-[var(--color-rule)] rounded-lg mb-4">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)]">
                <tr>
                  <th className={`${thBase} text-left`}>Coverage tier</th>
                  <th className={`${thBase} text-left`}>Central planning scope</th>
                  <th className={`${thBase} text-right`}>Modules remaining [D]</th>
                  <th className={`${thBase} text-right`}>Direct tokens [D]</th>
                  <th className={`${thBase} text-right`}>System tokens (×3) [D]</th>
                  <th className={`${thBase} text-right`}>Calendar @100–1,000/day [D]</th>
                </tr>
              </thead>
              <tbody>
                {m.tiers.map((tier) => (
                  <tr
                    key={tier.id}
                    className="border-t border-[var(--color-rule)]"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-ink)] whitespace-nowrap">
                      {tier.name}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-secondary)]">
                      {tier.scope}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      {tier.modulesLabel}
                      {tier.modulesProvenance === "A" ? " [A]" : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      {tier.directTokens}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      {tier.systemTokens}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)] whitespace-nowrap">
                      {tier.calendar}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-edition p-6">
            <p className="font-mono text-xs text-[var(--color-ink-muted)] uppercase tracking-wider mb-3">
              The arithmetic
            </p>
            <pre className="font-mono text-[13px] leading-relaxed text-[var(--color-ink-secondary)] overflow-x-auto whitespace-pre">
              {`effective tokens per module ≈ 55k/pass × 1.43 attempts ÷ 0.73 acceptance ≈ 106–108k   [D]
direct tokens  = modules remaining × ≈106k        (Tier A: 20,000 × ≈106k ≈ 2.1B)
system tokens  = direct × 3.0                     (Tier A: ≈6.4B)
calendar       = modules ÷ throughput per day     (Tier A: 20,000 ÷ 100 ≈ 200 days → ÷ 1,000 ≈ 20 days)`}
            </pre>
          </div>
        </section>

        <section className="mb-14">
          <SectionHeading>
            Cost per module at public list prices
          </SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Cost per accepted module for the models we run today and the ones
            we could: the measured per-pass billing mix priced at each
            vendor&apos;s public list prices — the same pinned price table the
            public dashboard uses, verified 2026-07-11 <Provenance kind="M" />{" "}
            — with Batch API at 50% on both vendors <Provenance kind="M" />,
            each model&apos;s cached-input rate included, and cache-write
            premiums excluded (lower-bound reuse case){" "}
            <Provenance kind="A" />. Two explicit caveats: the mix was
            measured in OpenAI tokens, so OpenAI rows are native units{" "}
            <Provenance kind="M" /> while Claude rows carry the counts
            unchanged <Provenance kind="A" /> — Anthropic&apos;s
            current-generation tokenizer produces roughly 30% more tokens for
            identical text, so treat Claude figures as ≈+30% pending a native
            count; and quality on this task mix is unmeasured until a model
            clears the bake-off <Provenance kind="A" /> — the harness
            qualifies encoders on measured gate pass-rates, never on benchmark
            reputation.
          </p>
          <div className="overflow-x-auto border border-[var(--color-rule)] rounded-lg mb-4">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)]">
                <tr>
                  <th className={`${thBase} text-left`}>Model</th>
                  <th className={`${thBase} text-right`}>$/module (standard) [D]</th>
                  <th className={`${thBase} text-right`}>$/module (Batch) [D]</th>
                  <th className={`${thBase} text-right`}>System $/module (Batch, ×3) [D]</th>
                  <th className={`${thBase} text-right`}>Tier A generation [D]</th>
                  <th className={`${thBase} text-right`}>Tier B (cumulative) [D]</th>
                  <th className={`${thBase} text-left`}>In production today</th>
                </tr>
              </thead>
              <tbody>
                {(["OpenAI", "Anthropic"] as const).map((vendor) => (
                  <Fragment key={vendor}>
                    <tr className="border-t border-[var(--color-rule)]">
                      <td
                        colSpan={7}
                        className="px-4 py-2 bg-[var(--color-rule-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]"
                      >
                        {vendor === "OpenAI"
                          ? "OpenAI — native token units [M]"
                          : "Anthropic — constant-token normalization, ≈+30% pending a native count [A]"}
                      </td>
                    </tr>
                    {m.models
                      .filter((model) => model.vendor === vendor)
                      .map((model) => (
                        <tr
                          key={model.name}
                          className="border-t border-[var(--color-rule)]"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--color-ink)] whitespace-nowrap">
                            {model.name}{" "}
                            <span className="font-mono text-[var(--color-ink-muted)]">
                              ({model.pricesLabel})
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                            {model.standard}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                            {model.batch}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                            {model.system}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                            {model.tierA}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                            {model.tierB}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-ink-secondary)]">
                            {model.today}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-edition p-6">
            <p className="font-mono text-xs text-[var(--color-ink-muted)] uppercase tracking-wider mb-3">
              The arithmetic
            </p>
            <pre className="font-mono text-[13px] leading-relaxed text-[var(--color-ink-secondary)] overflow-x-auto whitespace-pre">
              {`$/module (standard) = (30.3k × input + 18.7k × cached + 3.8k × output) ÷ 1M × 1.43 ÷ 0.73
  e.g. gpt-5.6-terra: (30.3k × $2.5 + 18.7k × $0.25 + 3.8k × $15) ÷ 1M ≈ $0.137/pass → ≈ $0.269/module
  e.g. Opus 4.8:      (30.3k × $5 + 18.7k × $0.5 + 3.8k × $25) ÷ 1M ≈ $0.256/pass → ≈ $0.501/module
$/module (Batch)    = standard × 0.5        (both vendors' Batch APIs are 50%)
system $/module     = Batch × 3.0
tier generation     = system $/module × modules remaining   (Opus 4.8, Tier A: $0.751 × 20,000 ≈ $14.9k)`}
            </pre>
            <p className="font-body text-sm text-[var(--color-ink-muted)] leading-relaxed mt-3">
              Cells are the published planning values; published cells round at
              intermediate steps, so recomputing a chain end-to-end reproduces
              each cell within one unit of its last displayed digit.
            </p>
          </div>
        </section>

        <section className="mb-14">
          <SectionHeading>
            The development fleet is a separate, larger demand line
          </SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Beyond generation, the platform — encoder harness, rules engines,
            ingest adapters, CI, dashboards — is built by agent fleets. Two
            independent measurements: a{" "}
            <a
              href="https://www.maxghenis.com/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              public live dashboard
            </a>{" "}
            (raw per-model token counts at standard-tier public API list
            prices — no vendor discounts; cache reads and cache writes at
            their own rates), and an independent local recount over the raw
            session logs; both count cache-creation. The dashboard pipeline
            was audited and rebuilt on 2026-07-11, then hardened on
            2026-07-12 with the recount&apos;s adversarially reviewed rules —
            per-event dating, global message dedup, fork-replay prefixes
            excluded structurally, counter resets summed as billing epochs,
            streamed usage deduplicated last-wins, repriced from pinned
            list-price tables — with the audit trail public in the
            dashboard&apos;s data repository <Provenance kind="M" />. The two
            methods agreed to the token on most complete months when the
            hardened rules landed, within about 2% on the rest{" "}
            <Provenance kind="M" />; rerun later, the recount reads only
            transcripts still on disk, while the dashboard&apos;s scan cache
            keeps rotated history and extra codex lanes counted — so the
            dashboard is the more complete series (May and June still
            reconcile within 1%) <Provenance kind="M" />. These figures cover the
            operator&apos;s full multi-project workload — Axiom&apos;s share
            is substantial but not isolated here, so treat them as a verified
            operator-wide upper bound <Provenance kind="M" />.
            Actual cash cost today is borne on flat-rate developer
            subscriptions.
          </p>
          <div className="overflow-x-auto border border-[var(--color-rule)] rounded-lg mb-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-[var(--color-rule-subtle)] text-[var(--color-ink-muted)]">
                <tr>
                  <th className={`${thBase} text-left`}>Window (as of {m.devAsOf}) [M]</th>
                  <th className={`${thBase} text-right`}>Claude-family</th>
                  <th className={`${thBase} text-right`}>codex/OpenAI</th>
                  <th className={`${thBase} text-right`}>Total API-equivalent</th>
                </tr>
              </thead>
              <tbody>
                {m.devUsage.map((row) => (
                  <tr
                    key={row.window}
                    className="border-t border-[var(--color-rule)]"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                      {row.window}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      ${row.claude.toFixed(1)}k
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      ${row.codex.toFixed(1)}k
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-ink)]">
                      ${row.total.toFixed(1)}k
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
            The trailing-30-day line is roughly $160k/month{" "}
            <Provenance kind="D" />, with the trailing week cooler ($25.6k);
            July closed at $170.4k and August 1–14 stands at $74.7k{" "}
            <Provenance kind="M" />, against $39.0k (May) and $31.9k (June){" "}
            <Provenance kind="M" /> — the step up came as the encoding lanes
            and the launch push scaled. The Claude-family line — the larger
            of the two over the trailing 30 days — is cache-read dominated:
            18.9B cache-read versus 0.001B fresh input tokens August 1–14,
            plus 0.9B of cache writes <Provenance kind="M" />. Prompt-caching
            economics, not list input price, drive this line. This is one
            operator plus agent fleets; scaling with team size is expected to
            be roughly linear <Provenance kind="A" />.
          </p>
        </section>

        <section className="mb-14">
          <SectionHeading>Where marginal compute plugs in</SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-4">
            Everything above is the demand side. Marginal capacity — metered
            credits or negotiated throughput, from any vendor whose model
            clears the bake-off — converts into published, verifiable output
            in four places. Quantities reference the tables above; the cost
            table prices them in both vendors&apos; units.
          </p>
          <ol className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed space-y-4 list-decimal pl-5">
            <li>
              <strong className="text-[var(--color-ink)]">
                Generation waves — finish Tier A, then Tier B.
              </strong>{" "}
              ≈6.4B system-proxy tokens completes Tier A; ≈15.7B cumulative
              completes Tier B <Provenance kind="D" />. The loop fits
              Batch-class queued single-shot waves — each pass is an
              independent request, so encoder iterations run as staged waves{" "}
              <Provenance kind="A" /> — with interactive repair at standard
              tier. At the table&apos;s Batch rates, Tier A generation is
              $3.0–29.9k across the model tiers <Provenance kind="D" />; the
              budget is the small term. Merge and verification throughput
              governs the calendar, assumed to ramp from ~100 toward ~200+
              modules/day as pipeline hardening lands <Provenance kind="A" />.
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">
                Encoder qualification — the standing quarterly bake-off.
              </strong>{" "}
              Any candidate model qualifies on the live production mix:
              grounding-failure rate, cost per accepted module, and
              wall-clock, in about a week of drain time <Provenance kind="D" />
              . Results are publishable either way. This is the empirical gate
              between the price table above and production use.
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">
                Cross-family judging.
              </strong>{" "}
              Every audit-logged encoder run is adjudicated by a model family
              different from the one that generated it. Judging is
              adjudication-dense — the slot where frontier capability binds
              hardest — and is carried inside the 3.0× system proxy{" "}
              <Provenance kind="D" />.
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">
                The development fleet.
              </strong>{" "}
              The separate line above — roughly $100k/month trailing-30 at
              list-price equivalent, with July pacing higher, an
              operator-wide upper bound{" "}
              <Provenance kind="D" /> — builds the ingest, verification, and
              merge-train infrastructure that is the actual budget driver. It
              runs on flat-rate developer subscriptions today and is expected
              to scale roughly linearly with team size <Provenance kind="A" />.
            </li>
          </ol>
        </section>

        <section className="mb-14">
          <SectionHeading>Method and provenance</SectionHeading>
          <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
            Measured figures come from encoder run records as of {m.asOf} and
            session logs as of {m.devAsOf}. Claude figures are constant-token
            normalizations
            pending a native tokenizer count (≈+30%). Development-usage
            figures are operator-wide, not project-attributed. Nothing here is
            a commitment; the model exists so capacity conversations can start
            from measured demand rather than a guess. Corrections are welcome
            —{" "}
            <a
              href="https://github.com/TheAxiomFoundation/axiom.org/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              file an issue
            </a>
            . Related: <Link href="/ops/planning/scenarios">forward scenarios</Link>{" "}
            (price, capability, throughput, cloud scaling) ·{" "}
            <Link href="/ops">operations dashboard</Link>.
          </p>
        </section>
      </div>
    </div>
  );
}
