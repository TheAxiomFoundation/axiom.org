"use client";

import Link from "next/link";
import { useState } from "react";
import CodeBlock from "@/components/code-block";
import { axiomAppHref } from "@/lib/urls";
import { layerTrust } from "@/lib/stack-trust";
import {
  ArrowRightIcon,
  CheckIcon,
  CodeIcon,
  CpuIcon,
  FileIcon,
  FolderIcon,
  ImportIcon,
  TargetIcon,
  TerminalIcon,
  VersionIcon,
  WarningIcon,
} from "@/components/icons";

type SnippetLanguage = "xml" | "python" | "yaml" | "catala" | "plain";

type StackLayer = {
  id: string;
  step: string;
  stageIds: string[];
  title: string;
  summary: string;
  details: string[];
  components: string[];
  repos: string[];
  outputs: string[];
  snippetLabel: string;
  snippetLanguage: SnippetLanguage;
  snippet: string;
  icon: React.ReactNode;
};

type RuntimeStage = {
  id: string;
  label: string;
  detail: string;
};

type RepoLane = {
  id: string;
  title: string;
  summary: string;
  repos: string[];
};

type JourneyArtifact = {
  id: string;
  stage: string;
  title: string;
  summary: string;
  href: string;
  linkLabel: string;
  previewLabel: string;
  preview: string;
};

