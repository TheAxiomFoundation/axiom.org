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
    "The rules that decide who gets food assistance, health coverage, and tax credits live in closed code that no one outside the vendor can check. The Axiom Foundation publishes those rules in the open — cited, computable, and verified.",
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
 * Sources for the three cards, read 2026-10-03. The PDF makes the same claims.
 *
 * Encode
 * - Citations: axiom-oracles dashboard/public/data/rule_verification.json
 *   (rulespec-us 54d90a72, generated 2026-09-28): 34,781 of 34,810 rules
 *   carry a `source` citation (`has_source_citation`).
 * - Effective dates: axiom-rules-engine src/rulespec.rs fails a rule version
 *   with no start date (RuleSpecError::MissingEffectiveFrom). Waived modules
 *   skip the compile step in CI, so the card makes no "every" claim.
 * - Not claimed: that the pipeline records each encoding decision with its
 *   source text. The apply manifest records hashes, and the traces it points
 *   to stay on the machine that ran the encoder.
 *
 * Verify
 * - Gate: rulespec-us requires one status check, `validate / validate`
 *   (branch protection, read 2026-10-03). It runs the shared workflow
 *   TheAxiomFoundation/.github validate-rulespec.yml@df2dfb53, which compiles
 *   and validates each changed module and runs its companion tests and proof
 *   checks. That check runs no AI reviewer and compares nothing with an
 *   oracle.
 * - Waivers: the same workflow skips validation, companion tests and proof
 *   checks for any module with an `active` entry in rulespec-us
 *   known-validation-gaps.yaml. At 2066cef61 (2026-10-02) 1,940 modules had
 *   one (3 more entries were pending only, which don't skip); joined to the
 *   2026-09-28 rule_verification.json they hold 23,735 of 34,810 rules,
 *   11,201 of them the generated tariff schedule. Each names an owner, an
 *   issue and an expiry date.
 * - Admins: branch protection exempts them (enforcement_level non_admins),
 *   and they have used it: rulespec-us#1364 merged 2026-09-14T19:00:01Z
 *   while its required `validate / validate` was still running; the check
 *   finished as a failure at 19:22.
 * - Tests: axiom-encode 6f08e25c src/axiom_encode/harness/evals.py
 *   10642-10656 asks one model response for the RuleSpec file and its test
 *   cases, expected outputs included. That is why "never grades its own
 *   work" is gone.
 * - Comparisons: axiom-oracles dashboard/public/data/
 *   rule_verification_summary.json (2026-09-28): 14,030 of 34,810 rules sit
 *   on a program surface a live comparison exercises, so 20,780 have none.
 *   The flag is per program surface: the public file says which rules fall
 *   in covered programs and is silent on which rules were compared. Comparisons
 *   don't gate merges: the required check runs without --oracle, and the
 *   14,952 outputs in rulespec-us oracle-coverage-pending.yaml pass it.
 *   SNAP's is the only quality-control file any comparison reads.
 * - Disclosure: Max Ghenis is CEO of both Axiom and PolicyEngine
 *   (policyengine.org/us/team). Name PolicyEngine only with that sentence;
 *   name TAXSIM only with "the TAXSIM executable that PolicyEngine packages"
 *   (axiom-oracles axiom_oracles/adapters/taxsim/pins.py).
 *
 * Publish
 * - The section reader (src/components/axiom/section/section-reader.tsx)
 *   shows provision text beside its encoding and links to the program's
 *   graph. Its "Verified" chip comes from the engines a parity case declares
 *   (listParityCases in src/lib/axiom/runtime/api.ts), not from a result, so
 *   the card does not promise a validation record.
 */
export const WHAT_WE_DO: readonly DoCard[] = [
  {
    n: "1",
    label: "Encode",
    title: "We turn the law into software",
    body:
      "An encoder pipeline reads a statute and drafts its encoding in RuleSpec, the Axiom Foundation's format for computable law. Rules cite their source (34,781 of our 34,810 US rules in September 2026), and rule versions carry the dates they take effect.",
  },
  {
    n: "2",
    label: "Verify",
    title: "Automated checks gate what merges",
    body:
      "A draft encoding must compile and pass its test suite before it merges, unless its module has an active waiver on a public list (1,940 modules holding 23,735 of our 34,810 US rules on October 2, 2026). Repository admins can override the check. When the encoder drafts a module, it writes those tests too. Separately, we compare results with other calculators, including PolicyEngine, and publish the comparisons. They don't gate merges, and 20,780 of the 34,810 rules had none in September 2026. Max Ghenis is CEO of both Axiom and PolicyEngine.",
  },
  {
    n: "3",
    label: "Publish",
    title: "We put the whole chain in public",
    body:
      "In the Axiom App, you read the statute next to the RuleSpec encoding that runs it and can follow a program into its computation graph. Everything is openly licensed, which means a claim about what a rule computes is something you can check.",
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
      "Every level of government rebuilds the same rules separately: states re-implement SNAP, Medicaid, and TANF inside vendor systems, agencies write regulations that contractors interpret privately, and oversight reads prose while the operative logic sits in code nobody in government can open. The Axiom Foundation publishes the rules once — cited, dated, and verified — so delivery systems, vendors, auditors, and the people who write the laws all work from the same open source of truth.",
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
