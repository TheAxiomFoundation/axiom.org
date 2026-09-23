/**
 * PROTOTYPE DATA — the "all Axiom" naming mock (branch suite-mock, never
 * merged). Copy on each line is taken from that program's own live
 * homepage on 2026-09-21; figures were read from the live sources named
 * in `figure.source` on the same day. Nothing here is a plan.
 */
export const SUITE_AS_OF = "21 Sep 2026";
export const SUITE_DEPTH_AS_OF = "22 Sep 2026";

export interface SuiteLine {
  slug: "rules" | "records" | "microcosm" | "simulator" | "forecasts" | "evals";
  name: string;
  /** What the program is called today, and where it lives. */
  today: { name: string; domain: string; href: string };
  hue: string;
  hueDark: string;
  noun: string;
  /** The line's subject in the homepage flip card ("{subject} for all."). */
  subject: string;
  /** Derived from `subject`, so the flip card and every tagline agree. */
  forAll: string;
  headline: string;
  body: string;
  /** How the line is checked, where a real number exists; `asOf` when read on a different day. */
  figure?: { value: string; label: string; source: string; asOf?: string };
  features: { title: string; body: string; href?: string }[];
  /** Benchmarks of AI on this line's subject, where the line hosts them. */
  benchmarks?: { title: string; body: string; href?: string }[];
  snapshot?: { heading: string; note: string; rows: string[][]; asOf?: string };
  cta: string;
  /** A product-depth page inside the mock, where one exists. */
  deep?: { label: string; href: string };
}

/** The three benchmarks of AI on law. Copy is each benchmark's own live site
 *  (policybench.org, encodebench.org) or repo description (PolicyBench Draft,
 *  private), read 2026-09-23. */
const BENCHMARKS = [
  {
    title: "PolicyBench",
    body: "Testing how accurately language models calculate household taxes and benefits: 39 models, 100 households, 18 outputs each, graded against Axiom Simulator reference outputs.",
    href: "https://policybench.org",
  },
  {
    title: "EncodeBench",
    body: "Can a model write the law as code? Statutes turned into cited, executable rules, scored by deterministic gates: the encoding compiles, passes CI, and contains no number the source text doesn't.",
    href: "https://encodebench.org",
  },
  {
    title: "PolicyBench Draft",
    body: "Can a model do the Office of Legislative Counsel's work? Deterministic evals over real congressional bill XML. Private preview, 52 cases.",
  },
];

const POLICYBENCH_TOP_FIVE = {
  heading: "PolicyBench, top five",
  note: "as shown on policybench.org, snapshot 5 Sep 2026",
  asOf: "23 Sep 2026",
  rows: [
    ["Rank", "Model", "Exact match"],
    ["1", "GPT-5.6 Sol", "89.2%"],
    ["2", "GPT-6 Astra", "88.0%"],
    ["3", "Claude Fable 5.1", "86.9%"],
    ["4", "Kimi K3", "86.7%"],
    ["5", "GPT-5.6 Luna", "84.6%"],
  ],
};