const stackLayers: StackLayer[] = [
  {
    id: "scrape",
    step: "01",
    stageIds: ["input"],
    title: "Collect and archive official documents",
    summary:
      "Everything starts with real government material: statutes, regulations, manuals, guidance, PDFs, HTML, and XML snapshots.",
    details: [
      "Scrapers and source importers pull official documents into durable source trees before any encoding happens.",
      "We keep archived snapshots and exact source references so later harness changes can be tied back to stable inputs.",
      "This is the layer that distinguishes source acquisition from later encoding work.",
    ],
    components: [
      "official source fetchers",
      "archive snapshots",
      "source specs and converters",
    ],
    repos: ["axiom", "rulespec-uk", "rulespec-us", "rulespec-us-co"],
    outputs: ["official PDF and HTML snapshots", "source refs", "archived raw text"],
    snippetLabel: "source acquisition shape",
    snippetLanguage: "plain",
    snippet: `sources/
  official/
    uksi/2002/1792/2025-03-31/source.xml
    statute/crs/26-2-703/2026-04-03/source.html
  slices/
    9-CCR-2503-6/3.606.1/I.txt`,
    icon: <FileIcon className="w-5 h-5" />,
  },
  {
    id: "source-structure",
    step: "02",
    stageIds: ["input"],
    title: "Normalize source structure",
    summary:
      "Source normalization gives the system a structural representation of the law so later tools can target exact sections, paragraphs, and subparagraphs.",
    details: [
      "Documents are normalized into source XML or an equivalent tree with stable eIds and hierarchy.",
      "That structure is what lets us talk about `regulation-13B-1-b` or `section 3ZA(3)` as concrete targets instead of fuzzy spans.",
      "For policy manuals and state materials, this step is what makes non-statute sources feel like first-class inputs.",
    ],
    components: [
      "source XML normalization",
      "eId generation",
      "hierarchy extraction",
    ],
    repos: ["axiom", "rulespec-us-co"],
    outputs: ["source.xml", "source tree", "section and paragraph ids"],
    snippetLabel: "source XML slice",
    snippetLanguage: "xml",
    snippet: `<section eId="regulation-13B-1-b">
  <num>(b)</num>
  <content>
    <p>on the day of the week in respect of which the benefit is payable</p>
  </content>
</section>`,
    icon: <ImportIcon className="w-5 h-5" />,
  },
  {
    id: "source-graph",
    step: "03",
    stageIds: ["input"],
    title: "Build source trees and exact slices",
    summary:
      "Once the documents are structured, the stack can expose source trees, exact slices, and cross-document references to both humans and the harness.",
    details: [
      "The source graph feeds Axiom browsing, section-level deep links, and encoder workspaces.",
      "Exact slices are copied into local workspaces as `source.txt` so benchmark runs are reproducible and inspectable.",
      "This is also where canonical upstream homes exist before we decide whether a RuleSpec import should resolve to a real file or a temporary stub.",
    ],
    components: [
      "section selection",
      "slice extraction",
      "cross-reference resolution",
    ],
    repos: ["axiom", "axiom-encode"],
    outputs: ["source.txt", "context-manifest.json", "navigable source tree"],
    snippetLabel: "eval workspace context",
    snippetLanguage: "yaml",
    snippet: `source_ref: /uksi/2002/1792/2025-03-31
section_eid: schedule-VI-paragraph-4-3-a
context_files:
  - source.txt
  - context-manifest.json`,
    icon: <FolderIcon className="w-5 h-5" />,
  },
  {
    id: "rulespec",
    step: "04",
    stageIds: ["encode"],
    title: "Encode law into RuleSpec corpora",
    summary:
      "RuleSpec is the rules language and corpus layer. This is where statutes, regulations, and manuals become tested, versioned rule files.",
    details: [
      "The corpus repos hold `.yaml` files, companion tests, imports, wave manifests, and provenance policies.",
      "The point is not just DSL syntax; it is durable, reviewable legal source-to-rule mapping.",
      "This is where manual leaves, statute leaves, and cross-document imports eventually live side by side.",
    ],
    components: [
      ".yaml files",
      ".yaml.test files",
      "wave manifests",
      "import graph",
    ],
    repos: ["axiom-rules-engine", "rulespec-uk", "rulespec-us", "rulespec-us-co"],
    outputs: ["compileable rules", "tests", "provenance manifests"],
    snippetLabel: "RuleSpec leaf",
    snippetLanguage: "yaml",
    snippet: `format: rulespec/v1
rules:
  - name: claimant_or_partner_had_award_of_state_pension_credit
    kind: derived
    entity: Family
    period: Day
    dtype: Boolean
    versions:
      - effective_from: '2025-03-21'
        formula: |-
          claimant_had_award_of_state_pension_credit
          or (
            claimant_has_partner
            and partner_had_award_of_state_pension_credit
          )`,
    icon: <CodeIcon className="w-5 h-5" />,
  },
  {
    id: "encoder",
    step: "05",
    stageIds: ["encode", "check"],
    title: "Generate and evaluate with Encoder",
    summary:
      "Encoder is the harness layer: benchmark manifests, workspace construction, generation policy, deterministic CI, oracles, review, and readiness gates.",
    details: [
      "Encoder consumes exact slices and canonical context, then emits candidate `.yaml` and `.yaml.test` bundles.",
      "This is where numeric grounding, import discipline, semantic review, and suite-level readiness live.",
      "It is also where `autoresearch` can mutate a narrow prompt surface and optimize against frozen benchmark sets.",
    ],
    components: [
      "benchmark manifests",
      "workspace hydration",
      "deterministic CI",
      "generalist review",
      "autoresearch loop",
    ],
    repos: ["axiom-encode"],
    outputs: ["suite-run.json", "summary.json", "trace files", "accepted harness changes"],
    snippetLabel: "suite gate summary",
    snippetLanguage: "plain",
    snippet: `{
  "ready": true,
  "success_rate": 1.0,
  "compile_pass_rate": 1.0,
  "ci_pass_rate": 1.0,
  "generalist_review_pass_rate": 1.0
}`,
    icon: <CpuIcon className="w-5 h-5" />,
  },
  {
    id: "engine",
    step: "06",
    stageIds: ["check", "run"],
    title: "Compile, validate, test, and execute",
    summary:
      "The RuleSpec engine is what turns encodings into something executable: validators, test runners, interpreters, and code generation targets.",
    details: [
      "The `axiom-rules-engine` compiler, runtime, and test harness are the first execution surfaces every encoding sees.",
      "The runtime and codegen layers are what make a `.yaml` file more than documentation: they let the same encoding drive evaluation and external integrations.",
      "This is where imports, periods, dtypes, formulas, and built-ins become machine behavior.",
    ],
    components: [
      "compiler",
      "test harness",
      "executor",
      "python/js/rust codegen",
    ],
    repos: ["axiom-rules-engine"],
    outputs: ["validation results", "test results", "runtime values", "generated code"],
    snippetLabel: "execution commands",
    snippetLanguage: "plain",
    snippet: `cargo test
python -m pytest -q python/tests`,
    icon: <TerminalIcon className="w-5 h-5" />,
  },
  {
    id: "axiom",
    step: "07",
    stageIds: ["publish"],
    title: "Publish and inspect in Axiom",
    summary:
      "Axiom is the public-facing inspection layer where source trees, RuleSpec files, encodings, provenance, and agent logs become explorable.",
    details: [
      "Axiom is downstream of the corpus and harness, not the source of truth.",
      "It exposes source documents, rule trees, encoding records, and agent logs in one place.",
      "This is also where funders, researchers, and engineers can inspect how a specific rule got from text to executable encoding.",
    ],
    components: [
      "rule trees",
      "encoding records",
      "agent logs",
      "source document browser",
    ],
    repos: ["axiom", "axiom.org"],
    outputs: ["public rule pages", "encoding views", "document browser"],
    snippetLabel: "live surface",
    snippetLanguage: "plain",
    snippet: `Axiom shows:
- official source documents
- RuleSpec encodings
- optional legacy encoding-run metadata
- per-encoding agent logs`,
    icon: <TargetIcon className="w-5 h-5" />,
  },
];

