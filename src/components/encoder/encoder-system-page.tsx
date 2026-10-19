"use client";

import Link from "next/link";
import { useState } from "react";
import CodeBlock from "@/components/code-block";
import { axiomAppHref } from "@/lib/urls";
import {
  ArrowRightIcon,
  CheckIcon,
  CodeIcon,
  CpuIcon,
  FileIcon,
  FolderIcon,
  ImportIcon,
  ParameterIcon,
  TargetIcon,
  TerminalIcon,
  TestIcon,
  VersionIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons";

type SnippetLanguage = "xml" | "python" | "yaml" | "catala" | "plain";

type PipelineStage = {
  id: string;
  step: string;
  title: string;
  summary: string;
  details: string[];
  checks: string[];
  outputs: string[];
  snippetLabel: string;
  snippetLanguage: SnippetLanguage;
  snippet: string;
  icon: React.ReactNode;
};

type Guardrail = {
  id: string;
  label: string;
  symptom: string;
  fix: string;
  catches: string[];
  recentExample: string;
};

type ArtifactPanel = {
  id: string;
  label: string;
  summary: string;
  language: SnippetLanguage;
  code: string;
};

type ProofPoint = {
  id: string;
  label: string;
  summary: string;
};

const pipelineStages: PipelineStage[] = [
  {
    id: "ingest",
    step: "01",
    title: "Ingest official source text first",
    summary:
      "Encoder starts from real source documents, exact section identifiers, and copied slices. The source layer is never stubbed.",
    details: [
      "Official PDFs, HTML, source XML, and exact source slices are pulled into the workspace before generation.",
      "Benchmarks point at concrete section ids or slice ids, not free-form prompts.",
      "This is what lets us say a later failure is a harness issue rather than a source-drift issue.",
    ],
    checks: [
      "Source id resolves to a concrete file or source XML eId",
      "Exact slice copied into ./source.txt",
      "No fake source placeholders",
    ],
    outputs: ["source.txt", "context-manifest.json", "allow-context bundle"],
    snippetLabel: "source slice",
    snippetLanguage: "xml",
    snippet: `<section eId="regulation-13">
  <num>13.</num>
  <content>
    <p>If the claimant's benefit is less than 10 pence per week,
    the amount shall be rounded up to 10 pence per week.</p>
  </content>
</section>`,
    icon: <FileIcon className="w-5 h-5" />,
  },
  {
    id: "workspace",
    step: "02",
    title: "Build an eval workspace around the slice",
    summary:
      "The harness copies nearby context, resolved definitions, and canonical concepts into a temporary workspace so the model sees the same dependency graph the validator sees.",
    details: [
      "Resolved defined terms and nearby canonical concepts are hydrated into the workspace before generation.",
      "A benchmark manifest controls runner, mode, context allowlist, and readiness gates.",
      "Local runs can swap GPT backends between Codex and OpenAI without rewriting the manifest.",
    ],
    checks: [
      "Definition imports are materialized into the workspace",
      "Context manifest is written before generation",
      "Runner backend is recorded for the case",
    ],
    outputs: ["workspace root", "resolved definition stubs", "copied canonical concepts"],
    snippetLabel: "suite manifest",
    snippetLanguage: "yaml",
    snippet: `name: UK wave 19 scale seed
runners:
  - openai:gpt-5.4
mode: cold
gates:
  min_compile_pass_rate: 1.0
  min_ci_pass_rate: 1.0
  min_zero_ungrounded_rate: 1.0
  min_generalist_review_pass_rate: 1.0`,
    icon: <FolderIcon className="w-5 h-5" />,
  },
  {
    id: "generate",
    step: "03",
    title: "Generate RuleSpec against explicit harness rules",
    summary:
      "The encoder prompt is not just 'translate this law.' It carries the current policy for numeric grounding, imports, branch naming, tests, and conditional leaf behavior.",
    details: [
      "Atomic slices are told when to preserve lead-in conjuncts and when to expose branch-specific outputs.",
      "Named scalar reuse is enforced: declared numbers must be reused in formulas, not just restated inline.",
      "Conditional amount leaves are told to return zero or false outside the applicable branch.",
    ],
    checks: [
      "Named scalar definitions for substantive numbers",
      "Canonical imports for defined terms when available",
      "Companion .yaml.test emitted with applicability cases",
    ],
    outputs: [".yaml", ".yaml.test", "trace json", "token usage"],
    snippetLabel: "generated leaf shape",
    snippetLanguage: "yaml",
    snippet: `variation_determination_period_months:
  from 2025-03-31: 12
  entity: Person
  period: Month
  dtype: Count

assessed_income_period_satisfied:
  entity: Person
  period: Month
  dtype: Boolean
  formula: |
    variation_determination_period_months == 12`,
    icon: <CodeIcon className="w-5 h-5" />,
  },
  {
    id: "ci",
    step: "04",
    title: "Run deterministic CI, not just compilation",
    summary:
      "This is the layer we hardened most aggressively over the past few weeks. It catches structural failures before oracles and reviewers spend time on them.",
    details: [
      "We validate compileability, companion tests, embedded scalar literals, numeric occurrence coverage, date-scalar pathologies, and import discipline.",
      "In rulespec-us, CI skips validation, companion tests, and proof checks for modules on a public waiver list: 1,940 modules on October 2, 2026, holding 23,735 of our 34,810 US rules.",
      "Promoted stub files are blocked when the official source is already ingested.",
      "CI also normalizes and checks test shape, including period formats and mapping-style YAML.",
    ],
    checks: [
      "compile",
      "RuleSpec test harness",
      "embedded scalar detector",
      "numeric occurrence coverage",
      "decomposed date scalar rejection",
      "no promoted stubs when source exists",
    ],
    outputs: ["deterministic issues", "grounding metrics", "numeric occurrence counts"],
    snippetLabel: "deterministic findings",
    snippetLanguage: "plain",
    snippet: `CI issues
- Embedded scalar literal: assessed_income_period_satisfied line 41 embeds 12
- Missing source numeric occurrence: repeated 55% represented only once
- Promoted stub blocked: official source already ingested for import target`,
    icon: <TestIcon className="w-5 h-5" />,
  },
  {
    id: "oracles",
    step: "05",
    title: "Run external oracles where they exist",
    summary:
      "For some domains, the harness compares generated outputs against existing tax and benefits engines before a reviewer sees the file.",
    details: [
      "PolicyEngine and TAXSIM results are treated as comparison evidence, not the sole truth source.",
      "Oracle discrepancies become context for later LLM review rather than staying as raw pass-fail noise.",
      "Suites can run with no oracle, PolicyEngine only, or all available oracles.",
    ],
    checks: [
      "policyengine pass / score",
      "taxsim pass / score",
      "oracle issues attached to case output",
    ],
    outputs: ["oracle scores", "discrepancy notes", "comparison context for review"],
    snippetLabel: "summary excerpt",
    snippetLanguage: "plain",
    snippet: `{
  "policyengine_pass_rate": 1.0,
  "mean_policyengine_score": 0.94,
  "taxsim_pass_rate": null
}`,
    icon: <TargetIcon className="w-5 h-5" />,
  },
  {
    id: "review",
    step: "06",
    title: "Gate on broad statutory-fidelity review",
    summary:
      "The generalist reviewer is now mandatory for eval suites. It looks for semantic compression, dropped conditions, bad imports, and fake factual predicates.",
    details: [
      "Blocking and non-blocking issues are separated so promotion gates only react to substantive defects.",
      "This is how we caught branch errors like material implication instead of conjunction, or dropped lead-in conjuncts.",
      "Recent work focused on slice-aware review so atomic branch leaves are judged against the right source target.",
    ],
    checks: [
      "generalist_review_pass",
      "generalist_review_score",
      "blocking vs non-blocking issue split",
    ],
    outputs: ["review JSON", "blocking issues", "score"],
    snippetLabel: "review output",
    snippetLanguage: "plain",
    snippet: `{
  "score": 8.4,
  "passed": true,
  "blocking_issues": [],
  "non_blocking_issues": [
    "Could import nearby canonical concept instead of local helper"
  ]
}`,
    icon: <CpuIcon className="w-5 h-5" />,
  },
  {
    id: "gates",
    step: "07",
    title: "Compute a suite-level readiness verdict",
    summary:
      "Individual cases are not enough. The harness computes suite-wide readiness using explicit thresholds for success, CI, grounding, review, and cost, then uses those same files as evidence for later outer-loop tuning.",
    details: [
      "A suite only becomes READY when its gates clear together, not when a few hand-picked leaves look good.",
      "We now persist top-level run files even for interrupted or failing runs so harness changes are justified by evidence.",
      "That lets us use failed runs as part of the engineering record instead of losing them in tmp output.",
    ],
    checks: [
      "min_cases",
      "min_success_rate",
      "min_compile_pass_rate",
      "min_ci_pass_rate",
      "min_zero_ungrounded_rate",
      "min_generalist_review_pass_rate",
      "max_mean_estimated_cost_usd",
    ],
    outputs: ["READY / NOT READY", "summary.json", "suite-run.json", "suite-results.jsonl"],
    snippetLabel: "readiness gates",
    snippetLanguage: "plain",
    snippet: `{
  "ready": true,
  "cases": 25,
  "success_rate": 1.0,
  "compile_pass_rate": 1.0,
  "ci_pass_rate": 1.0,
  "zero_ungrounded_rate": 1.0,
  "generalist_review_pass_rate": 1.0
}`,
    icon: <ParameterIcon className="w-5 h-5" />,
  },
  {
    id: "promote",
    step: "08",
    title: "Promote with provenance, then sync Axiom",
    summary:
      "A successful suite is still not the end. Promotion records wave manifests, repo versions, and source lineage so the resulting corpus is auditable.",
    details: [
      "UK and Colorado now use wave manifests to record file sets, dates, commits, source eval runs, and provenance tier.",
      "The latest UK promotion added 55 regulation 15 leaves and brought the checked-in corpus to 146 RuleSpec files.",
      "Axiom sync is downstream of validated corpus state, not the source of truth, and the UK replace-mode delete path now works without append-only fallback.",
    ],
    checks: [
      "wave manifest present",
      "changed files listed in manifest",
      "repo validators pass before sync",
    ],
    outputs: ["manifest.json", "rulespec repo state", "Axiom rule tree"],
    snippetLabel: "wave manifest",
    snippetLanguage: "plain",
    snippet: `{
  "wave": "2026-04-03-wave4",
  "provenance_tier": "manual_repo_change",
  "files": [
    "regulation/9-CCR-2503-6/3.606.1/K.yaml",
    "statute/crs/26-2-703/10.5.yaml"
  ]
}`,
    icon: <VersionIcon className="w-5 h-5" />,
  },
];

const recentProofPoints: ProofPoint[] = [
  {
    id: "autoresearch",
    label: "Accepted autoresearch mutation",
    summary:
      "The first kept outer-loop prompt mutation fixed claimant-or-partner disjunction handling and improved training score from 73.978 to 99.979 without regressing the separate final-review holdout.",
  },
  {
    id: "wave20",
    label: "55-case UK bulk wave promoted",
    summary:
      "Wave 20 cleared the real scale gate, then landed 55 new Pension Credit regulation 15 leaves in rulespec-uk.",
  },
  {
    id: "corpus",
    label: "Current UK corpus state",
    summary:
      "The promoted UK repo now has 146 RuleSpec files, companion tests complete, zero embedded scalar violations, and zero numeric-occurrence backlog.",
  },
  {
    id: "sync",
    label: "Replace-mode Axiom sync repaired",
    summary:
      "UK sync no longer depends on append-only recovery. Managed uk/legislation rows are deleted and republished in normal mode.",
  },
];

const guardrails: Guardrail[] = [
  {
    id: "numbers",
    label: "Repeated numbers must all appear as named scalars",
    symptom:
      "A source said 55% twice or repeated a threshold amount, but the RuleSpec collapsed it into a single generic helper.",
    fix:
      "Numeric occurrence coverage now counts substantive source-number repeats and fails when the RuleSpec under-represents them.",
    catches: [
      "numeric occurrence coverage",
      "named scalar occurrence extraction",
      "repo baseline audit in rulespec-uk and rulespec-us",
    ],
    recentExample: "UC taper rate and repeated UK benefit thresholds",
  },
  {
    id: "embedded",
    label: "No embedded scalar literals inside formulas",
    symptom:
      "The model declared a named scalar, then still wrote raw 12 or 20 inside the formula body.",
    fix:
      "Deterministic CI now treats embedded scalar literals as failures and the encoder prompt explicitly requires reuse of declared scalars.",
    catches: ["embedded scalar detector", "scalar reuse prompt rule"],
    recentExample: "wave 18 assessed income period month comparison",
  },
  {
    id: "dates",
    label: "Reject fake date-part and offset scalars",
    symptom:
      "The model decomposed a legal date into invented year, month, day, or offset variables that were not substantive policy values.",
    fix:
      "Validator rules now reject decomposed date scalars while exempting genuine temporal entries and quoted strings.",
    catches: ["date decomposition rejection", "quoted-string numeric exemption"],
    recentExample: "UK effective-date and mixed-age couple repairs",
  },
  {
    id: "leadin",
    label: "Preserve binding lead-in conjuncts in branch slices",
    symptom:
      "An atomic branch leaf kept the final limb but dropped an explicit parent conjunct, changing the slice meaning.",
    fix:
      "UK branch guidance now distinguishes binding lead-in conjuncts from mere context, and the generalist reviewer is stricter on dropped conditions.",
    catches: ["slice-aware generalist review", "branch-slice prompt rules"],
    recentExample: "regulation 10(5A)(b) and regulation 10(4)(a)",
  },
  {
    id: "imports",
    label: "Import real defined terms instead of inventing local helpers",
    symptom:
      "A leaf used a legally defined term like mixed-age couple but encoded it as a local boolean helper.",
    fix:
      "The harness now resolves defined terms and nearby canonical concepts, materializes them into the workspace, and fails missing high-confidence imports.",
    catches: [
      "defined-term resolver",
      "canonical concept resolver",
      "missing import validator",
    ],
    recentExample: "UK regulation 7A importing State Pension Credit Act 2002 section 3ZA(3)",
  },
  {
    id: "stubs",
    label: "Only stub RuleSpec, and never after the source is ingested",
    symptom:
      "A dependency stayed as a stub even though the official source was already in the repo.",
    fix:
      "The orchestrator now refuses stub creation when source exists, and repo validation blocks promoted stubs or imports to those stubs.",
    catches: ["no promoted stubs", "source-ingested stub block", "repo validate_repo hooks"],
    recentExample: "Colorado and UK source-first dependency policy",
  },
  {
    id: "conditional",
    label: "Positive conditional leaves must fail closed",
    symptom:
      "Leaves like '20 pounds is disregarded if...' returned unconditional amounts or else: true outside the branch.",
    fix:
      "Conditional amount guidance now requires zero or false in the inapplicable case, and reviewers flag positive-condition leaves that do not use the condition.",
    catches: ["conditional leaf prompt rule", "generalist semantic review"],
    recentExample: "UK schedule VI paragraph 4 carve-out leaves",
  },
  {
    id: "ledger",
    label: "Keep failed runs, not just winning runs",
    symptom:
      "Harness changes were justified from memory because interrupted or failed suites did not leave durable top-level evidence.",
    fix:
      "Every eval-suite run now writes suite-run.json, suite-results.jsonl, results.json, and summary.json while the run is live.",
    catches: ["durable run ledger", "top-level suite files", "partial progress persistence"],
    recentExample: "wave 19 pence-threshold repair trail",
  },
  {
    id: "holdout",
    label: "Do not keep prompt mutations without a holdout check",
    symptom:
      "An outer-loop prompt change can improve a narrow repair suite while quietly making other semantic cases worse.",
    fix:
      "Autoresearch now scores candidates on frozen training manifests and only keeps them when they improve training without regressing a separate final-review holdout.",
    catches: [
      "outer-loop training baseline",
      "final-review holdout baseline",
      "decision.json keep / discard gate",
    ],
    recentExample: "accepted claimant-or-partner disjunction mutation",
  },
];

const artifactPanels: ArtifactPanel[] = [
  {
    id: "suite-run",
    label: "suite-run.json",
    summary:
      "Live run state, runner metadata, progress counts, and current status. Updated while the suite is running.",
    language: "plain",
    code: `{
  "name": "UK wave 20 bulk seed",
  "runner_backend": "codex",
  "status": "completed",
  "cases_total": 55,
  "cases_completed": 55,
  "started_at": "2026-04-08T00:12:44Z"
}`,
  },
  {
    id: "results-jsonl",
    label: "suite-results.jsonl",
    summary:
      "Append-only per-case ledger. This is what preserves evidence when a suite is interrupted or stopped for a harness fix.",
    language: "plain",
    code: `{"case":"regulation-13","success":true,"compile_pass":false,"ci_pass":false}
{"case":"regulation-13A-3-b","success":true,"compile_pass":true,"ci_pass":false}
{"case":"regulation-13B-1-e","success":true,"compile_pass":true,"generalist_review_pass":false}`,
  },
  {
    id: "summary",
    label: "summary.json",
    summary:
      "Top-level verdict and aggregate metrics. This is the file the readiness gate and later paper-style reporting lean on.",
    language: "plain",
    code: `{
  "ready": true,
  "cases": 55,
  "success_rate": 1.0,
  "compile_pass_rate": 1.0,
  "ci_pass_rate": 1.0,
  "zero_ungrounded_rate": 1.0,
  "generalist_review_pass_rate": 1.0,
  "mean_generalist_review_score": 8.6875
}`,
  },
  {
    id: "decision",
    label: "autoresearch decision.json",
    summary:
      "Outer-loop keep or discard record. This is how prompt changes are justified instead of being accepted from intuition.",
    language: "plain",
    code: `{
  "kept": true,
  "reason": "candidate_improved_training_and_preserved_final_review",
  "baseline_training_score": 73.978195,
  "candidate_training_score": 99.978679,
  "baseline_final_review_score": 99.976074,
  "candidate_final_review_score": 99.976753
}`,
  },
  {
    id: "manifest",
    label: "benchmark manifest",
    summary:
      "Declarative suite definition. Cases and gates are already spec-driven, even though most guardrails still live in Python.",
    language: "yaml",
    code: `name: UK wave 18 soak
runners:
  - openai:gpt-5.4
gates:
  min_ci_pass_rate: 1.0
  min_zero_ungrounded_rate: 1.0
  min_generalist_review_pass_rate: 1.0
cases:
  - kind: uk_legislation
    name: regulation-10-1-a
    section_eid: regulation-10-1-a`,
  },
  {
    id: "wave",
    label: "wave manifest",
    summary:
      "Promotion-time provenance: which files landed, when, under which repo revision and provenance tier.",
    language: "plain",
    code: `{
  "wave": "2026-04-08-wave18",
  "repo": "rulespec-uk",
  "provenance_tier": "benchmarked_promotion",
  "file_count": 55,
  "runner": "codex-gpt-5.4",
  "encoder_commit": "d4114bd",
  "all_ready": true
}`,
  },
];

const stageStats = [
  { label: "stages", value: `${pipelineStages.length}` },
  { label: "recent guardrails", value: `${guardrails.length}` },
  { label: "run ledgers", value: `${artifactPanels.length}` },
  { label: "hard readiness gates", value: "7" },
];

export function EncoderSystemPage() {
  const [selectedStageId, setSelectedStageId] = useState(pipelineStages[0].id);
  const [selectedGuardrailId, setSelectedGuardrailId] = useState(guardrails[0].id);
  const [selectedArtifactId, setSelectedArtifactId] = useState(artifactPanels[0].id);

  const selectedStage =
    pipelineStages.find((stage) => stage.id === selectedStageId) ?? pipelineStages[0];
  const selectedGuardrail =
    guardrails.find((guardrail) => guardrail.id === selectedGuardrailId) ?? guardrails[0];
  const selectedArtifact =
    artifactPanels.find((artifact) => artifact.id === selectedArtifactId) ?? artifactPanels[0];

  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[1280px] mx-auto">
        <header className="mb-20">
          <div className="flex flex-wrap items-start justify-between gap-8 mb-10">
            <div className="max-w-[760px]">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)] mb-4">
                Encoder system map
              </p>
              <h1 className="heading-page mb-6">
                How the harness actually works
              </h1>
              <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed">
                This is the operational path from official source text to a
                promoted RuleSpec file. It includes the deterministic CI checks,
                semantic review gates, import discipline, run ledgers,
                provenance controls, and the new outer-loop autoresearch gate
                that only keeps prompt mutations when they beat a separate
                holdout.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <a href={axiomAppHref()} className="btn-primary">
                Inspect encoding records in Axiom
                <ArrowRightIcon className="w-5 h-5" />
              </a>
              <Link href="/stack" className="btn-outline">
                View broader technical stack
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
            {stageStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-5"
              >
                <div className="font-mono text-2xl text-[var(--color-ink)] mb-1">
                  {stat.value}
                </div>
                <div className="font-body text-sm text-[var(--color-ink-secondary)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </header>

        <section className="mb-24">
          <div className="flex items-end justify-between gap-6 mb-8 max-md:flex-col max-md:items-start">
            <div>
              <h2 className="heading-section mb-3">
                Recent proof points
              </h2>
              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
                The page is still curated, but these are current system facts
                rather than generic claims. They are the shortest path to what
                actually changed this week.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-4 py-2 font-mono text-xs text-[var(--color-ink-muted)]">
              <CheckIcon size={14} />
              current as of wave 20 promotion
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {recentProofPoints.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-5"
              >
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-3">
                  {item.label}
                </p>
                <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                  {item.summary}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-end justify-between gap-6 mb-8 max-md:flex-col max-md:items-start">
            <div>
              <h2 className="heading-section mb-3">
                Pipeline explorer
              </h2>
              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[720px] leading-relaxed">
                Each stage below maps to something concrete in the current
                harness: code in the repo, files in the eval workspace, and a
                measurable pass-fail outcome.
              </p>
            </div>
            <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
              Click a stage for details
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 mb-8">
              {pipelineStages.map((stage) => {
                const active = stage.id === selectedStage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => setSelectedStageId(stage.id)}
                    aria-pressed={active}
                    className={`text-left rounded-md border px-4 py-4 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-paper-elevated)] shadow-[0_10px_30px_rgba(26,122,109,0.08)]"
                      : "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
                    }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-[var(--color-accent)]">{stage.icon}</span>
                    <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                      {stage.step}
                    </span>
                  </div>
                  <div className="font-body text-[0.95rem] text-[var(--color-ink)] leading-tight">
                    {stage.title}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)] gap-8 max-lg:grid-cols-1">
            <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)] flex items-center justify-center">
                  {selectedStage.icon}
                </div>
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-accent)]">
                    Stage {selectedStage.step}
                  </p>
                  <h3 className="font-body text-2xl text-[var(--color-ink)]">
                    {selectedStage.title}
                  </h3>
                </div>
              </div>

              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
                {selectedStage.summary}
              </p>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div>
                  <h4 className="font-body text-lg text-[var(--color-ink)] mb-3">
                    What happens here
                  </h4>
                  <div className="flex flex-col gap-3">
                    {selectedStage.details.map((detail) => (
                      <div
                        key={detail}
                        className="flex items-start gap-3 font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed"
                      >
                        <CheckIcon className="w-4 h-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                        <span>{detail}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-body text-lg text-[var(--color-ink)] mb-3">
                    Checks and outputs
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="rounded-md bg-[var(--color-paper)] border border-[var(--color-rule)] p-4">
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                        checks
                      </p>
                      <div className="flex flex-col gap-2">
                        {selectedStage.checks.map((check) => (
                          <div
                            key={check}
                            className="flex items-start gap-2 font-body text-sm text-[var(--color-ink-secondary)]"
                          >
                            <CheckIcon className="w-4 h-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                            <span>{check}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-md bg-[var(--color-paper)] border border-[var(--color-rule)] p-4">
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                        outputs
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedStage.outputs.map((output) => (
                          <span
                            key={output}
                            className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1 font-mono text-xs text-[var(--color-code-text)]"
                          >
                            {output}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-code-bg)] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2826]">
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                <span className="font-mono text-xs text-[var(--color-code-text)]">
                  {selectedStage.snippetLabel}
                </span>
              </div>
              <CodeBlock
                code={selectedStage.snippet}
                language={selectedStage.snippetLanguage}
                className="m-0 p-6 font-mono text-[0.82rem] leading-7 whitespace-pre-wrap text-[var(--color-code-text)]"
              />
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-end justify-between gap-6 mb-8 max-md:flex-col max-md:items-start">
            <div>
              <h2 className="heading-section mb-3">
                Failure pattern browser
              </h2>
              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
                These are real failure classes from recent UK, US, and Colorado
                work. Each one maps to a concrete harness or repo validator
                change. Axiom is where per-rule encoding records and agent logs
                are meant to be inspected, while autoresearch sits one level up
                and decides whether prompt-surface changes should be kept at
                all.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-4 py-2 font-mono text-xs text-[var(--color-ink-muted)]">
              <WarningIcon size={14} />
              guardrails added from live failures
            </div>
          </div>

          <div className="grid grid-cols-[minmax(260px,0.9fr)_minmax(0,1.2fr)] gap-8 max-lg:grid-cols-1">
            <div className="flex flex-col gap-3">
              {guardrails.map((guardrail) => {
                const active = guardrail.id === selectedGuardrail.id;
                return (
                  <button
                    key={guardrail.id}
                    type="button"
                    onClick={() => setSelectedGuardrailId(guardrail.id)}
                    aria-pressed={active}
                    className={`text-left rounded-md border px-5 py-4 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-paper-elevated)]"
                      : "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <div className="font-body text-[0.98rem] text-[var(--color-ink)] mb-2">
                      {guardrail.label}
                    </div>
                    <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                      {guardrail.recentExample}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
              <h3 className="font-body text-2xl text-[var(--color-ink)] mb-4">
                {selectedGuardrail.label}
              </h3>

              <div className="grid grid-cols-1 gap-5">
                <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                  <div className="flex items-start gap-3">
                    <XIcon className="w-4 h-4 text-[#c2410c] mt-0.5 shrink-0" />
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-2">
                        failure mode
                      </p>
                      <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                        {selectedGuardrail.symptom}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                  <div className="flex items-start gap-3">
                    <CheckIcon className="w-4 h-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-2">
                        harness response
                      </p>
                      <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                        {selectedGuardrail.fix}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                    where it is enforced
                  </p>
                  <div className="flex flex-col gap-2">
                    {selectedGuardrail.catches.map((catchItem) => (
                      <div
                        key={catchItem}
                        className="flex items-start gap-2 font-body text-sm text-[var(--color-ink-secondary)]"
                      >
                        <TerminalIcon className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                        <span>{catchItem}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-code-bg)] p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-code-text)] mb-2">
                    recent example
                  </p>
                  <p className="font-body text-sm text-[var(--color-code-text)] leading-relaxed">
                    {selectedGuardrail.recentExample}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-6 mb-8 max-md:flex-col max-md:items-start">
            <div>
              <h2 className="heading-section mb-3">
                Run ledger and provenance files
              </h2>
              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
                The harness now produces enough structured output that this
                section can eventually be generated directly from exported
                metadata. Right now the artifact list is curated, but it now
                uses concrete current examples from the accepted autoresearch
                run and the latest UK bulk promotion rather than abstract file
                shapes. The actual per-encoding logs and RuleSpec records still
                belong in Axiom.
              </p>
            </div>
            <a href={axiomAppHref()} className="btn-outline">
              Open Axiom encoding views
            </a>
          </div>

          <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-6">
            <div className="flex flex-wrap gap-2 mb-6">
              {artifactPanels.map((artifact) => {
                const active = artifact.id === selectedArtifact.id;
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => setSelectedArtifactId(artifact.id)}
                    aria-pressed={active}
                    className={`rounded-full border px-4 py-2 font-mono text-xs transition-colors ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                      : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink-secondary)] hover:border-[var(--color-accent)]"
                    }`}
                  >
                    {artifact.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(360px,1.1fr)] gap-6 max-lg:grid-cols-1">
              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)] flex items-center justify-center">
                    <VersionIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-body text-xl text-[var(--color-ink)]">
                      {selectedArtifact.label}
                    </h3>
                    <p className="font-body text-sm text-[var(--color-ink-secondary)]">
                      {selectedArtifact.summary}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-start gap-3 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4">
                    <TerminalIcon className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                    <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                      These files make failed and interrupted runs auditable
                      instead of disposable.
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-4">
                    <ImportIcon className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                    <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                      Promotion-time wave manifests connect generated files back
                      to repo history, source snapshots, and provenance tier.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-code-bg)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2826]">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                  <span className="font-mono text-xs text-[var(--color-code-text)]">
                    {selectedArtifact.label}
                  </span>
                </div>
                <CodeBlock
                  code={selectedArtifact.code}
                  language={selectedArtifact.language}
                  className="m-0 p-6 font-mono text-[0.82rem] leading-7 whitespace-pre-wrap text-[var(--color-code-text)]"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
