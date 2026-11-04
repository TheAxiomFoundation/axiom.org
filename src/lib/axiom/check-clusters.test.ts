import { describe, expect, it } from "vitest";
import { checkCluster } from "./check-clusters";
import { classifyFailure } from "./failure-class";

const id = (text: string | null) => checkCluster(text)?.id ?? null;

describe("checkCluster", () => {
  it("names the cause the CI log printed", () => {
    expect(
      id("Manual RuleSpec changes are not allowed. - .axiom/encoding-manifests/us-nm/statutes/7-2-39.json validation_execution.axiom_encode does not match the running pinned encoder")
    ).toBe("stale-encoder-pin");
    expect(id("- .axiom/encoding-manifests/us-az/x.json replacement authority is invalid: legacy replacement manifest …")).toBe("legacy-manifest");
    expect(id("Validation waiver ratchet is decrement-only: 3 base module(s) -> 4 head module(s).")).toBe("waiver");
    expect(id("ci: Proof source evidence not found: rule `a` proof atom 0 `source.excerpt` does not appear in `x`.")).toBe("proof-evidence");
    expect(id("statutes/7/1.yaml: compile: Axiom rules engine compile failed")).toBe("validator");
    expect(id("Cancelled before it finished (a timeout or a newer run)")).toBe("cancelled");
    expect(id("Something else entirely")).toBeNull();
    expect(id(null)).toBeNull();
  });

  it("takes the first cause in fix order when a PR fails several ways", () => {
    expect(
      id(
        "tests: 3 failed: test_ratchet — AssertionError: oracle-coverage-pending ratchet failed; test_legacy — AssertionError: prelaunch hard cut requires deleting every legacy applied manifest"
      )
    ).toBe("legacy-manifest");
    expect(id("tests: 1 failed: test_ratchet — AssertionError: oracle-coverage-pending ratchet failed")).toBe("oracle-coverage");
    expect(id("tests: 2 failed: test_a; test_b")).toBe("tests");
  });

  it("gives a PR checks failure the cluster's class", () => {
    expect(classifyFailure({ station: "pr_checks", rule_id: "ci:stale-encoder-pin", message: null })).toEqual({
      id: "migration",
      subclass: "stale-encoder-pin",
      basis: "text",
    });
    // A cluster with no class of its own: the other rules still apply.
    expect(classifyFailure({ station: "pr_checks", rule_id: "ci:tests", message: null }).id).toBe("unknown");
  });
});