const runtimeStages: RuntimeStage[] = [
  {
    id: "input",
    label: "Acquire",
    detail:
      "Official documents are fetched, normalized, and turned into exact slices with stable references.",
  },
  {
    id: "encode",
    label: "Encode",
    detail:
      "Encoder generates `.yaml` and `.yaml.test` against explicit harness rules and hydrated context.",
  },
  {
    id: "check",
    label: "Verify",
    detail:
      "Deterministic CI, tests, and semantic review decide whether the candidate is promotion-safe.",
  },
  {
    id: "run",
    label: "Execute",
    detail:
      "The RuleSpec engine validates, tests, and executes the accepted encoding.",
  },
  {
    id: "publish",
    label: "Inspect",
    detail:
      "Wave manifests and Axiom sync expose the result as a durable, inspectable rule artifact.",
  },
];

const repoLanes: RepoLane[] = [
  {
    id: "source",
    title: "Source and structure",
    summary:
      "Document acquisition, converters, and source XML structure live here before any rules encoding starts.",
    repos: ["axiom", "rulespec-uk sources", "rulespec-us sources", "rulespec-us-co sources"],
  },
  {
    id: "corpus",
    title: "Rule corpora",
    summary:
      "Jurisdiction-specific `.yaml` files, tests, imports, and provenance manifests.",
    repos: ["rulespec-uk", "rulespec-us", "rulespec-us-co"],
  },
  {
    id: "tooling",
    title: "Language and harness",
    summary:
      "The RuleSpec engine executes rules, while Encoder builds, benchmarks, and repairs encodings.",
    repos: ["axiom-rules-engine", "axiom-encode"],
  },
  {
    id: "presentation",
    title: "Presentation and inspection",
    summary:
      "Axiom and the site expose source, encodings, provenance, and logs to users.",
    repos: ["axiom", "axiom.org"],
  },
];

const stackStats = [
  { label: "7 layers", value: "7" },
  { label: "5 runtime stages", value: "5" },
  { label: "8 core repos", value: "8" },
  { label: "1 public inspection surface", value: "1" },
];

