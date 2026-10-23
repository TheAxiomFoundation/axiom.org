import { describe, expect, it } from "vitest";
import { runRow, runRows } from "./encoding-pipeline-runs";
import { causeHeadline, newestDocuments, runLedger, sectionBrief, sectionOverview, sectionStatus } from "./run-ledger";
import { mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T10:00:00Z`;

describe("sectionStatus", () => {
  it("reads a section's status from its latest run", () => {
    const status = (overrides: Parameters<typeof pipelineAttempt>[0]) => sectionStatus(runRow(pipelineAttempt(overrides)));
    expect(status({ run_status: "waiting", run_conclusion: null })).toEqual({ status: "Waiting for approval", tone: "waiting" });
    expect(status({ encoder_error_rule: "rule-a", failure_source: "diagnostics" })).toEqual({ status: "Failed validation", tone: "failed" });
    expect(status({ run_conclusion: "cancelled", cancel_stage: "approval" })).toEqual({ status: "Cancelled at approval", tone: "failed" });
    expect(status({ run_conclusion: "success" })).toEqual({ status: "Without a PR", tone: "failed" });
    expect(status({ run_conclusion: "success", pr_state: "draft", pr_url: "u" })).toEqual({ status: "In review", tone: "waiting" });
    expect(status({ run_conclusion: "success", pr_state: "closed", pr_url: "u" })).toEqual({ status: "PR closed", tone: "failed" });
    const merged = (overrides: Parameters<typeof mergedAttempt>[0]) => sectionStatus(runRow(mergedAttempt(overrides)));
    expect(merged({ pr_targets_default: false })).toEqual({ status: "Merged into another branch", tone: "failed" });
    expect(merged({ tests_status: "pass" })).toEqual({ status: "Tests pass", tone: "done" });
    expect(merged({ tests_status: "fail" })).toEqual({ status: "Tests fail", tone: "failed" });
    expect(merged({ index_status: "missing" })).toEqual({ status: "Not indexed", tone: "failed" });
    expect(merged({})).toEqual({ status: "In main", tone: "waiting" });
  });
});

describe("runLedger", () => {
  it("groups runs by jurisdiction, document, and section, newest activity first", () => {
    const rows = runRows([
      pipelineAttempt({ id: "a1", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: day(1) }),
      mergedAttempt({ id: "a2", citation: "us/statute/7/2015/f", jurisdiction: "us", dispatched_at: day(3), tests_status: "pass" }),
      pipelineAttempt({ id: "b", citation: "us/statute/7/2017/a", jurisdiction: "us", dispatched_at: day(2) }),
      pipelineAttempt({ id: "c", citation: "us/regulation/7/273/4", jurisdiction: "us", dispatched_at: day(4) }),
      pipelineAttempt({ id: "d", citation: "us-la/statute/47/32", jurisdiction: "us-la", dispatched_at: day(1) }),
    ]);
    const ledger = runLedger(
      rows,
      { "us/statute/7": "Agriculture", "us/statute/7/2015/f": "Disqualification", "us/statute/7/2015": "Eligibility" },
      {}
    );
    expect(ledger.map((j) => j.name)).toEqual(["US Federal", "Louisiana"]);
    const [federal] = ledger;
    expect(federal.documents.map((d) => [d.key, d.title, d.titled])).toEqual([
      ["us:regulation/7", "7", false],
      ["us:statute/7", "Agriculture", true],
    ]);
    const statute = federal.documents[1];
    expect(statute.sections.map((s) => [s.designator, s.label, s.status, s.runs.map((r) => r.id)])).toEqual([
      ["2015/f", "Disqualification", "Tests pass", ["a2", "a1"]],
      ["2017/a", null, "Failed, cause not looked up yet", ["b"]],
    ]);
    expect(statute.lastAt).toBe(day(3));
  });

  it("takes a citation's source document from the corpus when it is known", () => {
    const rows = runRows([pipelineAttempt({ id: "x", citation: "us/guidance/usda/fns/snap-fy2026-cola/page-1", jurisdiction: "us" })]);
    const ledger = runLedger(
      rows,
      { "us/guidance/usda/fns/snap-fy2026-cola": "SNAP FY 2026 Maximum Allotments" },
      { "us/guidance/usda/fns/snap-fy2026-cola/page-1": "us/guidance/usda/fns/snap-fy2026-cola" }
    );
    const [document] = ledger[0].documents;
    expect([document.key, document.title, document.sections[0].designator]).toEqual([
      "us:guidance/usda/fns/snap-fy2026-cola",
      "SNAP FY 2026 Maximum Allotments",
      "page-1",
    ]);
  });
});

describe("sectionOverview", () => {
  it("sums a section's runs: how many failed, where and why each stopped, and the latest", () => {
    const rows = runRows([
      pipelineAttempt({ id: "1", citation: "us/statute/42/416/l", dispatched_at: day(1), encoder_version: "0.2.2018", encoder_error_rule: "complete-source-unit:tests", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "2", citation: "us/statute/42/416/l", dispatched_at: day(2), encoder_version: "0.2.2023", encoder_error_rule: "complete-source-unit:tests", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "3", citation: "us/statute/42/416/l", dispatched_at: day(3), encoder_version: "0.2.2033", failed_step: "compile", encoder_error: "compile: engine failed", failure_source: "log" }),
      mergedAttempt({ id: "4", citation: "us/statute/42/416/l", dispatched_at: day(4), encoder_version: "0.2.2087", pr_targets_default: false }),
    ]);
    const [section] = runLedger(rows)[0].documents[0].sections;
    const overview = sectionOverview(section);
    expect(overview).toMatchObject({ runs: 4, failed: 3, cancelled: 0, lastAt: day(4) });
    expect(overview.stops.map((s) => `${s.count} ${s.label} — ${s.cause}`)).toEqual([
      "2 Failed validation — Completeness rule: tests",
      "1 Failed the compile check — engine failed",
      "1 Merged into another branch — null",
    ]);
    expect(overview.stops[0].detail).toBe("complete-source-unit:tests");
    expect(overview.latest.id).toBe("4");
  });

  it("counts runs failing the same way together, and names a line by its one message when it has one", () => {
    const failure = (id: string, n: number, got: number) =>
      pipelineAttempt({
        id,
        citation: "us/statute/7/2017/a",
        dispatched_at: day(n),
        encoder_error: `statutes/7/2017/a.yaml: ci: Test case \`base\` expected integer 400, got integer ${got}.`,
        failure_source: "diagnostics",
      });
    const both = sectionOverview(runLedger(runRows([failure("1", 1, 1200), failure("2", 2, 900)]))[0].documents[0].sections[0]);
    expect(both.stops.map((s) => `${s.count} ${s.cause}`)).toEqual(["2 Test case … expected integer N, got integer N"]);
    expect(both.stops[0].detail).toBe("Test case `base` expected integer 400, got integer 900.");
    const one = sectionOverview(runLedger(runRows([failure("1", 1, 1200), failure("2", 2, 1200)]))[0].documents[0].sections[0]);
    expect(one.stops.map((s) => `${s.count} ${s.cause}`)).toEqual(["2 Test case `base` expected integer 400, got integer 1200"]);
  });

  it("counts cancellations apart from failures", () => {
    const rows = runRows([
      pipelineAttempt({ id: "1", dispatched_at: day(1), encoder_error_rule: "rule-a", failure_source: "diagnostics" }),
      pipelineAttempt({ id: "2", dispatched_at: day(2), run_conclusion: "cancelled", cancel_stage: "approval" }),
    ]);
    const overview = sectionOverview(runLedger(rows)[0].documents[0].sections[0]);
    expect(overview).toMatchObject({ runs: 2, failed: 1, cancelled: 1 });
  });
});

