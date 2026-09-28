/**
 * Copy for the one-page overview (/overview).
 *
 * Content lives here rather than inline in the components so the same
 * strings can be diffed against the print/PDF source in `pdf/overview/`
 * when either side changes. Every claim traces to the launch Message
 * House; the standing guardrails apply — "the Axiom Foundation" in full,
 * scoped coverage language, no funder or government partner names, no
 * API or compiler date promises, no stat without its scope and date.
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

export const WHAT_WE_DO: readonly DoCard[] = [
  {
    n: "1",
    label: "Encode",
    title: "We turn the law into software",
    body:
      "An encoder pipeline reads a statute and drafts its encoding in RuleSpec, the Axiom Foundation's format for computable law. Every value cites its authority, every clause carries its effective dates, and the pipeline records each encoding decision alongside the source text it came from.",
  },
  {
    n: "2",
    label: "Verify",
    title: "A deterministic gauntlet decides what ships",
    body:
      "Each draft encoding must compile and pass its test suite before it merges. Oracles cross-check results against external engines and datasets — PolicyEngine, TAXSIM, and program quality-control data — so the model that wrote the rules never grades its own work.",
  },
  {
    n: "3",
    label: "Publish",
    title: "We put the whole chain in public",
    body:
      "The Axiom App holds the source document, the RuleSpec encoding, the validation record, and the computation graph in one place, so you can read the statute next to the code that runs it. Everything is openly licensed, which means a claim about what a rule computes is something you can check.",
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
      "Policy research re-implements the tax-and-transfer system one paper at a time, which makes results hard to compare and harder to reproduce. The Axiom Foundation publishes the rules as effective-dated, executable encodings cross-checked against PolicyEngine and TAXSIM, and the computation graph becomes analyzable data in its own right.",
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
  "The Axiom Foundation is a fiscally sponsored project of the PSL Foundation.";