const journeyArtifacts: JourneyArtifact[] = [
  {
    id: "official-source",
    stage: "Acquire",
    title: "Official source snapshot",
    summary:
      "The point-in-time legal text comes from the official legislation source for the exact instrument and date.",
    href: "https://www.legislation.gov.uk/uksi/2002/1792/2025-03-31/data.xml",
    linkLabel: "Open official source XML source",
    previewLabel: "official source",
    preview: `https://www.legislation.gov.uk/uksi/2002/1792/2025-03-31/data.xml

Official point-in-time source for regulation 4A(1)(a).`,
  },
  {
    id: "repo-snapshot",
    stage: "Acquire",
    title: "Repo source snapshot",
    summary:
      "The official source is mirrored into the corpus repo so later encoding and review steps use a stable input.",
    href: "https://github.com/TheAxiomFoundation/rulespec-uk/blob/main/sources/official/uksi/2002/1792/2025-03-31/source.xml",
    linkLabel: "Open repo source snapshot",
    previewLabel: "repo source.xml",
    preview: `sources/official/uksi/2002/1792/2025-03-31/source.xml

Stable checked-in source snapshot used downstream by the stack.`,
  },
  {
    id: "exact-slice",
    stage: "Acquire",
    title: "Exact source slice",
    summary:
      "The encoder works from a tight clause slice rather than the whole instrument, so generation and review are reproducible.",
    href: "/stack-examples/uk-regulation-4A-1-a-source-slice.txt",
    linkLabel: "Open extracted source slice",
    previewLabel: "source slice",
    preview: `PART II Entitlement and amount

4A. Meaning of "qualifying young person"

(1) A person who has reached the age of 16 but not the age of 20 is a qualifying young person for the purposes of these Regulations—

(a) up to, but not including, the 1st September following the person's 16th birthday; and`,
  },
  {
    id: "rulespec-file",
    stage: "Encode",
    title: "Promoted RuleSpec rule",
    summary:
      "The encoded rule is checked in as a versioned `.yaml` file in the jurisdiction corpus.",
    href: "https://github.com/TheAxiomFoundation/rulespec-uk/blob/main/legislation/uksi/2002/1792/regulation/4A/1/a.yaml",
    linkLabel: "Open .yaml file",
    previewLabel: "4A(1)(a).yaml",
    preview: `legislation/uksi/2002/1792/regulation/4A/1/a.yaml

qualifying_young_person_4A_1_a:
  entity: Person
  period: Day
  dtype: Boolean
  from 2025-03-21:
    person_has_reached_age_threshold_16_4A_1
      and person_is_under_age_threshold_20_4A_1
      and date_is_before_1st_september_following_person_16th_birthday_4A_1_a`,
  },
  {
    id: "rulespec-test",
    stage: "Verify",
    title: "Companion execution test",
    summary:
      "The rule ships with a checked-in `.yaml.test` file so the execution engine can validate behavior deterministically.",
    href: "https://github.com/TheAxiomFoundation/rulespec-uk/blob/main/legislation/uksi/2002/1792/regulation/4A/1/a.yaml.test",
    linkLabel: "Open .yaml.test file",
    previewLabel: "4A(1)(a).yaml.test",
    preview: `legislation/uksi/2002/1792/regulation/4A/1/a.yaml.test

The companion test file exercises the age and September cut-off behavior against concrete cases.`,
  },
  {
    id: "encoder-summary",
    stage: "Verify",
    title: "Encoder run summary",
    summary:
      "Wave 16 promotion metadata ties this exact rule back to a concrete Encoder run, model, commit, and metrics.",
    href: "/stack-examples/uk-regulation-4A-1-a-encoder-summary.json",
    linkLabel: "Open Encoder summary JSON",
    previewLabel: "wave16 summary",
    preview: `{
  "wave": "2026-04-01-wave16",
  "encoder_commit": "243d37f",
  "encoder_version": "0.2.64",
  "runner": "openai-gpt-5.4",
  "compile_pass": true,
  "ci_pass": true
}`,
  },
  {
    id: "axiom-page",
    stage: "Inspect",
    title: "Live Axiom page",
    summary:
      "The promoted rule is then available in Axiom with source context, encoding metadata, and inspection surfaces.",
    href: axiomAppHref("uk/legislation/uksi/2002/1792/regulation/4A/1/a"),
    linkLabel: "Open live Axiom page",
    previewLabel: "axiom route",
    preview: `${axiomAppHref("uk/legislation/uksi/2002/1792/regulation/4A/1/a")}

Live public page for the promoted encoding.`,
  },
];