describe("newestDocuments", () => {
  it("pages by each document's latest run across jurisdictions, under their own headings", () => {
    const rows = runRows([
      ...[13, 10, 9].map((n, i) =>
        pipelineAttempt({ id: `us${i}`, citation: `us/statute/${i + 1}/100/a`, jurisdiction: "us", dispatched_at: day(n) })
      ),
      pipelineAttempt({ id: "nm", citation: "us-nm/statute/7-2-39", jurisdiction: "us-nm", dispatched_at: day(12) }),
    ]);
    const ledger = runLedger(rows);
    expect(ledger.map((j) => j.code)).toEqual(["us", "us-nm"]);
    const page = newestDocuments(ledger, 2);
    // The two newest: US title 1 (day 13) and New Mexico (day 12), before US titles 2 and 3.
    expect(page.map((j) => [j.code, j.documents.map((d) => d.key)])).toEqual([
      ["us", ["us:statute/1"]],
      ["us-nm", ["us-nm:statute/7-2-39"]],
    ]);
    expect(newestDocuments(ledger, 10).flatMap((j) => j.documents)).toHaveLength(4);
    expect(newestDocuments(ledger, 0)).toEqual([]);
  });
});

describe("runLedger document names", () => {
  it("names a document by its corpus label when its citation carries a colon of its own, and gives its path", () => {
    const rows = runRows([pipelineAttempt({ id: "la", citation: "us-la/statute/47:32", jurisdiction: "us-la" })]);
    const [document] = runLedger(rows, { "us-la/statute/47:32": "Rates of tax" })[0].documents;
    expect([document.key, document.title, document.titled, document.path, document.sections[0].designator]).toEqual([
      "us-la:statute/47:32",
      "Rates of tax",
      true,
      "us-la/statute/47:32",
      "47:32",
    ]);
  });

  it("counts a provision's spellings as one section", () => {
    const rows = runRows([
      pipelineAttempt({ id: "a", citation: "us-nc:manual/dhhs/fns/fns-170-notices/page-7", jurisdiction: "us-nc", dispatched_at: day(1) }),
      pipelineAttempt({ id: "b", citation: "us-nc/manual/dhhs/fns/fns-170-notices/page-7", jurisdiction: "us-nc", dispatched_at: day(2) }),
      pipelineAttempt({ id: "c", citation: "us/regulations/7-cfr/273/4", jurisdiction: "us", dispatched_at: day(3) }),
      pipelineAttempt({ id: "d", citation: "us/regulation/7/273/4", jurisdiction: "us", dispatched_at: day(4) }),
    ]);
    const sections = runLedger(rows).flatMap((j) => j.documents.flatMap((d) => d.sections.map((s) => [s.citation, s.runs.map((r) => r.id)])));
    expect(sections).toEqual([
      ["us/regulation/7/273/4", ["d", "c"]],
      ["us-nc/manual/dhhs/fns/fns-170-notices/page-7", ["b", "a"]],
    ]);
  });
});

