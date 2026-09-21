/**
 * PROTOTYPE DATA — the "all Axiom" naming mock (branch suite-mock, never
 * merged). Copy on each line is taken from that program's own live
 * homepage on 2026-09-21; figures were read from the live sources named
 * in `figure.source` on the same day. Nothing here is a plan.
 */
export const SUITE_AS_OF = "21 Sep 2026";

export interface SuiteLine {
  slug: "rules" | "records" | "microcosm" | "simulator" | "forecasts";
  name: string;
  /** What the program is called today, and where it lives. */
  today: { name: string; domain: string; href: string };
  hue: string;
  hueDark: string;
  noun: string;
  forAll: string;
  headline: string;
  body: string;
  figure?: { value: string; label: string; source: string };
  features: { title: string; body: string }[];
  snapshot?: { heading: string; note: string; rows: string[][] };
  cta: string;
}

export const SUITE_LINES: SuiteLine[] = [
  {
    slug: "rules",
    name: "Axiom Rules",
    today: { name: "Axiom", domain: "axiom.org", href: "https://axiom.org" },
    hue: "#B45309",
    hueDark: "#D97706",
    noun: "rules",
    forAll: "Computable law for all.",
    headline: "Computable law for all.",
    body:
      "Open, machine-readable encodings of the world's rules, starting with tax and benefit policy. Cited, time-aware, and executable, so anyone can run, audit, or reform them.",
    figure: {
      value: "4,796",
      label: "RuleSpec encodings",
      source: "axiom.org/coverage",
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
    noun: "records",
    forAll: "The official record for all.",
    headline: "A record of what official sources printed, and when.",
    body:
      "Source-backed facts: the numbers government statistical agencies actually published, kept at first print, with provenance, revision history, and a stable address for every fact. Values are recorded as published, never reconciled, imputed, or modeled.",
    figure: {
      value: "39,173",
      label: "source-backed facts in the store",
      source: "chronicle.institute",
    },
    features: [
      {
        title: "Journal",
        body: "An append-only log of accepted facts, each with its first-print date and the date it was accepted.",
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
    noun: "synthetic population",
    forAll: "A population that stands in for all.",
    headline:
      "A nation is millions of people, households, and firms. We build a synthetic one that stands in for them all.",
    body:
      "A stack for constructing calibrated synthetic microdata from public survey and administrative data: realistic enough to model tax and benefit policy for everyone, private by construction, and improved in the open.",
    figure: {
      value: "15 Sep 2026",
      label: "latest US release",
      source: "huggingface.co/datasets/policyengine/populace-us",
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
    forAll: "Policy analysis for all.",
    headline:
      "Free, open-source tax and benefit analysis. Model policy reforms across all 50 states.",
    body:
      "Free, open-source tools to understand tax and benefit policies. Calculate your taxes and benefits, or analyze policy reforms. Trusted by researchers, governments, and benefit platforms.",
    figure: {
      value: "69,571",
      label: "downloads of policyengine-us last month",
      source: "pypistats.org",
    },
    features: [
      { title: "Research", body: "Analysis of enacted and proposed reforms, with the code behind every number." },
      { title: "Model", body: "Rules, parameters, variables, data, calibration and validation, all browsable." },
      { title: "API", body: "The same model behind a web API for benefit platforms and researchers." },
      { title: "Python", body: "pip install policyengine-us. The package name does not change in this universe." },
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
    forAll: "Forecasts scored for all to see.",
    headline: "Open forecasts of public outcomes, scored against reality.",
    body:
      "Calibrated, open forecasts of the statistics and policies that shape public life: every prediction published with its full chain of reasoning, and scored against the record when the official numbers arrive. The track record is the product.",
    figure: {
      value: "326",
      label: "forecasts on the log",
      source: "app.thesisinstitute.org/log.json",
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
  },
];

export function suiteLine(slug: string): SuiteLine | undefined {
  return SUITE_LINES.find((line) => line.slug === slug);
}