const LINES: Omit<SuiteLine, "forAll">[] = [
  {
    slug: "rules",
    name: "Axiom Rules",
    today: { name: "Axiom", domain: "axiom.org", href: "https://axiom.org" },
    hue: "#B45309",
    hueDark: "#D97706",
    noun: "executable law",
    subject: "Computable law",
    headline: "Computable law for all.",
    body:
      "Open, machine-readable encodings of the world's rules, starting with tax and benefit policy. Cited, time-aware, and executable, so anyone can run, audit, or reform them.",
    // Sum of the dashboard's per-engine household counts, leaving out
    // PolicyEngine (Axiom Simulator here, so not an outside check).
    figure: {
      value: "424,363",
      label: "households checked against five outside engines",
      source: "axiom.org/oracles",
      asOf: "22 Sep 2026",
    },
    features: [
      {
        title: "Calculators that audit themselves",
        body:
          "Tax software, benefit estimators, eligibility tools: all running off the same encoding, all able to point at the statute behind any number.",
      },
      {
        title: "Ground truth for AI",
        body:
          "People keep asking models policy questions. Verifiable answers grounded in actual law, useful for both training and inference.",
      },
      {
        title: "Reform without rewriting",
        body:
          "Change a parameter, re-run the calculation. Compare current law against any proposed amendment without touching the surrounding rules.",
      },
      {
        title: "Government in plain sight",
        body:
          "Every value cites its source. Every formula is open. Anyone can read the law, run it, and check that the answer follows.",
      },
    ],
    cta: "Explore the law",
    deep: { label: "Browse the encoded law", href: "https://axiom.org/us" },
  },
  {
    slug: "records",
    name: "Axiom Records",
    today: {
      name: "Chronicle",
      domain: "chronicle.institute",
      href: "https://chronicle.institute",
    },
    hue: "#33547D",
    hueDark: "#7CA1D6",
    noun: "official statistics, as first printed",
    subject: "Official statistics",
    headline: "A record of what official sources printed, and when.",
    body:
      "The numbers government statistical agencies published, kept at first print, with provenance, revision history, and a stable address for every fact. Records keeps each value as published; it never reconciles, imputes, or models one.",
    figure: {
      value: "39,173",
      label: "source-backed facts in the store",
      source: "chronicle.institute",
    },
    features: [
      {
        title: "Journal",
        body: "An append-only log of accepted facts, each with its first-print date and its acceptance date.",
      },
      {
        title: "Store",
        body: "Every fact at a stable, citable address, parsed from its source package.",
      },
      {
        title: "Revisions",
        body: "What the agency printed first, and every value it printed afterwards.",
      },
      {
        title: "Verify",
        body: "Check a fact against the witnessed release it came from.",
      },
    ],
    snapshot: {
      heading: "Latest journal entries",
      note: "as shown on chronicle.institute",
      rows: [
        ["Fact", "Value", "First print"],
        ["Euro area HICP all-items flash estimate, annual rate, 2026-06", "2.8%", "2026-07-01"],
        ["Canada CPI all-items, 12-month change (NSA), 2026-05", "3.2%", "2026-06-22"],
      ],
    },
    cta: "Browse the record",
    deep: { label: "The journal, in the mock", href: "/suite/records/journal" },
  },
  {
    slug: "microcosm",
    name: "Axiom Microcosm",
    today: {
      name: "Microcosm",
      domain: "microcosm.institute",
      href: "https://microcosm.institute",
    },
    hue: "#3E7A5E",
    hueDark: "#5FA588",
    noun: "synthetic economy",
    subject: "Synthetic households",
    headline:
      "A nation is millions of people, households, and firms. We build a synthetic one that stands in for them all.",
    body:
      "Synthetic households, firms and the flows between them, calibrated to public totals from survey and administrative data: realistic enough to model tax and benefit policy for everyone, or to stand in for a population wherever one is needed, private by construction, and improved in the open.",
    figure: {
      value: "95.7%",
      label: "of 5,659 published targets hit within 10%",
      source: "huggingface.co/datasets/policyengine/populace-us",
      asOf: "22 Sep 2026",
    },
    features: [
      {
        title: "The support",
        body: "Which records exist and what they carry: a spine of observed survey records, completed by draws from the population's conditional distribution.",
      },
      {
        title: "The totals",
        body: "Weights that hit administrative facts: calibration against thousands of hierarchical targets, with hard weight-ratio bounds.",
      },
      {
        title: "The economy",
        body: "The same target surface on a fraction of the records, so the file is small enough to deploy.",
      },
      {
        title: "The referee",
        body: "Evaluation that scores what every operator did to the frame.",
      },
    ],
    cta: "See how it works",
    deep: { label: "Latest release, in the mock", href: "/suite/microcosm/release" },
  },
  {
    slug: "simulator",
    name: "Axiom Simulator",
    today: {
      name: "PolicyEngine",
      domain: "policyengine.org",
      href: "https://www.policyengine.org",
    },
    hue: "#2C7A7B",
    hueDark: "#4FD1C5",
    noun: "microsimulation model",
    subject: "Policy simulations",
    headline:
      "Free, open-source tax and benefit analysis. Model policy reforms across all 50 states.",
    body:
      "Free, open-source tools to understand tax and benefit policies. Calculate your taxes and benefits, or analyze policy reforms.",
    figure: {
      value: "69,571",
      label: "downloads of policyengine-us last month",
      source: "pypistats.org",
    },
    features: [
      { title: "Research", body: "Analysis of enacted and proposed reforms, with the code behind every number." },
      { title: "Model", body: "Rules, parameters, variables, data, calibration and validation, all browsable." },
      { title: "API", body: "The same model behind a web API for benefit platforms and researchers." },
      { title: "Python", body: "pip install policyengine-us" },
    ],
    snapshot: {
      heading: "Latest research",
      note: "as shown on policyengine.org",
      rows: [
        ["Published", "Title"],
        ["Sep 18, 2026", "2025 Supplemental Poverty Measure: what Census reported, and what threshold growth did to it"],
        ["Sep 17, 2026", "FUTA taxable wage base dashboard"],
        ["Sep 15, 2026", "Child poverty impact dashboard"],
      ],
    },
    cta: "Enter the simulator",
    deep: { label: "The calculator, in the mock", href: "/suite/simulator/app" },
  },
  {
    slug: "forecasts",
    name: "Axiom Forecasts",
    today: {
      name: "Thesis",
      domain: "thesisinstitute.org",
      href: "https://thesisinstitute.org",
    },
    hue: "#A94E80",
    hueDark: "#C96B9C",
    noun: "scored forecasts",
    subject: "Scored forecasts",
    headline: "Open forecasts of public outcomes, scored against reality.",
    body:
      "Calibrated, open forecasts of the statistics and policies that shape public life. Every prediction carries its full chain of reasoning and gets scored against the record when the official number arrives. The track record is the product.",
    figure: {
      value: "37 of 47",
      label: "resolved forecasts inside their 80% interval",
      source: "app.thesisinstitute.org/log.json",
      asOf: "22 Sep 2026",
    },
    features: [
      {
        title: "Reasoning you can read",
        body: "Every forecast publishes its full chain of reasoning: the priors, the sources, and the drivers behind the number.",
      },
      {
        title: "Scored against reality",
        body: "When the official number lands, every forecast is graded. Calibration is public, per forecast and per agent.",
      },
      {
        title: "Open all the way down",
        body: "Open source, open data, open weights, open predictions.",
      },
    ],
    snapshot: {
      heading: "A forecast from the log",
      note: "as shown on thesisinstitute.org",
      rows: [
        ["Question", "Forecast", "80% interval", "Resolves"],
        ["SPM child poverty rate, 2025", "13.1%", "12.0% to 14.4%", "Sep 2026"],
      ],
    },
    cta: "Read the forecast log",
    deep: { label: "The log, in the mock", href: "/suite/forecasts/log" },
  },
  {
    // Founder's question (2026-09-23): what would an Axiom Evals line look
    // like with PolicyBench as one of several benchmarks? Benchmark copy and
    // figures are each benchmark's own live site (policybench.org,
    // encodebench.org) or repo description (PolicyBench Draft, private);
    // the headline and body are written for the mock.
    slug: "evals",
    name: "Axiom Evals",
    today: {
      name: "PolicyBench",
      domain: "policybench.org",
      href: "https://policybench.org",
    },
    hue: "#6B4E9B",
    hueDark: "#A78BDA",
    noun: "benchmarks of AI on law",
    subject: "AI benchmarks",
    headline: "Can a model compute the law, write it, and draft it?",
    body:
      "Benchmarks that test AI models on the law itself: calculating a household's taxes and benefits, turning a statute into executable rules, and doing a legislative drafter's work. Headline scores come from deterministic checks against a reference.",
    figure: {
      value: "89.2%",
      label: "best exact-match score among 39 models on PolicyBench",
      source: "policybench.org",
      asOf: "23 Sep 2026",
    },
    features: BENCHMARKS,
    snapshot: POLICYBENCH_TOP_FIVE,
    cta: "See the board",
    deep: { label: "EncodeBench", href: "https://encodebench.org" },
  },
];

/** Two answers to "where does PolicyBench live?": its own Axiom Evals line
 *  (default), or inside Axiom Rules, where each line hosts the benchmarks of
 *  AI on its own subject (NEXT_PUBLIC_SUITE_VARIANT=pb-in-rules). */
export const SUITE_VARIANT =
  process.env.NEXT_PUBLIC_SUITE_VARIANT === "pb-in-rules" ? "pb-in-rules" : "evals-line";

const VARIANT_LINES: Omit<SuiteLine, "forAll">[] =
  SUITE_VARIANT === "pb-in-rules"
    ? LINES.filter((line) => line.slug !== "evals").map((line) =>
        line.slug === "rules"
          ? {
              ...line,
              body: `${line.body} Its benchmarks test how well AI models compute the law, write it as code, and draft it.`,
              benchmarks: BENCHMARKS,
              snapshot: POLICYBENCH_TOP_FIVE,
            }
          : line,
      )
    : LINES;

export const SUITE_LINES: SuiteLine[] = VARIANT_LINES.map((line) => ({
  ...line,
  forAll: `${line.subject} for all.`,
}));

export function suiteLine(slug: string): SuiteLine | undefined {
  return SUITE_LINES.find((line) => line.slug === slug);
}
