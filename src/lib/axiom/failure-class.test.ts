import { describe, expect, it } from "vitest";
import { classifyFailure, type FailureSignal } from "./failure-class";

const at = (station: string, rule_id: string | null, message: string | null = null, recorded: FailureSignal["recorded"] = null): FailureSignal => ({
  station,
  rule_id,
  message,
  recorded,
});

describe("classifyFailure", () => {
  it("takes the class the encoder recorded, unless the encoder did not know", () => {
    expect(classifyFailure(at("validate", "r:tests", null, { class: "corpus", subclass: "metadata" }))).toEqual({ id: "corpus", subclass: "metadata", basis: "encoder" });
    // The encoder's unknown: the rules still apply.
    expect(classifyFailure(at("validate", "r:tests", null, { class: "unknown" }))).toEqual({ id: "rejected", subclass: null, basis: "rule" });
    // A class the encoder does not have is not trusted.
    expect(classifyFailure(at("validate", "r:tests", null, { class: "made_up" })).basis).toBe("rule");
  });

  it("classifies by the stage and structured signals", () => {
    expect(classifyFailure(at("target_gate", "gate:pre-encode-blocked", "heading-only body")).id).toBe("selection");
    expect(classifyFailure(at("target_gate", "gate:pre-encode-blocked", "body is empty"))).toEqual({ id: "corpus", subclass: "content", basis: "rule" });
    expect(classifyFailure(at("review", "review:closed-unmerged")).id).toBe("process");
    expect(classifyFailure(at("validate", null, "[generated-yaml:decode] not UTF-8"))).toEqual({ id: "encoder", subclass: "harness", basis: "rule" });
    expect(classifyFailure(at("validate", "complete-source-unit:tests", "x.yaml: ci: [complete-source-unit:tests] no"))).toEqual({ id: "rejected", subclass: null, basis: "rule" });
  });

  it("classifies by the 2026-10-23 taxonomy's text patterns", () => {
    expect(classifyFailure(at("validate", "text:valueerror-no-local-corpus-source-text", "ValueError: No local corpus source text found for 'us-tn/x'")).id).toBe("corpus");
    expect(classifyFailure(at("setup", "infra:verify-immutable-checkout-identities", "error: rulespec ref is not the exact pull request base branch tip")).id).toBe("process");
    expect(classifyFailure(at("compile", "compile:compile_error", "RuleSpec module `us:x` declares removed plural `corpus_citation_paths`")).id).toBe("migration");
    expect(classifyFailure(at("validate", "text:valueerror-repair-artifact-metadata-mismatch-cor", "ValueError: repair artifact metadata mismatch: corpus_ref"))).toEqual({
      id: "encoder",
      subclass: "harness",
      basis: "text",
    });
    expect(classifyFailure(at("setup", "infra:fetch-pinned-corpus-provision-objects", "FAILED x.jsonl: ContentStoreError: cannot obtain x")).id).toBe("infra");
    expect(classifyFailure(at("validate", "text:axiom-rules-engine-compile-failed-failed", "x.yaml: compile: Axiom rules engine compile failed"))).toEqual({ id: "rejected", subclass: null, basis: "text" });
  });

  it("lets the cause win over a symptom or a word in passing", () => {
    // A Go download line in the log is not an infra failure: the step refused to provision.
    expect(classifyFailure(at("setup", "infra:provision-protected-signing-supervisor", "go: downloading golang.org/x/sys v0.46.0 refusing to provision: encoder files changed")).id).toBe("process");
    // "non-legacy" in a process block's text is not migration debt.
    expect(classifyFailure(at("validate", "text:repair-replay-is-limited-to-one", "repair replay is limited to one non-legacy target")).id).toBe("process");
  });

  it("leaves the rest unclassified", () => {
    expect(classifyFailure(at("pr_checks", "check:unknown"))).toEqual({ id: "unknown", subclass: null, basis: null });
    expect(classifyFailure(at("index", "index:missing")).id).toBe("unknown");
    // A rule id outside the encode loop is not a validator rejection.
    expect(classifyFailure(at("pr_checks", "check:build")).id).toBe("unknown");
  });
});