describe("causeHeadline", () => {
  it("names a failure in a few words, without where it came from", () => {
    expect(causeHeadline("complete-source-unit:structure")).toBe("Completeness rule: structure");
    expect(causeHeadline("ci: Ungrounded generated numeric literal: N does not appear as a substantive numeric value in the source text.")).toBe(
      "Ungrounded generated numeric literal"
    );
    expect(causeHeadline("ci: Test case … execution failed: derived … has no formula version at N-N-N")).toBe("Test case … execution failed");
    expect(causeHeadline("ci: Test case … output … expected integer N, got decimal N.")).toBe("Test case … output … expected integer N, got decimal N");
    expect(causeHeadline("compile: Axiom rules engine compile failed: failed to load RuleSpec module …")).toBe("Axiom rules engine compile failed");
    expect(causeHeadline("RuntimeError: reviewed candidate validation produced …")).toBe("reviewed candidate validation produced …");
    expect(causeHeadline("x".repeat(100))).toHaveLength(72);
    // A raw encoder message: its file, its check, and a bracketed rule.
    expect(causeHeadline("statutes/42/416/l.yaml: ci: [complete-source-unit:structure] Source branch (A) at …")).toBe(
      "Completeness rule: structure"
    );
    expect(causeHeadline("statutes/42/402/q.yaml: ci: Embedded scalar literal: old_age line 6 embeds 5")).toBe("Embedded scalar literal");
    // A tool's error by the tool and its first clause; an exception by its class.
    expect(causeHeadline("jq: error: syntax error, unexpected INVALID_CHARACTER, expecting end of file")).toBe("jq: syntax error");
    expect(
      causeHeadline("axiom_encode.corpus_resolver.CorpusLayoutError: Canonical data/corpus/provisions directory is missing")
    ).toBe("Corpus layout error");
    expect(causeHeadline("error: rulespec ref is not the exact pull request base branch tip")).toBe(
      "rulespec ref is not the exact pull request base branch tip"
    );
  });
});

