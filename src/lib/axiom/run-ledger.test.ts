import { describe, expect, it } from "vitest";
import { runRow, runRows } from "./encoding-pipeline-runs";
import { causeHeadline, newestDocuments, runLedger, runModules, sectionBrief, sectionOverview, sectionStatus } from "./run-ledger";
import { dependentAttempt, mergedAttempt, pipelineAttempt } from "@/test/pipeline-attempt";

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
    // An open PR: what holds it, its checks first.
    expect(status({ run_conclusion: "success", pr_state: "open", pr_url: "u", pr_checks: "failure", pr_review: "changes_requested" })).toEqual({ status: "PR checks fail", tone: "failed" });
    expect(status({ run_conclusion: "success", pr_state: "open", pr_url: "u", pr_checks: "success", pr_review: "changes_requested" })).toEqual({ status: "Changes requested", tone: "failed" });
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

  it("lists a module right under the section whose run encoded it", () => {
    const rows = runRows([
      pipelineAttempt({ id: "1001", citation: "us/statute/42/416/l", dispatched_at: day(1) }),
      dependentAttempt({ id: "dep:a", citation: "us/statute/42/402/q", dispatched_at: day(2) }),
      pipelineAttempt({ id: "x", citation: "us/statute/42/500/a", dispatched_at: day(3) }),
      // The host is in another document: the module keeps its own place.
      dependentAttempt({ id: "dep:b", citation: "us/statute/7/2015/f", dispatched_at: day(4) }),
    ]);
    const sections = (key: string) =>
      runLedger(rows)[0]
        .documents.find((d) => d.key === key)!
        .sections.map((s) => [s.designator, s.encodedWith]);
    expect(sections("us:statute/42")).toEqual([
      ["500/a", null],
      ["416/l", null],
      ["402/q", "us/statute/42/416/l"],
    ]);
    expect(sections("us:statute/7")).toEqual([["2015/f", null]]);
    // Its host is listed elsewhere (here, not at all): a line names it.
    expect(runLedger(rows)[0].documents.find((d) => d.key === "us:statute/7")!.sections[0].encodedIn).toEqual({
      citation: "us/statute/42/416/l",
      name: "416/l",
      document: "42",
    });
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
    // A test runner's FAILED line leads with the file; the exception names the cause.
    expect(
      causeHeadline("FAILED data/corpus/provisions/us/regulation/x.jsonl: ContentStoreError: cannot obtain data/x.jsonl: no source holds it")
    ).toBe("Content store error");
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
    );    // A guard's issue leads with its manifest, without a colon.
    expect(
      causeHeadline(".axiom/encoding-manifests/us-az/x.json validation_waiver_set_sha256 does not match the RuleSpec toolchain-bound waiver set")
    ).toBe("validation_waiver_set_sha256 does not match the RuleSpec toolchain-boun…");
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

  it("lists a failure that came back only while the section is stuck on it", () => {
    const failed = { run_conclusion: "failure", encoder_error_rule: "complete-source-unit:tests", failure_source: "diagnostics" } as const;
    const pr = { run_conclusion: "success", pr_repo: "rulespec-us", pr_number: 7, pr_url: "https://x/pr/7", pr_created_at: day(9), pr_state: "open" } as const;
    // Two failures, then a run that passed: the failures are history.
    expect(brief([failed, failed, pr]).repeated).toEqual([]);
    // Two failures since the run that passed: stuck on them again.
    expect(brief([failed, failed, pr, failed, failed]).repeated.map((r) => r.count)).toEqual([2]);
    expect(brief([failed, failed, pr, failed]).repeated).toEqual([]);
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

  it("names a later failed run as a re-encode", () => {
    const later = pipelineAttempt({ id: "later", dispatched_at: "2026-10-26T16:37:00Z", run_conclusion: "failure", run_url: "https://x/run/9" });
    const [j] = runLedger(runRows([mergedAttempt({ tests_status: "pass" }), later]));
    const b = sectionBrief(j.documents[0].sections[0]);
    expect(b.encoded).toBe(true);
    expect(b.now?.text).toMatch(/^Re-encode on Oct 26 — failed/);
    expect(b.now?.link?.url).toBe("https://x/run/9");
  });
});

describe("sectionBrief of a PR whose checks fail", () => {
  it("names the cluster the checks' log printed, and the checks, from the CI record", () => {
    const rows = runRows([
      pipelineAttempt({
        run_conclusion: "success",
        pr_url: "https://github.com/x/pull/2022",
        pr_repo: "rulespec-us",
        pr_number: 2022,
        pr_state: "open",
        pr_checks: "failure",
        pr_review: "changes_requested",
        pr_failed_checks: ["validate / validate (us-ak)", "validate / validate (us-al)"],
        pr_check_error: "- .axiom/encoding-manifests/us-az/x.json replacement authority is invalid: legacy replacement manifest",
      }),
    ]);
    const brief = sectionBrief(runLedger(rows)[0].documents[0].sections[0]);
    expect(brief.now).toEqual({
      text: "PR checks fail: Legacy manifest · changes requested",
      link: { label: "rulespec-us#2022 ↗", url: "https://github.com/x/pull/2022" },
    });
    expect(brief.blocked).toBeNull();
    expect(brief.checks).toBe("2 checks fail: x.json replacement authority is invalid: legacy replacement manifest");
  });
});

describe("sectionBrief of a PR that waits on linked work", () => {
  it("sorts what GitHub links to the PR: still open, merged but not in the pin, done", () => {
    const link = (ref: string, kind: "pin" | "encoder", state: "draft" | "merged", version: string | null = null, step: 1 | 2 = 1) => ({
      ref, url: `https://github.com/x/${ref}`, title: ref, kind, state, review: null, reviewer: null, mergedAt: null, version, step, via: step === 2 ? "rulespec-us#2023" : null,
    });
    const rows = runRows([
      pipelineAttempt({
        run_conclusion: "success",
        pr_url: "https://github.com/x/pull/2022",
        pr_state: "open",
        pr_created_at: "2026-11-04T04:28:11Z",
        pr_checks: "failure",
        pr_links: {
          review: { by: "MaxGhenis", state: "changes_requested", at: "2026-11-04T06:19:01Z" },
          comments: { count: 13, lastAt: "2026-11-05T15:08:31Z", lastBy: "PavelMakarchuk" },
          pin: "0.2.2248",
          links: [
            link("axiom-encode#2058", "encoder", "merged", "0.2.2240"),
            link("axiom-encode#2059", "encoder", "merged", "0.2.2308", 2),
            link("rulespec-us#2023", "pin", "draft"),
          ],
          readAt: "2026-11-05T16:00:00Z",
        },
      }),
    ]);
    const blocked = sectionBrief(runLedger(rows)[0].documents[0].sections[0]).blocked!;
    expect([blocked.since, blocked.waits.map((l) => l.ref), blocked.unpinned.map((l) => l.ref), blocked.done.map((l) => l.ref)]).toEqual([
      "2026-11-04T04:28:11Z",
      ["rulespec-us#2023"],
      ["axiom-encode#2059"],
      ["axiom-encode#2058"],
    ]);
  });
});

describe("runModules", () => {
  it("gives a run's own module first, then each module encoded inside it", () => {
    const rows = runRows([
      pipelineAttempt({ id: "1001", citation: "us/statute/42/416/l" }),
      dependentAttempt({ id: "dep:b", citation: "us/statute/42/402/r" }),
      dependentAttempt({ id: "dep:a", citation: "us/statute/42/402/q" }),
      pipelineAttempt({ id: "other", citation: "us/statute/7/2015/f" }),
    ]);
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    const cites = (m: ReturnType<typeof runModules>) => [m.run?.id ?? null, m.modules.map((r) => r.citation)];
    expect(cites(runModules(byId("1001"), rows))).toEqual(["1001", ["us/statute/42/416/l", "us/statute/42/402/q", "us/statute/42/402/r"]]);
    expect(cites(runModules(byId("dep:a"), rows))).toEqual(["1001", ["us/statute/42/416/l", "us/statute/42/402/q", "us/statute/42/402/r"]]);
    expect(cites(runModules(byId("other"), rows))).toEqual(["other", ["us/statute/7/2015/f"]]);
    // The host is not among the rows: the module alone.
    expect(cites(runModules(byId("dep:a"), [byId("dep:a")]))).toEqual([null, ["us/statute/42/402/q"]]);
  });
});
