import { ruleCoverageClause, sourceCitationClause, waiverCoverageClause } from "@/lib/verification-evidence";

/**
 * Copy for the one-page overview (/overview).
 *
 * Content lives here rather than inline in the components so the same
 * strings can be diffed against the print/PDF source in `pdf/overview/`
 * when either side changes. A claim about how the pipeline or its checks
 * work must trace to code, an enforced test, a schema or ledger, or a page
 * the code generates (axiom.org/verify, /validation), never to a messaging
 * document such as the Message House; the sources for the verification
 * copy sit next to WHAT_WE_DO. The standing guardrails apply — "the Axiom
 * Foundation" in full, scoped coverage language, no funder or government
 * partner names, no API or compiler date promises, no stat without its
 * scope and date. src/app/verification-claims.test.tsx renders this page
 * and reads the PDF source, and fails on the verification claims the code
 * does not support.
 */

export const OVERVIEW_PDF_PATH = "/Axiom-Foundation-Overview.pdf";
export const CONTACT_EMAIL = "hello@axiom.org";

/**
 * Hosted Mailchimp signup — the same list the "Get updates" link in the
 * axiom.org nav points at. Keeping the two in sync matters: a second list
 * would split the audience silently.
 */
export const SUBSCRIBE_URL =
  "https://axiom-foundation.us12.list-manage.com/subscribe?u=43b8282de112809c41a3cff2c&id=fbea2dd394";

export const SUBSCRIBE_BLURB =
  "Subscribe to updates from the Axiom Foundation — newsletters, product releases, research, and more.";

export const HERO = {
  title: "The Axiom Foundation Overview",
  /** The tagline sits under the page title rather than serving as it. */
  tagline: "Computable law for all.",
  lede:
    "The rules that decide who gets food assistance, health coverage, and tax credits live in closed code that no one outside the vendor can check. The Axiom Foundation publishes those rules in the open — cited and computable.",
} as const;

export const WHAT_WE_DO_INTRO =
  "The Axiom Foundation publishes open, machine-readable encodings of the world's rules, starting with tax and benefit policy. Statutes, regulations, and agency guidance become cited, time-aware, executable code that anyone can run, audit, or reform.";

export interface DoCard {
  n: string;
  /** Step name — mirrors the amber numbered steps in the PDF. */
  label: string;
  title: string;
  body: string;
}

/*
 * Evidence measured 2026-10-18. Numeric claims use verification-evidence.ts,
 * which pins the rulespec-us ledger/corpus and the oracle-generated coverage
 * map separately. A compared program surface does not establish a per-rule
 * comparison, so no subtraction is presented as "uncompared rules".
 *
 * Mechanisms, all code rather than messaging documents:
 * - axiom-encode 058d539ffb665973fa04c8a669fab942a83e49f6:
 *   src/axiom_encode/harness/evals.py (_build_rulespec_eval_prompt) requests RuleSpec and
 *   companion tests with expected outputs in the same model response;
 *   src/axiom_encode/cli.py (_stage_signed_apply_manifest and
 *   _MODEL_APPLY_MANIFEST_FIELDS) signs citation/model/file hashes at apply.
 * - rulespec-us d8511cca76b060e40fba90ae8af7f7643e6edf11:
 *   .github/workflows/repository-checks.yml pins shared validate-rulespec.yml at
 *   30e942938e675ae2b4a23b6154652592dcdc8065. It selects changed modules,
 *   excludes active waivers (and retired schemas), and runs validation and
 *   companion tests without oracle comparisons. This is not an exhaustive
 *   certification claim or a guarantee that every draft passes its tests.
 * - axiom-rules-engine 50215d97: src/rulespec.rs rejects rule versions without
 *   effective_from (MissingEffectiveFrom); waived modules skip CI compilation.
 * - App: src/components/axiom/section/section-reader.tsx renders provision
 *   text, encoding, and a program graph link. Its current comparison chip
 *   uses fresh matching results; the overview promises no validation record.
 * - PolicyEngine disclosure: policyengine.org/ca/team and /ca/donate;
 *   Axiom CEO: src/app/team/page.tsx. Reviewed 2026-10-18.
 *
 * Public links below expose the primary numeric and encoder evidence. The
 * print source links the same evidence from the relevant sentences.
 */
export const OVERVIEW_SOURCES = [
  { label: "CI workflow", href: "https://github.com/TheAxiomFoundation/.github/blob/30e942938e675ae2b4a23b6154652592dcdc8065/.github/workflows/validate-rulespec.yml" },
  { label: "Effective dates", href: "https://github.com/TheAxiomFoundation/axiom-rules-engine/blob/50215d97ce9b59467d4738b2e872d5253b6e2847/src/rulespec.rs" },
  { label: "App reader", href: "https://github.com/TheAxiomFoundation/axiom.org/blob/1f453a38b82f04e2e5bad071ebbb912941f53342/src/components/axiom/section/section-reader.tsx" },
  { label: "Waiver ledger", href: "https://github.com/TheAxiomFoundation/rulespec-us/blob/d8511cca76b060e40fba90ae8af7f7643e6edf11/known-validation-gaps.yaml" },
  { label: "Rule coverage", href: "https://github.com/TheAxiomFoundation/axiom-oracles/blob/002aa771247b8749c6b7b49ce7b7cc89f2016c8e/dashboard/public/data/rule_verification_summary.json" },
  { label: "Rule citations", href: "https://github.com/TheAxiomFoundation/axiom-oracles/blob/002aa771247b8749c6b7b49ce7b7cc89f2016c8e/dashboard/public/data/rule_verification.json" },
  { label: "Encoder tests", href: "https://github.com/TheAxiomFoundation/axiom-encode/blob/058d539ffb665973fa04c8a669fab942a83e49f6/src/axiom_encode/harness/evals.py" },
  { label: "Signed manifests", href: "https://github.com/TheAxiomFoundation/axiom-encode/blob/058d539ffb665973fa04c8a669fab942a83e49f6/src/axiom_encode/cli.py" },
] as const;