export function StackSystemPage() {
  const [selectedStageId, setSelectedStageId] = useState(runtimeStages[0].id);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState(journeyArtifacts[0].id);
  const selectedStage =
    runtimeStages.find((stage) => stage.id === selectedStageId) ?? runtimeStages[0];
  const selectedLayer =
    stackLayers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedStageLayers = stackLayers.filter((layer) =>
    layer.stageIds.includes(selectedStage.id)
  );
  const selectedArtifact =
    journeyArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? journeyArtifacts[0];

  return (
    <div className="relative z-1 py-32 px-8">
      <div className="max-w-[1280px] mx-auto">
        <header className="mb-20">
          <div className="mb-10 max-w-[900px]">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)] mb-4">
              Axiom technical stack
            </p>
            <h1 className="heading-page mb-6">
              From scraped documents to executable rules
            </h1>
            <p className="font-body text-xl text-[var(--color-ink-secondary)] leading-relaxed max-w-[820px]">
              Axiom separates source acquisition, structural normalization,
              rules encoding, harness evaluation, runtime execution, and public
              inspection into distinct layers so each can be audited, improved,
              and replaced without collapsing the whole system into one tool.
            </p>
            <p className="mt-6 border-l-2 border-[var(--color-accent)] pl-5 font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
              For the implemented core and encoder path, and the remaining
              admission and publication work, see the {" "}
              <Link href="/docs/#core-execution">current execution architecture</Link>.
              {" "}The map below provides the broader system context.
            </p>
          </div>

          <div className="rounded-md border border-[var(--color-rule)] bg-[linear-gradient(135deg,rgba(192,80,0,0.08),rgba(12,12,12,0.02))] p-8 mb-10">
            <div className="flex flex-wrap items-start justify-between gap-8">
              <div className="max-w-[720px]">
                <p className="font-body text-[1rem] text-[var(--color-ink)] leading-relaxed mb-4">
                  Encoder is one layer in a longer chain. A provision moves from
                  official document capture, to structural normalization, to a
                  reproducible source slice, to a tested RuleSpec file, to harness
                  evaluation, to runtime execution, and finally to Axiom. The
                  system is split this way so authority, transformation,
                  correctness, and presentation can each be inspected on their
                  own terms.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link href="/encoder" className="btn-outline">
                    Open Encoder system map
                  </Link>
                  <a href={axiomAppHref()} className="btn-primary">
                    Explore Axiom
                    <ArrowRightIcon className="w-5 h-5" />
                  </a>
                </div>
                <div className="mt-5 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-2">
                    Example thread
                  </p>
                  <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed mb-3">
                    One concrete path through the stack:
                  </p>
                  <div className="font-mono text-xs text-[var(--color-code-text)] leading-6 overflow-x-auto">
                    Pension Credit regulation 4A(1)(a)
                    <br />
                    official data.xml -&gt; extracted source slice -&gt; 4A/1/a.yaml -&gt; wave16 Encoder summary -&gt; Axiom
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 min-w-[320px] flex-1">
                {stackStats.map((stat) => (
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
            </div>
          </div>

        </header>

        <section className="mb-24">
          <div className="mb-8">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-accent)] mb-3">
              Start with the overview
            </p>
            <h2 className="heading-section mb-3">
              General flow
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[780px] leading-relaxed">
              Pick a runtime stage to highlight the relevant layers. Then open a
              layer to inspect the repos, outputs, and code shape underneath
              that part of the stack. The hero example stays constant; the
              cards below show representative technical shapes from each layer.
            </p>
          </div>

          <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
            <div className="flex flex-wrap gap-3 mb-8">
              {runtimeStages.map((stage, index) => {
                const active = stage.id === selectedStage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedStageId(stage.id);
                      setSelectedLayerId(null);
                    }}
                    className={`flex items-center gap-3 rounded-full border px-4 py-2 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                        : "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <span className="font-mono text-xs text-[var(--color-accent)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-body text-sm text-[var(--color-ink)]">
                      {stage.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mb-8">
              {stackLayers.map((layer) => {
                const active = layer.id === selectedLayer?.id;
                const highlighted = layer.stageIds.includes(selectedStage.id);
                return (
                  <button
                    key={layer.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedLayerId(layer.id);
                      if (!layer.stageIds.includes(selectedStage.id)) {
                        setSelectedStageId(layer.stageIds[0]);
                      }
                    }}
                    className={`group text-left rounded-md border px-4 py-4 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] shadow-[0_0_24px_rgba(192,80,0,0.12)]"
                        : highlighted
                          ? "border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-accent)]"
                          : "border-[var(--color-rule)] bg-[var(--color-paper)] opacity-55 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-[var(--color-paper-elevated)] text-[var(--color-accent)] flex items-center justify-center shrink-0">
                        {layer.icon}
                      </div>
                      <div className="flex items-center gap-2 text-[var(--color-accent)]">
                        <span className="font-mono text-xs uppercase tracking-[0.12em]">
                          {layer.step}
                        </span>
                        <ArrowRightIcon className="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform duration-150" />
                      </div>
                    </div>
                    <div className="font-body text-[1rem] text-[var(--color-ink)] mb-2 leading-tight">
                      {layer.title}
                    </div>
                    <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                      {layer.summary}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-6 max-lg:grid-cols-1">
              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-3">
                  Selected stage
                </p>
                <div className="font-body text-2xl text-[var(--color-ink)] mb-3">
                  {selectedStage.label}
                </div>
                <p className="font-body text-[0.98rem] text-[var(--color-ink-secondary)] leading-relaxed">
                  {selectedStage.detail}
                </p>
              </div>

              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                  Relevant layers
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedStageLayers.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setSelectedLayerId(layer.id)}
                      className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1 font-mono text-xs text-[var(--color-code-text)] hover:border-[var(--color-accent)] transition-colors duration-150"
                    >
                      {layer.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="mb-8">
            <h2 className="heading-section mb-3">
              Follow one real rule
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[780px] leading-relaxed">
              This is one promoted UK rule traced across the stack. Each step
              links to a real artifact, not a placeholder.
            </p>
          </div>

          <div className="grid grid-cols-[minmax(260px,0.95fr)_minmax(0,1.25fr)] gap-8 max-lg:grid-cols-1">
            <div className="flex flex-col gap-3">
              {journeyArtifacts.map((artifact) => {
                const active = artifact.id === selectedArtifact.id;
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedArtifactId(artifact.id)}
                    className={`text-left rounded-md border px-4 py-4 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                        : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <span className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-1 font-mono text-xs text-[var(--color-accent)]">
                        {artifact.stage}
                      </span>
                      <ArrowRightIcon className="w-4 h-4 text-[var(--color-accent)] opacity-70" />
                    </div>
                    <div className="font-body text-[1rem] text-[var(--color-ink)] mb-2">
                      {artifact.title}
                    </div>
                    <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                      {artifact.summary}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
                <div className="flex items-center justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-start">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-accent)] mb-2">
                      {selectedArtifact.stage}
                    </p>
                    <h3 className="font-body text-2xl text-[var(--color-ink)]">
                      {selectedArtifact.title}
                    </h3>
                  </div>
                  <a
                    href={selectedArtifact.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline"
                  >
                    {selectedArtifact.linkLabel}
                  </a>
                </div>

                <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed">
                  {selectedArtifact.summary}
                </p>
              </div>

              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-code-bg)] overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2826]">
                  <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]"></span>
                  <span className="font-mono text-xs text-[var(--color-code-text)]">
                    {selectedArtifact.previewLabel}
                  </span>
                </div>
                <CodeBlock
                  code={selectedArtifact.preview}
                  language="plain"
                  className="m-0 p-6 font-mono text-[0.82rem] leading-7 whitespace-pre-wrap text-[var(--color-code-text)] overflow-x-auto"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="mb-8">
            <h2 className="heading-section mb-3">
              Layer detail
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
              The overview above is the map. This section is the architecture
              reference for one selected layer: responsibilities, repository
              boundaries, outputs, and representative code or data shape.
            </p>
          </div>

          <div className="grid grid-cols-[minmax(260px,0.9fr)_minmax(0,1.3fr)] gap-8 max-lg:grid-cols-1">
            <div className="flex flex-col gap-3">
              {stackLayers.map((layer) => {
                const active = layer.id === selectedLayer?.id;
                return (
                  <button
                    key={layer.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedLayerId(layer.id)}
                    className={`text-left rounded-md border px-4 py-4 transition-all duration-150 ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                        : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--color-paper)] text-[var(--color-accent)] flex items-center justify-center shrink-0">
                        {layer.icon}
                      </div>
                      <div>
                        <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-1">
                          Layer {layer.step}
                        </div>
                        <div className="font-body text-[1rem] text-[var(--color-ink)] mb-2 leading-tight">
                          {layer.title}
                        </div>
                        <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                          {layer.summary}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-8">
              {selectedLayer ? (
                <>
                  <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
                    <div className="flex items-start justify-between gap-4 mb-4 max-sm:flex-col">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)] flex items-center justify-center">
                          {selectedLayer.icon}
                        </div>
                        <div>
                          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-accent)]">
                            Layer {selectedLayer.step}
                          </p>
                          <h3 className="font-body text-2xl text-[var(--color-ink)]">
                            {selectedLayer.title}
                          </h3>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedLayerId(null)}
                        className="btn-outline"
                      >
                        Back to overview
                      </button>
                    </div>

                    <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6">
                      {selectedLayer.summary}
                    </p>

                    {layerTrust[selectedLayer.id] ? (
                      <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5 mb-8">
                        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)]">
                            what you can check here
                          </p>
                          <Link
                            href="/verify"
                            className="font-mono text-xs text-[var(--color-ink-muted)] underline underline-offset-4 hover:text-[var(--color-ink)]"
                          >
                            run the checks
                          </Link>
                        </div>

                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          <div className="flex flex-col gap-3">
                            {layerTrust[selectedLayer.id].checkable.map(
                              (item) => (
                                <div
                                  key={item}
                                  className="flex items-start gap-3 font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed"
                                >
                                  <CheckIcon className="w-4 h-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                                  <span>{item}</span>
                                </div>
                              ),
                            )}
                          </div>

                          <div className="flex flex-col gap-3">
                            {layerTrust[selectedLayer.id].open.map((item) => (
                              <div
                                key={item}
                                className="flex items-start gap-3 font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed"
                              >
                                <WarningIcon className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                                <span>{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                      <div>
                        <h4 className="font-body text-lg text-[var(--color-ink)] mb-3">
                          What this layer does
                        </h4>
                        <div className="flex flex-col gap-3">
                          {selectedLayer.details.map((detail) => (
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

                      <div className="grid grid-cols-1 gap-4">
                        <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                            components
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedLayer.components.map((component) => (
                              <span
                                key={component}
                                className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1 font-mono text-xs text-[var(--color-code-text)]"
                              >
                                {component}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                            repos
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedLayer.repos.map((repo) => (
                              <span
                                key={repo}
                                className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1 font-mono text-xs text-[var(--color-code-text)]"
                              >
                                {repo}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-5">
                          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                            outputs
                          </p>
                          <div className="flex flex-col gap-2">
                            {selectedLayer.outputs.map((output) => (
                              <div
                                key={output}
                                className="flex items-start gap-2 font-body text-sm text-[var(--color-ink-secondary)]"
                              >
                                <TerminalIcon className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                                <span>{output}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-code-bg)] overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2826]">
                      <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]"></span>
                      <span className="font-mono text-xs text-[var(--color-code-text)]">
                        {selectedLayer.snippetLabel}
                      </span>
                    </div>
                    <CodeBlock
                      code={selectedLayer.snippet}
                      language={selectedLayer.snippetLanguage}
                      className="m-0 p-6 font-mono text-[0.82rem] leading-7 whitespace-pre-wrap text-[var(--color-code-text)] overflow-x-auto"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
                  <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-accent)] mb-3">
                    Overview mode
                  </p>
                  <h3 className="font-body text-2xl text-[var(--color-ink)] mb-4">
                    Choose a layer to inspect
                  </h3>
                  <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] leading-relaxed mb-6 max-w-[760px]">
                    Start with the selected runtime stage, then drill into one
                    layer to see its repositories, outputs, and representative
                    code or data shape.
                  </p>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                    <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-3">
                        Current stage
                      </p>
                      <div className="font-body text-xl text-[var(--color-ink)] mb-3">
                        {selectedStage.label}
                      </div>
                      <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                        {selectedStage.detail}
                      </p>
                    </div>

                    <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                      <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-3">
                        Drill into
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedStageLayers.map((layer) => (
                          <button
                            key={layer.id}
                            type="button"
                            onClick={() => setSelectedLayerId(layer.id)}
                            className="rounded-full border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] px-3 py-1 font-mono text-xs text-[var(--color-code-text)] hover:border-[var(--color-accent)] transition-colors duration-150"
                          >
                            {layer.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-24">
          <div className="flex items-end justify-between gap-6 mb-8 max-md:flex-col max-md:items-start">
            <div>
              <h2 className="heading-section mb-3">
                Execution and promotion path
              </h2>
              <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
                After a rule is encoded, the downstream path is verification,
                runtime execution, and public inspection. This section is the
                post-encoding path, not a second architecture map.
              </p>
            </div>
            <Link href="/encoder" className="btn-outline">
              See the harness-only view
            </Link>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
            {runtimeStages.map((stage, index) => (
              <div
                key={stage.id}
                className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-5"
              >
                <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent)] mb-3">
                  Stage {String(index + 1).padStart(2, "0")}
                </div>
                <div className="font-body text-lg text-[var(--color-ink)] mb-2">
                  {stage.label}
                </div>
                <div className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed">
                  {stage.detail}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-24">
          <div className="mb-8">
            <h2 className="heading-section mb-3">
              Repository map
            </h2>
            <p className="font-body text-[1rem] text-[var(--color-ink-secondary)] max-w-[760px] leading-relaxed">
              The stack is split across repositories because source
              acquisition, rule corpora, execution tooling, and public
              presentation change at different speeds.
            </p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-6">
            {repoLanes.map((lane) => (
              <div
                key={lane.id}
                className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-6"
              >
                <h3 className="font-body text-lg text-[var(--color-ink)] mb-3">
                  {lane.title}
                </h3>
                <p className="font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed mb-4">
                  {lane.summary}
                </p>
                <div className="flex flex-col gap-2">
                  {lane.repos.map((repo) => (
                    <div
                      key={repo}
                      className="flex items-start gap-2 font-mono text-xs text-[var(--color-code-text)] rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2"
                    >
                      <VersionIcon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                      <span>{repo}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-8">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(280px,0.9fr)] gap-8 max-lg:grid-cols-1">
              <div>
                <h2 className="heading-section mb-4">
                  Why the split matters
                </h2>
                <div className="flex flex-col gap-4">
                  {[
                    "If source ingestion is sloppy, every later layer inherits bad authority.",
                    "If source XML structure is weak, you cannot target exact slices or build reliable imports.",
                    "If the corpus layer is weak, the harness has nothing durable to promote into.",
                    "If the harness is weak, you get compileable but semantically unsafe encodings.",
                    "If the execution layer is weak, the rules are not actually usable.",
                    "If the inspection layer is weak, the system becomes a black box even if the rule is technically correct.",
                  ].map((line) => (
                    <div
                      key={line}
                      className="flex items-start gap-3 font-body text-sm text-[var(--color-ink-secondary)] leading-relaxed"
                    >
                      <CheckIcon className="w-4 h-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] p-6">
                <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-ink-muted)] mb-4">
                  Cross-links
                </p>
                <div className="flex flex-col gap-3">
                  <Link href="/encoder" className="btn-outline">
                    Encoder system map
                  </Link>
                  <Link href="/docs" className="btn-outline">
                    Documentation index
                  </Link>
                  <a href={axiomAppHref()} className="btn-outline">
                    Axiom encoding views
                  </a>
                  <Link href="/about" className="btn-outline">
                    About the project
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