describe("sectionBrief", () => {
  const brief = (attempts: Parameters<typeof pipelineAttempt>[0][]) => {
    const [jurisdiction] = runLedger(runRows(attempts.map((a, i) => pipelineAttempt({ id: `x${i}`, dispatched_at: day(i + 1), ...a }))));
    return sectionBrief(jurisdiction.documents[0].sections[0]);
  };

  it("asks for the approval a waiting run needs, with its run to open", () => {
    const b = brief([{ run_status: "waiting", run_conclusion: null, run_url: "https://x/run/1" }]);
    expect(b.headline).toBe("Not encoded yet · 1 run, none merged");
    expect(b.now).toEqual({ text: "Waiting for approval", link: { label: "Approve on GitHub ↗", url: "https://x/run/1" } });
    expect(b.repeated).toEqual([]);
    expect(b.marks.map((m) => m.tone)).toEqual(["waiting"]);
  });

  it("points at the PR in review, the tests that fail, and the side branch's own PR", () => {
    const pr = { pr_repo: "rulespec-us", pr_number: 7, pr_url: "https://x/pr/7", pr_created_at: day(2), run_conclusion: "success" };
    expect(brief([{ ...pr, pr_state: "open" }]).now).toEqual({ text: "In review", link: { label: "rulespec-us#7 ↗", url: "https://x/pr/7" } });
    const merged = (o: Parameters<typeof mergedAttempt>[0]) => {
      const [j] = runLedger(runRows([mergedAttempt(o)]));
      return sectionBrief(j.documents[0].sections[0]);
    };
    const failing = merged({ tests_status: "fail", tests_run_url: "https://x/tests" });
    expect(failing.headline).toBe("Not encoded yet · 1 run, 1 merged");
    expect(failing.now).toEqual({ text: "Tests fail", link: { label: "Open the tests ↗", url: "https://x/tests" } });
    const side = merged({ pr_targets_default: false, pr_base_branch: "side", pr_via_number: 9, pr_via_url: "https://x/pr/9", pr_via_state: "open" });
    expect(side.now?.link).toEqual({ label: "rulespec-us#9 ↗", url: "https://x/pr/9" });
  });

  it("has no next step once the latest run is encoded and passes its tests", () => {
    const [j] = runLedger(runRows([mergedAttempt({ tests_status: "pass" })]));
    const b = sectionBrief(j.documents[0].sections[0]);
    expect(b.encoded).toBe(true);
    expect(b.headline).toBe("Encoded · merged rulespec-us#42 · tests pass");
    expect(b.now).toBeNull();
    expect(b.marks[0]).toMatchObject({ tone: "done", url: "https://github.com/TheAxiomFoundation/rulespec-us/pull/42" });
  });
});