export const WHAT_WE_DO: readonly DoCard[] = [
  {
    n: "1",
    label: "Encode",
    title: "We turn the law into software",
    body:
      `The encoder drafts cited provisions in RuleSpec, the Axiom Foundation's format for computable law. ${sourceCitationClause()}. Rule versions carry the dates they take effect. Each time the encoder applies an encoding it leaves a signed manifest naming the source citation and the model.`,
  },
  {
    n: "2",
    label: "Verify",
    title: "Checks and waivers shape what merges",
    body:
      `CI runs compilation and companion tests for selected modules; active entries on the public waiver list skip those checks. ${waiverCoverageClause()}. When the encoder drafts a module, the model also writes its tests and expected results. Comparisons with other calculators, including PolicyEngine, are published separately and are not required by this CI workflow. ${ruleCoverageClause()}. Max Ghenis is CEO of both Axiom and PolicyEngine.`,
  },
  {
    n: "3",
    label: "Publish",
    title: "We publish inspectable encodings",
    body:
      "In the Axiom App, you read the statute next to the RuleSpec encoding that runs it and can follow a program into its computation graph. The encodings are openly licensed, so you can inspect what a rule computes.",
  },
] as const;

/**
 * Licence URLs for the fine-print line under "What we do". The split is real
 * and verified against the repos — the `rulespec-*` jurisdiction repos carry
 * CC BY 4.0, while the engine, encoder, oracles, and this site carry
 * MIT. The PDF states the same thing; keep them in step.
 */
export const LICENSE_LINKS = {
  encodings: "https://creativecommons.org/licenses/by/4.0/",
  code: "https://opensource.org/license/mit",
} as const;

export const WHAT_WE_ENABLE_INTRO =
  "Encoding the law once, in the open, means no one has to re-implement it privately. Four groups carry the work forward, and each one uses the same underlying layer.";

export interface Audience {
  id: string;
  tab: string;
  headline: string;
  body: string;
  useCase: string;
}

export const AUDIENCES: readonly Audience[] = [
  {
    id: "government",
    tab: "Government",
    headline: "Stop paying to re-implement the same rules",
    body:
      "Every level of government rebuilds the same rules separately: states re-implement SNAP, Medicaid, and TANF inside vendor systems, agencies write regulations that contractors interpret privately, and oversight reads prose while the operative logic sits in code nobody in government can open. The Axiom Foundation publishes the rules once — cited, dated, and executable — so delivery systems, vendors, auditors, and the people who write the laws all work from the same open source of truth.",
    useCase:
      "A state modernizing its eligibility system runs its current vendor logic against the Axiom Foundation's encodings as a test oracle, catches discrepancies before they become wrongful denials, and keeps a traceable line from the policy as passed to how each system implements it.",
  },
  {
    id: "ai-labs",
    tab: "AI labs",
    headline: "Make AI truthful about the law",
    body:
      "Models answer eligibility and tax questions at enormous volume, fluently and confidently, with no way for anyone to know whether the answer is right. The Axiom Foundation publishes the law as executable, cited code that a model can call instead of guess and cite instead of paraphrase, and that same corpus doubles as an evaluation set.",
    useCase:
      "A lab wires its assistant to compute benefits and tax answers from the encodings rather than recall them, attaches the statute citation to each response, and scores its unassisted answers against what the cited law actually computes.",
  },
  {
    id: "research",
    tab: "Research",
    headline: "A citable, executable corpus of law",
    body:
      "Policy research re-implements the tax-and-transfer system one paper at a time, which makes results hard to compare and harder to reproduce. The Axiom Foundation publishes the rules as effective-dated, executable encodings with a public file showing which rules fall in programs a comparison covers, and the computation graph becomes analyzable data in its own right.",
    useCase:
      "A team studying benefit cliffs runs household profiles directly against the encoded rules, citable to statute and comparable across papers; a second team maps cross-program interactions to find where cliffs compound.",
  },
  {
    id: "builders",
    tab: "Builders",
    headline: "Ground truth for the rules your product touches",
    body:
      "If your product touches taxes, benefits, or eligibility, someone on your team re-implemented law from prose and hoped. That rules layer is the hardest and least differentiated part of the stack, and the Axiom Foundation offers it as shared infrastructure so you build only what only you can build.",
    useCase:
      "A benefits screener retires its hand-maintained state SNAP rules and consumes the encoding instead, cutting maintenance work and giving navigators a statute-level citation to show the family in front of them.",
  },
] as const;

export const ORG_STATUS =
  "The Axiom Foundation is a fiscally sponsored project of the PSL Foundation, which also sponsors PolicyEngine.";
